const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir, toStoredPath, fromStoredPath } = require('./paths.cjs');

const MAX_SNAPSHOTS_PER_FILE = 3;
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.veloide',
  'bin',
  'obj',
]);

const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  sidebarOpen: false,
  alwaysAllowInstalls: false,
  qwenEnabled: false,
  qwenAsked: false,
  customRunCommands: {},
  recentFiles: [],
  lastFolder: null,
};

function createFsService(paths) {
  function readSettings() {
    try {
      if (!fs.existsSync(paths.settingsFile)) {
        return { ...DEFAULT_SETTINGS };
      }
      const raw = JSON.parse(fs.readFileSync(paths.settingsFile, 'utf8'));
      const merged = { ...DEFAULT_SETTINGS, ...raw };
      merged.recentFiles = (merged.recentFiles || []).map((p) => fromStoredPath(paths, p));
      if (merged.lastFolder) {
        merged.lastFolder = fromStoredPath(paths, merged.lastFolder);
      }
      return merged;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeSettings(patch) {
    const current = readSettings();
    const next = { ...current, ...patch };
    const serialized = {
      ...next,
      recentFiles: (next.recentFiles || []).slice(0, 15).map((p) => toStoredPath(paths, p)),
      lastFolder: next.lastFolder ? toStoredPath(paths, next.lastFolder) : null,
    };
    ensureDir(path.dirname(paths.settingsFile));
    const tmpFile = `${paths.settingsFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmpFile, JSON.stringify(serialized, null, 2), 'utf8');
    fs.renameSync(tmpFile, paths.settingsFile);
    return next;
  }

  function recordRecentFile(filePath) {
    const settings = readSettings();
    const normalized = path.resolve(filePath);
    const list = [normalized, ...(settings.recentFiles || []).filter((p) => p !== normalized)].slice(0, 15);
    writeSettings({ recentFiles: list });
    return list;
  }

  function getSnapshotBucket(filePath) {
    const key = crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16);
    return path.join(paths.snapshotsDir, key);
  }

  function createSnapshot(filePath, content) {
    try {
      const bucket = ensureDir(getSnapshotBucket(filePath));
      const indexFile = path.join(bucket, 'index.json');
      let entries = [];
      if (fs.existsSync(indexFile)) {
        try {
          entries = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        } catch {
          entries = [];
        }
      }

      const contentHash = crypto.createHash('sha1').update(content).digest('hex');
      if (entries[0] && entries[0].hash === contentHash) {
        return entries;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const snapFile = path.join(bucket, `${id}.snap`);
      fs.writeFileSync(snapFile, content, 'utf8');

      const entry = {
        id,
        filePath: path.resolve(filePath),
        createdAt: Date.now(),
        size: Buffer.byteLength(content, 'utf8'),
        lines: content.split('\n').length,
        hash: contentHash,
      };

      entries.unshift(entry);

      // Rotate out oldest beyond VeloWrite's 3-snapshot local recovery policy
      while (entries.length > MAX_SNAPSHOTS_PER_FILE) {
        const removed = entries.pop();
        try {
          fs.rmSync(path.join(bucket, `${removed.id}.snap`), { force: true });
        } catch {
          // ignore
        }
      }

      fs.writeFileSync(indexFile, JSON.stringify(entries, null, 2), 'utf8');
      return entries;
    } catch {
      return [];
    }
  }

  function listSnapshots(filePath) {
    const bucket = getSnapshotBucket(filePath);
    const indexFile = path.join(bucket, 'index.json');
    if (!fs.existsSync(indexFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    } catch {
      return [];
    }
  }

  function readSnapshotContent(filePath, snapshotId) {
    const bucket = getSnapshotBucket(filePath);
    const safeId = path.basename(snapshotId);
    const snapFile = path.join(bucket, `${safeId}.snap`);
    if (!fs.existsSync(snapFile)) return null;
    return fs.readFileSync(snapFile, 'utf8');
  }

  function readFile(filePath) {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error('File exceeds 50 MB editor safety limit');
    }
    const content = fs.readFileSync(resolved, 'utf8');
    recordRecentFile(resolved);
    return {
      path: resolved,
      name: path.basename(resolved),
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      snapshots: listSnapshots(resolved),
    };
  }

  /**
   * Guarded atomic save:
   * - Checks mtimeMs against expectedMtimeMs unless force=true (external-change protection)
   * - Captures previous on-disk version into the 3-snapshot recovery ring before overwriting
   * - Writes to temp file and atomically renames into place
   */
  function saveFile(filePath, content, options = {}) {
    const resolved = path.resolve(filePath);
    const { expectedMtimeMs = null, force = false } = options;

    if (fs.existsSync(resolved)) {
      const currentStat = fs.statSync(resolved);
      if (
        !force &&
        expectedMtimeMs !== null &&
        Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1000
      ) {
        return {
          ok: false,
          conflict: true,
          diskMtimeMs: currentStat.mtimeMs,
          message: 'File was modified outside VeloIde since you opened it.',
        };
      }
      try {
        const previous = fs.readFileSync(resolved, 'utf8');
        if (previous !== content) {
          createSnapshot(resolved, previous);
        }
      } catch {
        // Ignore snapshot errors on unreadable prior file
      }
    } else {
      ensureDir(path.dirname(resolved));
    }

    const tmpPath = `${resolved}.veloide-tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, resolved);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      // Fallback for filesystems/permissions where rename across dirs fails
      fs.writeFileSync(resolved, content, 'utf8');
    }

    const nextStat = fs.statSync(resolved);
    recordRecentFile(resolved);

    return {
      ok: true,
      path: resolved,
      name: path.basename(resolved),
      mtimeMs: nextStat.mtimeMs,
      size: nextStat.size,
      snapshots: listSnapshots(resolved),
    };
  }

  function readDirectoryTree(rootDir, maxDepth = 4) {
    const resolved = path.resolve(rootDir);
    if (!fs.existsSync(resolved)) return null;
    writeSettings({ lastFolder: resolved });

    let count = 0;
    const MAX_ENTRIES = 1500;

    function walk(dir, depth) {
      if (depth > maxDepth || count >= MAX_ENTRIES) return [];
      let dirents;
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }

      const folders = [];
      const files = [];

      for (const entry of dirents) {
        if (count >= MAX_ENTRIES) break;
        if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.veloide') {
          if (IGNORED_DIRS.has(entry.name)) continue;
        }
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          count++;
          const full = path.join(dir, entry.name);
          folders.push({
            name: entry.name,
            path: full,
            relativePath: path.relative(resolved, full),
            kind: 'dir',
            children: depth < maxDepth ? walk(full, depth + 1) : [],
          });
        } else if (entry.isFile()) {
          count++;
          const full = path.join(dir, entry.name);
          files.push({
            name: entry.name,
            path: full,
            relativePath: path.relative(resolved, full),
            kind: 'file',
          });
        }
      }

      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...folders, ...files];
    }

    return {
      root: resolved,
      name: path.basename(resolved),
      entries: walk(resolved, 0),
      truncated: count >= MAX_ENTRIES,
    };
  }

  function listAllFilesFlat(rootDir, limit = 1000) {
    const resolved = path.resolve(rootDir);
    const out = [];

    function walk(dir, depth) {
      if (depth > 6 || out.length >= limit) return;
      let dirents;
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirents) {
        if (out.length >= limit) break;
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const full = path.join(dir, entry.name);
          out.push({
            name: entry.name,
            path: full,
            relativePath: path.relative(resolved, full),
          });
        }
      }
    }

    walk(resolved, 0);
    return out;
  }

  /**
   * Fast project-wide search: prefers ripgrep (`rg`) when installed on the machine,
   * and falls back cleanly to a pure-Node async scanner.
   */
  async function searchInFolder(rootDir, query, options = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed || !rootDir || !fs.existsSync(rootDir)) return [];
    const maxResults = options.maxResults || 120;
    const caseSensitive = Boolean(options.caseSensitive);

    const rgResult = await tryRipgrep(rootDir, trimmed, maxResults, caseSensitive);
    if (rgResult !== null) {
      return rgResult;
    }

    return fallbackSearch(rootDir, trimmed, maxResults, caseSensitive);
  }

  function tryRipgrep(rootDir, query, maxResults, caseSensitive) {
    return new Promise((resolve) => {
      const args = [
        '--vimgrep',
        '--fixed-strings',
        '--no-heading',
        '--max-count',
        '10',
        '--max-filesize',
        '1M',
        '--glob',
        '!node_modules/**',
        '--glob',
        '!.git/**',
        '--glob',
        '!dist/**',
        '--glob',
        '!target/**',
        '--glob',
        '!__pycache__/**',
      ];
      if (!caseSensitive) args.push('-i');
      args.push(query, '.');

      let settled = false;
      let stdout = '';
      let proc;
      try {
        proc = spawn('rg', args, { cwd: rootDir, windowsHide: true });
      } catch {
        resolve(null);
        return;
      }

      proc.on('error', () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });

      proc.stdout.on('data', (chunk) => {
        if (stdout.length < 512 * 1024) {
          stdout += chunk.toString('utf8');
        }
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0 && code !== 1) {
          resolve(null);
          return;
        }
        const results = [];
        for (const line of stdout.split(/\r?\n/)) {
          if (!line || results.length >= maxResults) break;
          const m = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
          if (!m) continue;
          const rel = m[1].replace(/^\.\//, '');
          results.push({
            filePath: path.resolve(rootDir, rel),
            relativePath: rel,
            line: Number(m[2]),
            column: Number(m[3]),
            preview: m[4].trim().slice(0, 180),
          });
        }
        resolve(results);
      });
    });
  }

  function fallbackSearch(rootDir, query, maxResults, caseSensitive) {
    const files = listAllFilesFlat(rootDir, 800);
    const needle = caseSensitive ? query : query.toLowerCase();
    const results = [];

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const stat = fs.statSync(file.path);
        if (stat.size > 1024 * 1024) continue;
        const buf = fs.readFileSync(file.path);
        // Skip binary files (null byte in first 4 KB)
        let isBinary = false;
        const checkLen = Math.min(buf.length, 4096);
        for (let i = 0; i < checkLen; i++) {
          if (buf[i] === 0) {
            isBinary = true;
            break;
          }
        }
        if (isBinary) continue;

        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
          const idx = hay.indexOf(needle);
          if (idx !== -1) {
            results.push({
              filePath: file.path,
              relativePath: file.relativePath,
              line: i + 1,
              column: idx + 1,
              preview: lines[i].trim().slice(0, 180),
            });
          }
        }
      } catch {
        // skip unreadable
      }
    }

    return results;
  }

  return {
    readSettings,
    writeSettings,
    recordRecentFile,
    readFile,
    saveFile,
    createSnapshot,
    listSnapshots,
    readSnapshotContent,
    readDirectoryTree,
    listAllFilesFlat,
    searchInFolder,
  };
}

module.exports = {
  createFsService,
  DEFAULT_SETTINGS,
  MAX_SNAPSHOTS_PER_FILE,
};
