const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir } = require('./paths.cjs');
const { downloadFile, extractArchive } = require('./downloader.cjs');
const { getPlatformKey, getPlatformAsset } = require('./registry.cjs');

/**
 * Finds an executable on system PATH (respecting Windows PATHEXT).
 */
function findSystemBinary(binName, env = process.env) {
  if (!binName) return null;
  const pathVar = env.PATH || env.Path || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    if (isWin && path.extname(binName)) {
      const candidate = path.join(dir, binName);
      if (isExecutableFile(candidate)) return candidate;
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, isWin ? `${binName}${ext}` : binName);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively searches up to depth 5 inside a toolchain directory for its target executable.
 */
function findBinaryInDir(rootDir, targetFileName, maxDepth = 5) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const targetLower = targetFileName.toLowerCase();

  function walk(dir, depth) {
    if (depth > maxDepth) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    // Prefer exact matches in current directory (and bin/ subdirs) before descending deeper
    for (const entry of entries) {
      if (entry.isFile() || entry.isSymbolicLink()) {
        if (entry.name.toLowerCase() === targetLower) {
          const full = path.join(dir, entry.name);
          if (process.platform !== 'win32') {
            try {
              fs.chmodSync(full, 0o755);
            } catch {
              // ignore
            }
          }
          return full;
        }
      }
    }

    const dirs = entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => (a.name === 'bin' ? -1 : b.name === 'bin' ? 1 : a.name.localeCompare(b.name)));

    for (const d of dirs) {
      const found = walk(path.join(dir, d.name), depth + 1);
      if (found) return found;
    }
    return null;
  }

  return walk(rootDir, 0);
}

function getDirSizeBytes(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          total += fs.statSync(full).size;
        }
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return total;
}

function createToolchainManager(paths, registry) {
  const activeControllers = new Map();

  function getToolchainDir(id) {
    return path.join(paths.toolchainsDir, id);
  }

  function getExpectedBinName(toolchain) {
    if (!toolchain || !toolchain.binNames) return toolchain?.id || '';
    return toolchain.binNames[process.platform] || toolchain.binNames.default || toolchain.id;
  }

  function findManagedBinary(id) {
    const tc = registry.toolchains[id];
    if (!tc) return null;
    const dir = getToolchainDir(id);
    if (!fs.existsSync(dir)) return null;
    const binName = getExpectedBinName(tc);
    return findBinaryInDir(dir, binName);
  }

  function getToolchainStatus(id) {
    const tc = registry.toolchains[id];
    if (!tc) return null;
    const managedBin = findManagedBinary(id);
    let systemBin = null;
    for (const candidate of tc.systemBins || []) {
      const found = findSystemBinary(candidate);
      if (found) {
        systemBin = found;
        break;
      }
    }
    const platformAsset = getPlatformAsset(tc, getPlatformKey());
    return {
      id: tc.id,
      name: tc.name,
      version: tc.version,
      source: tc.source,
      license: tc.license,
      dependsOn: tc.dependsOn || [],
      installedManaged: Boolean(managedBin),
      managedBin,
      systemBin,
      canDownload: Boolean(platformAsset),
      downloadSize: platformAsset ? platformAsset.size || 0 : 0,
      downloadUrl: platformAsset ? platformAsset.url : null,
      packageManagerHint: tc.packageManagerHint?.[process.platform] || null,
      diskBytes: managedBin ? getDirSizeBytes(getToolchainDir(id)) : 0,
    };
  }

  /**
   * Builds a process environment with every VeloIde-installed toolchain's bin directory
   * prepended to PATH, plus toolchain-specific env vars (JAVA_HOME, GOROOT, RUSTUP_HOME, etc.).
   */
  function getAugmentedEnv(baseEnv = process.env) {
    const env = { ...baseEnv };
    const extraPathDirs = [];

    for (const id of Object.keys(registry.toolchains || {})) {
      const tc = registry.toolchains[id];
      const installDir = getToolchainDir(id);
      const binPath = findManagedBinary(id);
      if (!binPath) continue;

      const binDir = path.dirname(binPath);
      if (!extraPathDirs.includes(binDir)) {
        extraPathDirs.push(binDir);
      }

      if (tc.envFromBinParent) {
        env[tc.envFromBinParent] = path.dirname(binDir);
      }

      if (tc.env) {
        for (const [key, val] of Object.entries(tc.env)) {
          env[key] = String(val).replace(/\{installDir\}/g, installDir);
        }
      }
    }

    if (extraPathDirs.length > 0) {
      const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
      env[pathKey] = [...extraPathDirs, env[pathKey] || ''].filter(Boolean).join(path.delimiter);
    }

    return env;
  }

  /**
   * Resolves how a given language will run right now:
   *  - builtin (HTML, Markdown, JSON, YAML, TOML, CSS)
   *  - custom (user per-extension command)
   *  - system (already on machine PATH — zero download)
   *  - managed (already installed in VeloIde toolchains/)
   *  - missing (returns full one-line install prompt metadata!)
   */
  function resolveLanguageRuntime(lang, customRunCommands = {}, options = {}) {
    // 1. User custom command per extension takes precedence even for unknown extensions
    const ext = options.extension ? options.extension.toLowerCase() : null;
    if (ext && customRunCommands && customRunCommands[ext]) {
      return {
        ready: true,
        source: 'custom',
        label: `Custom (${ext})`,
        customCommand: customRunCommands[ext],
      };
    }

    if (!lang) {
      return { ready: false, source: 'unknown', reason: 'Unknown language' };
    }

    // 2. Built-in zero-download runner (HTML preview, Markdown preview, JSON/YAML/TOML validator)
    if (lang.builtinRunner) {
      return {
        ready: true,
        source: 'builtin',
        label: 'Built-in',
        builtinRunner: lang.builtinRunner,
      };
    }

    // 3. System-first check: if already installed on user's machine, use it immediately!
    for (const cmdSpec of lang.systemCommands || []) {
      const sysBin = findSystemBinary(cmdSpec.bin);
      if (sysBin) {
        return {
          ready: true,
          source: 'system',
          label: `System ${cmdSpec.bin}`,
          binPath: sysBin,
          commandSpec: cmdSpec,
        };
      }
    }

    // 4. Managed toolchain check (already downloaded into VeloIde)
    if (lang.toolchain && registry.toolchains[lang.toolchain]) {
      const tc = registry.toolchains[lang.toolchain];
      const depsReady = (tc.dependsOn || []).every((depId) => {
        const depStatus = getToolchainStatus(depId);
        return depStatus && (depStatus.systemBin || depStatus.installedManaged);
      });
      const managedBin = findManagedBinary(lang.toolchain);
      if (managedBin && depsReady) {
        return {
          ready: true,
          source: 'managed',
          label: `VeloIde ${tc.id} ${tc.version}`,
          toolchainId: lang.toolchain,
          binPath: managedBin,
          commandSpec: lang.managedCommand,
        };
      }

      // Not installed yet — return transparent one-line install metadata
      const status = getToolchainStatus(lang.toolchain);
      let totalDownloadSize = status.downloadSize;
      const missingDeps = [];
      for (const depId of tc.dependsOn || []) {
        const depStatus = getToolchainStatus(depId);
        if (depStatus && !depStatus.systemBin && !depStatus.installedManaged) {
          missingDeps.push(depStatus);
          totalDownloadSize += depStatus.downloadSize || 0;
        }
      }

      if (status.canDownload) {
        return {
          ready: false,
          source: 'missing-managed',
          label: 'Not installed',
          toolchainId: lang.toolchain,
          toolchainName: tc.name,
          version: tc.version,
          downloadSource: tc.source,
          license: tc.license,
          downloadSize: totalDownloadSize,
          missingDeps: missingDeps.map((d) => d.name),
        };
      }
    }

    // 5. Niche / OS-bound compiler fallback (package manager hint or custom command)
    const hint =
      lang.packageManagerHint?.[process.platform] ||
      (lang.toolchain && registry.toolchains[lang.toolchain]?.packageManagerHint?.[process.platform]) ||
      null;

    return {
      ready: false,
      source: 'missing-system',
      label: 'Not installed',
      languageName: lang.name,
      packageManagerHint: hint,
    };
  }

  /**
   * Installs a toolchain (and any missing dependencies) atomically into `<toolchainsDir>/<id>`.
   */
  async function installToolchain(id, onProgress = () => {}) {
    const tc = registry.toolchains[id];
    if (!tc) {
      throw new Error(`Unknown toolchain: ${id}`);
    }

    // Install missing dependencies first (e.g. JDK before Kotlin/Groovy, Zig before Nim)
    for (const depId of tc.dependsOn || []) {
      const depStatus = getToolchainStatus(depId);
      if (depStatus && !depStatus.systemBin && !depStatus.installedManaged) {
        await installToolchain(depId, onProgress);
      }
    }

    if (findManagedBinary(id)) {
      return getToolchainStatus(id);
    }

    const platformKey = getPlatformKey();
    const asset = getPlatformAsset(tc, platformKey);
    if (!asset) {
      throw new Error(`No prebuilt archive for ${tc.name} on ${platformKey}`);
    }

    const controller = new AbortController();
    activeControllers.set(id, controller);

    const stagingDir = path.join(paths.tmpDir, `install-${id}-${Date.now()}`);
    const archivePath = path.join(stagingDir, `archive-${id}`);
    const extractDir = path.join(stagingDir, 'extracted');
    const finalDir = getToolchainDir(id);

    ensureDir(stagingDir);
    ensureDir(paths.toolchainsDir);

    try {
      onProgress({
        toolchainId: id,
        name: tc.name,
        phase: 'downloading',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: asset.size || 0,
      });

      if (tc.installerKind === 'rustup-isolated') {
        await installRustIsolated(tc, asset, stagingDir, finalDir, onProgress, controller.signal);
      } else {
        await downloadFile(asset.url, archivePath, {
          sha256: asset.sha256 || null,
          expectedSize: asset.size || 0,
          signal: controller.signal,
          onProgress: (p) =>
            onProgress({
              toolchainId: id,
              name: tc.name,
              ...p,
            }),
        });

        onProgress({
          toolchainId: id,
          name: tc.name,
          phase: 'extracting',
          percent: 99,
        });

        await extractArchive(archivePath, extractDir, asset.archive, {
          outputFile: asset.outputFile,
        });

        if (fs.existsSync(finalDir)) {
          fs.rmSync(finalDir, { recursive: true, force: true });
        }

        // Move extracted directory atomically (with copy fallback across devices)
        try {
          fs.renameSync(extractDir, finalDir);
        } catch {
          fs.cpSync(extractDir, finalDir, { recursive: true });
        }
      }

      const verifiedBin = findManagedBinary(id);
      if (!verifiedBin) {
        throw new Error(`Installed ${tc.name}, but expected binary was not found in ${finalDir}`);
      }

      onProgress({
        toolchainId: id,
        name: tc.name,
        phase: 'done',
        percent: 100,
      });

      return getToolchainStatus(id);
    } finally {
      activeControllers.delete(id);
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }

  async function installRustIsolated(tc, asset, stagingDir, finalDir, onProgress, signal) {
    const exeName = process.platform === 'win32' ? 'rustup-init.exe' : 'rustup-init';
    const rustupInitPath = path.join(stagingDir, exeName);
    await downloadFile(asset.url, rustupInitPath, {
      signal,
      expectedSize: 14000000,
      onProgress: (p) =>
        onProgress({
          toolchainId: tc.id,
          name: tc.name,
          phase: 'downloading',
          percent: Math.round((p.percent || 0) * 0.25),
          downloadedBytes: p.downloadedBytes,
          totalBytes: p.totalBytes,
        }),
    });

    if (process.platform !== 'win32') {
      fs.chmodSync(rustupInitPath, 0o755);
    }

    ensureDir(finalDir);
    const rustupHome = path.join(finalDir, 'rustup');
    const cargoHome = path.join(finalDir, 'cargo');

    onProgress({
      toolchainId: tc.id,
      name: tc.name,
      phase: 'extracting',
      percent: 40,
      detail: 'Installing isolated rustc & cargo…',
    });

    const args = ['-y', '--no-modify-path', '--profile', 'minimal', '--default-toolchain', 'stable'];

    // On Windows without Visual Studio Build Tools, default to the GNU host toolchain so it works out of the box
    if (process.platform === 'win32' && !findSystemBinary('link.exe')) {
      args.push('--default-host', 'x86_64-pc-windows-gnu');
    }

    await new Promise((resolve, reject) => {
      const proc = spawn(rustupInitPath, args, {
        env: {
          ...process.env,
          RUSTUP_HOME: rustupHome,
          CARGO_HOME: cargoHome,
        },
        windowsHide: true,
      });
      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', (d) => (stderr += d.toString('utf8')));
      const onAbort = () => proc.kill();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`rustup-init failed (code ${code}): ${stderr.slice(-300)}`));
      });
    });
  }

  function cancelInstall(id) {
    const controller = activeControllers.get(id);
    if (controller) {
      controller.abort();
      activeControllers.delete(id);
      return true;
    }
    return false;
  }

  function removeToolchain(id) {
    const dir = getToolchainDir(id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return getToolchainStatus(id);
  }

  function listToolchains() {
    const langsByToolchain = new Map();
    for (const lang of registry.languages || []) {
      if (!lang.toolchain) continue;
      if (!langsByToolchain.has(lang.toolchain)) {
        langsByToolchain.set(lang.toolchain, []);
      }
      langsByToolchain.get(lang.toolchain).push(lang.name);
    }

    return Object.keys(registry.toolchains || {}).map((id) => ({
      ...getToolchainStatus(id),
      languages: langsByToolchain.get(id) || [],
    }));
  }

  return {
    findSystemBinary,
    findManagedBinary,
    getToolchainStatus,
    getAugmentedEnv,
    resolveLanguageRuntime,
    installToolchain,
    cancelInstall,
    removeToolchain,
    listToolchains,
    getDirSizeBytes,
  };
}

module.exports = {
  createToolchainManager,
  findSystemBinary,
  findBinaryInDir,
  getDirSizeBytes,
};
