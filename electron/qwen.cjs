const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir } = require('./paths.cjs');
const { downloadFile, extractArchive } = require('./downloader.cjs');
const { getPlatformKey } = require('./registry.cjs');
const { findBinaryInDir, getDirSizeBytes } = require('./toolchains.cjs');

const IDLE_UNLOAD_MS = 10 * 60 * 1000; // Unload llama-server after 10 min idle
const MAX_PREFIX_CHARS = 4500;
const MAX_SUFFIX_CHARS = 1500;
const STOP_TOKENS = ['\n\n', '<|endoftext|>', '<|im_end|>', '<|file_sep|>', '<|fim_pad|>'];

/**
 * Builds a Qwen2.5-Coder Fill-In-The-Middle (FIM) prompt from the cursor context.
 */
function buildFimPrompt({ prefix = '', suffix = '', filename = '', language = '' }) {
  const trimmedPrefix =
    prefix.length > MAX_PREFIX_CHARS ? prefix.slice(prefix.length - MAX_PREFIX_CHARS) : prefix;
  const trimmedSuffix =
    suffix.length > MAX_SUFFIX_CHARS ? suffix.slice(0, MAX_SUFFIX_CHARS) : suffix;

  const header = filename ? `<|file_sep|>${filename}\n` : language ? `// language: ${language}\n` : '';
  return `<|fim_prefix|>${header}${trimmedPrefix}<|fim_suffix|>${trimmedSuffix}<|fim_middle|>`;
}

/**
 * Cleans model completion output so ghost text stays crisp and never echoes trailing tokens.
 */
function sanitizeCompletion(raw, suffix = '') {
  if (!raw) return '';
  let text = String(raw);
  for (const token of STOP_TOKENS) {
    const idx = text.indexOf(token);
    if (idx !== -1) text = text.slice(0, idx);
  }
  // Remove leading/trailing FIM control tags if model leaked any
  text = text.replace(/<\|fim_[a-z]+\|>/g, '').replace(/<\|repo_name\|>/g, '');

  // If the completion ends with text that duplicates the immediate suffix, strip the overlap
  if (suffix && text.length > 0) {
    const firstSuffixLine = suffix.split('\n', 1)[0];
    if (firstSuffixLine && firstSuffixLine.length >= 1 && text.endsWith(firstSuffixLine)) {
      text = text.slice(0, text.length - firstSuffixLine.length);
    }
  }

  // Cap single inline suggestion to at most 4 lines so it stays calm and non-intrusive
  const lines = text.split('\n');
  if (lines.length > 4) {
    text = lines.slice(0, 4).join('\n');
  }

  return text;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function createQwenManager(paths, registry, fsService) {
  const qwenConfig = registry.qwen;
  const modelRoot = path.join(paths.modelsDir, 'qwen2.5-coder-1.5b');
  const runtimeDir = path.join(modelRoot, 'runtime');
  const modelFile = path.join(modelRoot, qwenConfig.model.filename);

  let serverProc = null;
  let serverPort = null;
  let serverReadyPromise = null;
  let idleTimer = null;
  let activeHttpReq = null;
  let installController = null;
  let statusListeners = new Set();

  function emitStatus() {
    const st = getStatus();
    for (const cb of statusListeners) {
      try {
        cb(st);
      } catch {
        // ignore
      }
    }
  }

  function onStatus(cb) {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  }

  function getRuntimeAsset() {
    const key = getPlatformKey();
    return qwenConfig.runtime.platforms[key] || null;
  }

  function findRuntimeBin() {
    const asset = getRuntimeAsset();
    if (!asset) return null;
    return findBinaryInDir(runtimeDir, asset.bin, 4);
  }

  function isInstalled() {
    return Boolean(findRuntimeBin() && fs.existsSync(modelFile));
  }

  function getStatus() {
    const settings = fsService.readSettings();
    const asset = getRuntimeAsset();
    const installed = isInstalled();
    const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    return {
      enabled: Boolean(settings.qwenEnabled),
      asked: Boolean(settings.qwenAsked),
      installed,
      running: Boolean(serverProc && serverPort),
      loading: Boolean(serverReadyPromise && !serverPort),
      installing: Boolean(installController),
      canInstall: Boolean(asset),
      modelName: qwenConfig.model.name,
      modelSource: qwenConfig.model.source,
      modelLicense: qwenConfig.model.license,
      totalDownloadBytes: qwenConfig.model.size + (asset ? asset.size : 0),
      diskBytes: fs.existsSync(modelRoot) ? getDirSizeBytes(modelRoot) : 0,
      lowRamWarning: totalRamGb < 8,
      totalRamGb,
    };
  }

  function setEnabled(enabled) {
    fsService.writeSettings({ qwenEnabled: Boolean(enabled), qwenAsked: true });
    if (!enabled) {
      stopServer();
    }
    emitStatus();
    return getStatus();
  }

  function stopServer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (activeHttpReq) {
      try {
        activeHttpReq.destroy();
      } catch {
        // ignore
      }
      activeHttpReq = null;
    }
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {
        // ignore
      }
      serverProc = null;
    }
    serverPort = null;
    serverReadyPromise = null;
    emitStatus();
  }

  function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stopServer();
    }, IDLE_UNLOAD_MS);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function install(onProgress = () => {}) {
    const asset = getRuntimeAsset();
    if (!asset) {
      throw new Error(`No prebuilt llama.cpp runtime for ${getPlatformKey()}`);
    }

    if (installController) {
      throw new Error('Qwen2.5-Coder download is already in progress');
    }

    installController = new AbortController();
    emitStatus();

    const staging = ensureDir(path.join(paths.tmpDir, `qwen-install-${Date.now()}`));
    const totalAll = qwenConfig.model.size + asset.size;

    try {
      // Step 1: Download & extract llama.cpp server runtime (~15-25 MB)
      if (!findRuntimeBin()) {
        const runtimeArchive = path.join(staging, 'llama-runtime');
        await downloadFile(asset.url, runtimeArchive, {
          expectedSize: asset.size,
          signal: installController.signal,
          onProgress: (p) => {
            onProgress({
              step: 'runtime',
              label: `Downloading llama.cpp (${qwenConfig.runtime.version})…`,
              downloadedBytes: p.downloadedBytes,
              totalBytes: totalAll,
              percent: Math.min(99, Math.round((p.downloadedBytes / totalAll) * 100)),
              bytesPerSecond: p.bytesPerSecond,
            });
          },
        });
        ensureDir(runtimeDir);
        await extractArchive(runtimeArchive, runtimeDir, asset.archive);
      }

      // Step 2: Download Qwen2.5-Coder-1.5B GGUF Q4_K_M (~1.04 GB, SHA-256 verified)
      if (!fs.existsSync(modelFile)) {
        ensureDir(modelRoot);
        await downloadFile(qwenConfig.model.url, modelFile, {
          sha256: qwenConfig.model.sha256,
          expectedSize: qwenConfig.model.size,
          signal: installController.signal,
          onProgress: (p) => {
            const combined = asset.size + p.downloadedBytes;
            onProgress({
              step: 'model',
              label: 'Downloading Qwen2.5-Coder-1.5B (Q4_K_M)…',
              downloadedBytes: combined,
              totalBytes: totalAll,
              percent: Math.min(99, Math.round((combined / totalAll) * 100)),
              bytesPerSecond: p.bytesPerSecond,
            });
          },
        });
      }

      fsService.writeSettings({ qwenEnabled: true, qwenAsked: true });
      onProgress({ step: 'done', label: 'Qwen2.5-Coder-1.5B ready', percent: 100 });
      return getStatus();
    } finally {
      installController = null;
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {
        // ignore
      }
      emitStatus();
    }
  }

  function cancelInstall() {
    if (installController) {
      installController.abort();
      installController = null;
      emitStatus();
      return true;
    }
    return false;
  }

  function remove() {
    stopServer();
    if (fs.existsSync(modelRoot)) {
      fs.rmSync(modelRoot, { recursive: true, force: true });
    }
    fsService.writeSettings({ qwenEnabled: false });
    emitStatus();
    return getStatus();
  }

  async function ensureServerRunning() {
    if (serverProc && serverPort) {
      touchIdleTimer();
      return serverPort;
    }
    if (serverReadyPromise) return serverReadyPromise;

    const binPath = findRuntimeBin();
    if (!binPath || !fs.existsSync(modelFile)) {
      throw new Error('Qwen2.5-Coder-1.5B is not installed');
    }

    serverReadyPromise = (async () => {
      const port = await findFreePort();
      const threads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2) || 4));
      const args = [
        '--model',
        modelFile,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--ctx-size',
        '2048',
        '--threads',
        String(threads),
        '--n-gpu-layers',
        'auto',
        '--no-webui',
      ];

      const proc = spawn(binPath, args, {
        cwd: path.dirname(binPath),
        windowsHide: true,
      });

      serverProc = proc;
      emitStatus();

      proc.on('exit', () => {
        if (serverProc === proc) {
          serverProc = null;
          serverPort = null;
          serverReadyPromise = null;
          emitStatus();
        }
      });

      // Poll /health until llama-server finishes loading weights (up to 30s)
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (!serverProc) throw new Error('llama-server exited during startup');
        const healthy = await checkHealth(port);
        if (healthy) {
          serverPort = port;
          touchIdleTimer();
          emitStatus();
          return port;
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      stopServer();
      throw new Error('Timed out starting local Qwen2.5-Coder server');
    })();

    try {
      return await serverReadyPromise;
    } catch (err) {
      serverReadyPromise = null;
      throw err;
    }
  }

  function checkHealth(port) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async function complete(params) {
    const settings = fsService.readSettings();
    if (!settings.qwenEnabled || !isInstalled()) {
      return { text: '', disabled: true };
    }

    // Abort any older in-flight completion immediately when user keeps typing
    if (activeHttpReq) {
      try {
        activeHttpReq.destroy();
      } catch {
        // ignore
      }
      activeHttpReq = null;
    }

    const startedAt = Date.now();
    const port = await ensureServerRunning();
    touchIdleTimer();

    const prompt = buildFimPrompt(params);
    const body = JSON.stringify({
      prompt,
      n_predict: params.maxTokens || 56,
      temperature: 0.1,
      top_p: 0.9,
      repeat_penalty: 1.05,
      cache_prompt: true,
      stop: STOP_TOKENS,
    });

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/completion',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk.toString('utf8')));
          res.on('end', () => {
            if (activeHttpReq === req) activeHttpReq = null;
            try {
              const parsed = JSON.parse(data);
              const cleaned = sanitizeCompletion(parsed.content || '', params.suffix || '');
              resolve({
                text: cleaned,
                latencyMs: Date.now() - startedAt,
              });
            } catch {
              resolve({ text: '', latencyMs: Date.now() - startedAt });
            }
          });
        }
      );

      activeHttpReq = req;
      req.on('error', () => {
        if (activeHttpReq === req) activeHttpReq = null;
        resolve({ text: '', cancelled: true });
      });
      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ text: '', timedOut: true });
      });

      req.write(body);
      req.end();
    });
  }

  return {
    getStatus,
    onStatus,
    setEnabled,
    install,
    cancelInstall,
    remove,
    complete,
    stopServer,
  };
}

module.exports = {
  createQwenManager,
  buildFimPrompt,
  sanitizeCompletion,
};
