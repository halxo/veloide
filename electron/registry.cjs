const fs = require('fs');
const path = require('path');

function getPlatformKey(platform = process.platform, arch = process.arch) {
  const normArch = arch === 'x64' || arch === 'arm64' ? arch : 'x64';
  return `${platform}-${normArch}`;
}

function loadRegistry(paths) {
  const bundledPath = path.join(__dirname, '..', 'registry', 'toolchains.json');
  const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));

  if (paths && paths.registryCacheFile && fs.existsSync(paths.registryCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(paths.registryCacheFile, 'utf8'));
      if (
        cached &&
        cached.schemaVersion === bundled.schemaVersion &&
        cached.updatedAt &&
        cached.updatedAt > bundled.updatedAt
      ) {
        return cached;
      }
    } catch {
      // Fall back to bundled manifest
    }
  }

  return bundled;
}

function detectLanguage(registry, options = {}) {
  const { filePath = '', content = '', explicitLanguageId = null } = options;

  if (explicitLanguageId) {
    const found = registry.languages.find((l) => l.id === explicitLanguageId);
    if (found) return found;
  }

  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext) {
      const byExt = registry.languages.find((l) => (l.extensions || []).includes(ext));
      if (byExt) return byExt;
    }
  }

  // Shebang detection for scripts without an extension
  if (content && content.startsWith('#!')) {
    const firstLine = content.split(/\r?\n/, 1)[0].toLowerCase();
    for (const lang of registry.languages) {
      for (const sb of lang.shebangs || []) {
        if (firstLine.includes(sb)) {
          return lang;
        }
      }
    }
  }

  return null;
}

/**
 * Walks up from a file's directory (capped at workspaceRoot or 3 levels) looking for:
 *  1. `.veloide/run` one-line user override
 *  2. Standard project files (`Cargo.toml`, `go.mod`, `build.zig`, `package.json`, `*.csproj`, `Makefile`, etc.)
 */
function detectProjectRun(registry, filePath, workspaceRoot = null) {
  if (!filePath) return null;

  const fileDir = path.dirname(path.resolve(filePath));
  const stopDir = workspaceRoot ? path.resolve(workspaceRoot) : null;
  let current = fileDir;

  for (let depth = 0; depth < 4; depth++) {
    // 1. User one-line override in `.veloide/run`
    const overrideFile = path.join(current, '.veloide', 'run');
    if (fs.existsSync(overrideFile)) {
      const raw = fs.readFileSync(overrideFile, 'utf8').trim();
      if (raw) {
        return {
          kind: 'override',
          projectRoot: current,
          shellCommand: raw,
          source: '.veloide/run',
        };
      }
    }

    // 2. Check package.json only if this is a JS/TS project with a `start` or `dev` script?
    // For ziptie speed, prefer running the open JS/TS file directly UNLESS user explicitly sets `.veloide/run`.
    // For compiled project systems (Cargo.toml, go.mod, build.zig, *.csproj, gleam.toml), run the project!
    for (const detector of registry.projectDetectors || []) {
      const candidate = path.join(current, detector.file);
      if (fs.existsSync(candidate)) {
        // Only apply a project detector when the active file matches that ecosystem
        const ext = path.extname(filePath).toLowerCase();
        const lang = registry.languages.find((l) => l.id === detector.language);
        const matchesLang = !lang || (lang.extensions || []).includes(ext);
        if (matchesLang) {
          return {
            kind: 'project',
            projectRoot: current,
            detectorFile: detector.file,
            language: detector.language,
            toolchain: detector.toolchain,
            cmd: detector.cmd,
          };
        }
      }
    }

    // 3. C# / F# .csproj / .fsproj detection
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.cs' || ext === '.fs') {
      try {
        const entries = fs.readdirSync(current);
        const proj = entries.find((f) => f.endsWith('.csproj') || f.endsWith('.fsproj'));
        if (proj) {
          return {
            kind: 'project',
            projectRoot: current,
            detectorFile: proj,
            language: ext === '.fs' ? 'fsharp' : 'csharp',
            toolchain: 'dotnet',
            cmd: ['dotnet', 'run'],
          };
        }
      } catch {
        // ignore
      }
    }

    if (stopDir && current === stopDir) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function getPlatformAsset(toolchain, platformKey = getPlatformKey()) {
  if (!toolchain || !toolchain.platforms) return null;
  return toolchain.platforms[platformKey] || toolchain.platforms.all || null;
}

module.exports = {
  getPlatformKey,
  loadRegistry,
  detectLanguage,
  detectProjectRun,
  getPlatformAsset,
};
