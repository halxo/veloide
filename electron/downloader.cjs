const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { ensureDir } = require('./paths.cjs');

const MAX_REDIRECTS = 10;

/**
 * Streams an HTTP/HTTPS URL to disk with redirect following, live progress,
 * AbortSignal support, and optional SHA-256 verification.
 */
function downloadFile(url, destPath, options = {}) {
  const { sha256 = null, onProgress = null, signal = null, expectedSize = 0 } = options;

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Download cancelled'));
      return;
    }

    ensureDir(path.dirname(destPath));
    const tmpPath = `${destPath}.part`;

    let activeReq = null;
    let activeStream = null;
    let settled = false;

    const cleanup = () => {
      try {
        if (activeStream) activeStream.destroy();
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      if (activeReq) activeReq.destroy();
      fail(new Error('Download cancelled'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const fetchUrl = (currentUrl, redirectsLeft) => {
      if (settled) return;
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch {
        fail(new Error(`Invalid download URL: ${currentUrl}`));
        return;
      }

      const client = parsed.protocol === 'http:' ? http : https;
      activeReq = client.get(
        parsed,
        {
          headers: {
            'User-Agent': 'VeloIde/1.0 (+https://github.com/halxo/veloide)',
            Accept: '*/*',
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              fail(new Error('Too many HTTP redirects'));
              return;
            }
            const nextUrl = new URL(res.headers.location, parsed).toString();
            fetchUrl(nextUrl, redirectsLeft - 1);
            return;
          }

          if (status < 200 || status >= 300) {
            res.resume();
            fail(new Error(`Download failed with HTTP ${status} for ${currentUrl}`));
            return;
          }

          const totalBytes = Number(res.headers['content-length']) || expectedSize || 0;
          const hash = sha256 ? crypto.createHash('sha256') : null;
          activeStream = fs.createWriteStream(tmpPath);

          let downloadedBytes = 0;
          const startedAt = Date.now();
          let lastEmit = 0;

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (hash) hash.update(chunk);

            const now = Date.now();
            if (onProgress && now - lastEmit >= 120) {
              lastEmit = now;
              const elapsedSec = Math.max(0.1, (now - startedAt) / 1000);
              onProgress({
                phase: 'downloading',
                downloadedBytes,
                totalBytes,
                percent: totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
                bytesPerSecond: Math.round(downloadedBytes / elapsedSec),
              });
            }
          });

          res.on('error', fail);
          activeStream.on('error', fail);

          activeStream.on('finish', () => {
            if (settled) return;
            if (signal) signal.removeEventListener('abort', onAbort);

            if (hash && sha256) {
              const actual = hash.digest('hex').toLowerCase();
              if (actual !== sha256.toLowerCase()) {
                fail(
                  new Error(
                    `SHA-256 verification failed! Expected ${sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`
                  )
                );
                return;
              }
            }

            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tmpPath, destPath);
            } catch (err) {
              fail(err);
              return;
            }

            if (onProgress) {
              onProgress({
                phase: 'downloaded',
                downloadedBytes,
                totalBytes: totalBytes || downloadedBytes,
                percent: 100,
                bytesPerSecond: 0,
              });
            }

            settled = true;
            resolve({ path: destPath, size: downloadedBytes });
          });

          res.pipe(activeStream);
        }
      );

      activeReq.on('error', fail);
      activeReq.setTimeout(60000, () => {
        activeReq.destroy(new Error('Download timed out'));
      });
    };

    fetchUrl(url, MAX_REDIRECTS);
  });
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stderr = '';
    let stdout = '';
    if (proc.stdout) proc.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    if (proc.stderr) proc.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`));
      }
    });
  });
}

/**
 * Cross-platform archive extraction supporting zip, tar.gz, tar.xz, gz, 7z, and raw binaries.
 */
async function extractArchive(archivePath, destDir, archiveType, options = {}) {
  ensureDir(destDir);
  const platform = process.platform;

  if (archiveType === 'raw') {
    const outName = options.outputFile || path.basename(archivePath);
    const outPath = path.join(destDir, outName);
    fs.copyFileSync(archivePath, outPath);
    if (platform !== 'win32') {
      fs.chmodSync(outPath, 0o755);
    }
    return;
  }

  if (archiveType === 'gz') {
    const outName = options.outputFile || path.basename(archivePath, '.gz');
    const outPath = path.join(destDir, outName);
    await new Promise((resolve, reject) => {
      const inp = fs.createReadStream(archivePath);
      const out = fs.createWriteStream(outPath);
      const gunzip = zlib.createGunzip();
      inp.on('error', reject);
      gunzip.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      inp.pipe(gunzip).pipe(out);
    });
    if (platform !== 'win32') {
      fs.chmodSync(outPath, 0o755);
    }
    return;
  }

  if (archiveType === 'zip') {
    if (platform === 'win32') {
      try {
        // Windows 10/11 ships bsdtar which extracts zips much faster than Expand-Archive
        await runCommand('tar', ['-xf', archivePath, '-C', destDir]);
        return;
      } catch {
        await runCommand('powershell', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ]);
        return;
      }
    }
    try {
      await runCommand('unzip', ['-q', '-o', archivePath, '-d', destDir]);
      return;
    } catch {
      try {
        await runCommand('tar', ['-xf', archivePath, '-C', destDir]);
        return;
      } catch {
        await runCommand('python3', ['-m', 'zipfile', '-e', archivePath, destDir]);
        return;
      }
    }
  }

  if (archiveType === 'tar.gz' || archiveType === 'tar.xz' || archiveType === 'tgz') {
    const flag = archiveType === 'tar.xz' ? '-xJf' : '-xzf';
    try {
      await runCommand('tar', [flag, archivePath, '-C', destDir]);
    } catch {
      await runCommand('tar', ['-xf', archivePath, '-C', destDir]);
    }
    return;
  }

  if (archiveType === '7z') {
    try {
      await runCommand('tar', ['-xf', archivePath, '-C', destDir]);
      return;
    } catch {
      try {
        await runCommand('7z', ['x', archivePath, `-o${destDir}`, '-y']);
        return;
      } catch {
        throw new Error('Could not extract .7z archive (requires Windows 11 tar or 7z)');
      }
    }
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

module.exports = {
  downloadFile,
  extractArchive,
  runCommand,
};
