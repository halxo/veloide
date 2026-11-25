const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Resolves Installed vs Portable storage layout for VeloIde.
 *
 * Portable mode activates when:
 *   1. VELOIDE_PORTABLE_DIR env var is set, OR
 *   2. PORTABLE_EXECUTABLE_DIR env var is set (electron-builder portable), OR
 *   3. A `portable` or `portable.txt` marker file exists alongside the executable
 *      (or beside the `.app` bundle on macOS), OR
 *   4. `--portable` CLI argument is passed.
 *
 * In Portable mode, ALL app state (Electron userData, settings, snapshots,
 * installed compilers, Qwen model, and temp build files) lives inside `<baseDir>/data/`.
 */
function detectPortableBase(options = {}) {
  const execPath = options.execPath || process.execPath;
  const argv = options.argv || process.argv;
  const env = options.env || process.env;
  const platform = options.platform || process.platform;

  if (env.VELOIDE_PORTABLE_DIR) {
    return path.resolve(env.VELOIDE_PORTABLE_DIR);
  }
  if (env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(env.PORTABLE_EXECUTABLE_DIR);
  }

  const execDir = path.dirname(path.resolve(execPath));
  const candidates = [execDir];

  // On macOS, executable lives inside VeloIde.app/Contents/MacOS/VeloIde
  if (platform === 'darwin') {
    const appBundleParent = path.resolve(execDir, '..', '..', '..');
    candidates.push(appBundleParent);
  }

  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'portable')) ||
      fs.existsSync(path.join(dir, 'portable.txt'))
    ) {
      return dir;
    }
  }

  if (argv.includes('--portable')) {
    return platform === 'darwin' ? path.resolve(execDir, '..', '..', '..') : execDir;
  }

  return null;
}

function resolvePaths(options = {}) {
  const env = options.env || process.env;
  const portableBase = detectPortableBase(options);
  const isPortable = Boolean(portableBase);

  let dataRoot;
  if (env.VELOIDE_DATA_DIR) {
    dataRoot = path.resolve(env.VELOIDE_DATA_DIR);
  } else if (isPortable) {
    dataRoot = path.join(portableBase, 'data');
  } else {
    dataRoot = path.join(os.homedir(), '.veloide');
  }

  return {
    isPortable,
    portableBase,
    dataRoot,
    electronUserData: path.join(dataRoot, 'electron'),
    settingsFile: path.join(dataRoot, 'settings.json'),
    snapshotsDir: path.join(dataRoot, 'snapshots'),
    toolchainsDir: path.join(dataRoot, 'toolchains'),
    modelsDir: path.join(dataRoot, 'models'),
    tmpDir: path.join(dataRoot, 'tmp'),
    registryCacheFile: path.join(dataRoot, 'registry-cache.json'),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureDataDirs(paths) {
  ensureDir(paths.dataRoot);
  ensureDir(paths.snapshotsDir);
  ensureDir(paths.toolchainsDir);
  ensureDir(paths.modelsDir);
  ensureDir(paths.tmpDir);
  if (paths.isPortable) {
    ensureDir(paths.electronUserData);
  }
}

/**
 * In portable mode, store paths inside the portable root relatively so moving a USB stick
 * across different drive letters or mount points never breaks recent files or settings.
 */
function toStoredPath(paths, targetPath) {
  if (!targetPath) return targetPath;
  if (!paths.isPortable || !paths.portableBase) return targetPath;
  const rel = path.relative(paths.portableBase, targetPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return `$PORTABLE/${rel.split(path.sep).join('/')}`;
  }
  return targetPath;
}

function fromStoredPath(paths, storedPath) {
  if (!storedPath) return storedPath;
  if (storedPath.startsWith('$PORTABLE/') && paths.portableBase) {
    const rel = storedPath.slice('$PORTABLE/'.length);
    return path.resolve(paths.portableBase, rel);
  }
  return storedPath;
}

function cleanTmpDir(paths) {
  try {
    if (fs.existsSync(paths.tmpDir)) {
      fs.rmSync(paths.tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup on exit
  }
}

module.exports = {
  detectPortableBase,
  resolvePaths,
  ensureDir,
  ensureDataDirs,
  toStoredPath,
  fromStoredPath,
  cleanTmpDir,
};
