const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const { resolvePaths, ensureDataDirs, cleanTmpDir } = require('./paths.cjs');
const { createFsService } = require('./fsService.cjs');
const { loadRegistry, detectLanguage } = require('./registry.cjs');
const { createToolchainManager } = require('./toolchains.cjs');
const { createRunner } = require('./runner.cjs');
const { createTerminalManager } = require('./terminal.cjs');
const { createQwenManager } = require('./qwen.cjs');

// Resolve Installed vs Portable storage BEFORE Electron initializes userData
const appPaths = resolvePaths();
ensureDataDirs(appPaths);
if (appPaths.isPortable) {
  app.setPath('userData', appPaths.electronUserData);
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

const registry = loadRegistry(appPaths);
const fsService = createFsService(appPaths);
const toolchainManager = createToolchainManager(appPaths, registry);
const runner = createRunner(appPaths, registry, toolchainManager);
const terminal = createTerminalManager(toolchainManager);
const qwen = createQwenManager(appPaths, registry, fsService);

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendUpdateStatus(payload) {
  sendToRenderer('veloide:update-status', payload);
}

function configureAutoUpdater() {
  if (appPaths.isPortable) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      status: 'available',
      version: info.version,
      releaseName: info.releaseName || `v${info.version}`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({
      status: 'up-to-date',
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      status: 'downloading',
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      status: 'downloaded',
      version: info.version,
      releaseName: info.releaseName || `v${info.version}`,
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      status: 'error',
      message: err ? String(err.message || err) : 'Update check failed',
    });
  });
}

function extractCliTarget(argv) {
  const args = app.isPackaged ? argv.slice(1) : argv.slice(2);
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    const candidate = path.resolve(arg);
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        return { path: candidate, isDirectory: stat.isDirectory() };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

let pendingLaunchTarget = extractCliTarget(process.argv);

function createWindow() {
  const settings = fsService.readSettings();
  const bgMap = {
    light: '#f5f4f0',
    dark: '#171614',
    sepia: '#ebe3d3',
  };

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 780,
    minHeight: 540,
    title: 'VeloIde',
    backgroundColor: bgMap[settings.theme] || bgMap.dark,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  // App & Portable Info
  ipcMain.handle('veloide:get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    isPortable: appPaths.isPortable,
    dataRoot: appPaths.dataRoot,
    repoUrl: 'https://github.com/halxo/veloide',
    releasesUrl: 'https://github.com/halxo/veloide/releases/latest',
    launchTarget: pendingLaunchTarget,
  }));

  ipcMain.handle('veloide:open-external', (_ev, url) => {
    if (typeof url === 'string' && /^https?:|^mailto:/i.test(url)) {
      return shell.openExternal(url);
    }
    return undefined;
  });

  // Settings
  ipcMain.handle('veloide:get-settings', () => fsService.readSettings());
  ipcMain.handle('veloide:update-settings', (_ev, patch) => fsService.writeSettings(patch));

  // File & Folder Operations
  ipcMain.handle('veloide:open-file-dialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled || res.filePaths.length === 0) return [];
    return res.filePaths.map((p) => fsService.readFile(p));
  });

  ipcMain.handle('veloide:open-folder-dialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const folderPath = res.filePaths[0];
    terminal.setCwd(folderPath);
    return fsService.readDirectoryTree(folderPath);
  });

  ipcMain.handle('veloide:save-file-dialog', async (_ev, defaultName) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'untitled.txt',
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle('veloide:read-file', (_ev, filePath) => fsService.readFile(filePath));
  ipcMain.handle('veloide:save-file', (_ev, filePath, content, options) =>
    fsService.saveFile(filePath, content, options)
  );
  ipcMain.handle('veloide:read-folder', (_ev, folderPath) => {
    terminal.setCwd(folderPath);
    return fsService.readDirectoryTree(folderPath);
  });
  ipcMain.handle('veloide:list-files-flat', (_ev, folderPath) =>
    fsService.listAllFilesFlat(folderPath)
  );
  ipcMain.handle('veloide:search-folder', (_ev, folderPath, query, options) =>
    fsService.searchInFolder(folderPath, query, options)
  );

  // Local 3-Snapshot History (reused from VeloWrite's recovery model)
  ipcMain.handle('veloide:list-snapshots', (_ev, filePath) => fsService.listSnapshots(filePath));
  ipcMain.handle('veloide:read-snapshot', (_ev, filePath, snapshotId) =>
    fsService.readSnapshotContent(filePath, snapshotId)
  );

  // Toolchain Registry & On-Demand Installer
  ipcMain.handle('veloide:get-registry-summary', () => ({
    languages: registry.languages.map((l) => ({
      id: l.id,
      name: l.name,
      extensions: l.extensions || [],
      toolchain: l.toolchain || null,
      builtinRunner: l.builtinRunner || null,
    })),
    toolchains: toolchainManager.listToolchains(),
  }));

  ipcMain.handle('veloide:resolve-runtime', (_ev, { filePath, content, languageId }) => {
    const settings = fsService.readSettings();
    const lang = detectLanguage(registry, { filePath, content, explicitLanguageId: languageId });
    const ext = filePath ? path.extname(filePath).toLowerCase() : null;
    return {
      language: lang ? { id: lang.id, name: lang.name, extensions: lang.extensions } : null,
      runtime: toolchainManager.resolveLanguageRuntime(lang, settings.customRunCommands, {
        extension: ext,
      }),
    };
  });

  ipcMain.handle('veloide:install-toolchain', async (_ev, toolchainId) => {
    return toolchainManager.installToolchain(toolchainId, (progress) => {
      sendToRenderer('veloide:toolchain-progress', progress);
    });
  });

  ipcMain.handle('veloide:cancel-toolchain-install', (_ev, toolchainId) =>
    toolchainManager.cancelInstall(toolchainId)
  );

  ipcMain.handle('veloide:remove-toolchain', (_ev, toolchainId) =>
    toolchainManager.removeToolchain(toolchainId)
  );

  ipcMain.handle('veloide:list-toolchains', () => toolchainManager.listToolchains());

  // Portable Offline Prefill (batch install selected toolchains + optional Qwen)
  ipcMain.handle('veloide:prefill-offline', async (_ev, { toolchainIds = [], includeQwen = false }) => {
    const results = [];
    for (const id of toolchainIds) {
      try {
        const status = await toolchainManager.installToolchain(id, (progress) => {
          sendToRenderer('veloide:toolchain-progress', progress);
        });
        results.push({ id, ok: true, status });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    if (includeQwen) {
      try {
        const qStatus = await qwen.install((progress) => {
          sendToRenderer('veloide:qwen-progress', progress);
        });
        results.push({ id: 'qwen2.5-coder-1.5b', ok: true, status: qStatus });
      } catch (err) {
        results.push({ id: 'qwen2.5-coder-1.5b', ok: false, error: err.message });
      }
    }
    return results;
  });

  // Universal Code Runner
  ipcMain.handle('veloide:run-code', async (_ev, request) => {
    const settings = fsService.readSettings();
    return runner.run(
      { ...request, customRunCommands: settings.customRunCommands || {} },
      (event) => sendToRenderer('veloide:run-event', event)
    );
  });

  ipcMain.handle('veloide:stop-run', () => runner.stopCurrent());
  ipcMain.handle('veloide:run-stdin', (_ev, text) => runner.sendStdin(text));

  // Built-in Terminal (all VeloIde compilers on PATH)
  ipcMain.handle('veloide:terminal-exec', (_ev, command) =>
    terminal.execCommand(command, (event) => sendToRenderer('veloide:terminal-event', event))
  );
  ipcMain.handle('veloide:terminal-stdin', (_ev, text) => terminal.sendInput(text));
  ipcMain.handle('veloide:terminal-kill', () => terminal.killRunning());
  ipcMain.handle('veloide:terminal-cwd', (_ev, nextCwd) =>
    nextCwd ? terminal.setCwd(nextCwd) : terminal.getCwd()
  );

  // Local Qwen2.5-Coder-1.5B Autocomplete
  qwen.onStatus((status) => sendToRenderer('veloide:qwen-status', status));

  ipcMain.handle('veloide:qwen-status', () => qwen.getStatus());
  ipcMain.handle('veloide:qwen-set-enabled', (_ev, enabled) => qwen.setEnabled(enabled));
  ipcMain.handle('veloide:qwen-install', async () => {
    return qwen.install((progress) => {
      sendToRenderer('veloide:qwen-progress', progress);
    });
  });
  ipcMain.handle('veloide:qwen-cancel-install', () => qwen.cancelInstall());
  ipcMain.handle('veloide:qwen-remove', () => qwen.remove());
  ipcMain.handle('veloide:qwen-complete', (_ev, params) => qwen.complete(params));

  // Auto-Updater (Installed mode) / Release check (Portable mode)
  ipcMain.handle('veloide:check-for-updates', async () => {
    if (appPaths.isPortable) {
      sendUpdateStatus({
        status: 'up-to-date',
        version: app.getVersion(),
        message: `Portable v${app.getVersion()} — download updates from GitHub Releases`,
      });
      return { ok: true, packaged: app.isPackaged, portable: true };
    }
    if (!app.isPackaged) {
      sendUpdateStatus({
        status: 'up-to-date',
        version: app.getVersion(),
        message: 'Auto-updater runs in packaged desktop builds',
      });
      return { ok: true, packaged: false };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, packaged: true };
    } catch (err) {
      const message = err ? String(err.message || err) : 'Update check failed';
      sendUpdateStatus({ status: 'error', message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('veloide:install-update', () => {
    if (!appPaths.isPortable) {
      autoUpdater.quitAndInstall(false, true);
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const target = extractCliTarget(argv);
      if (target) {
        sendToRenderer('veloide:open-target', target);
      }
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    const target = { path: filePath, isDirectory: false };
    if (mainWindow) {
      sendToRenderer('veloide:open-target', target);
    } else {
      pendingLaunchTarget = target;
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    configureAutoUpdater();
    createWindow();

    if (app.isPackaged && !appPaths.isPortable) {
      setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(() => {});
      }, 3000);

      setInterval(() => {
        void autoUpdater.checkForUpdates().catch(() => {});
      }, 4 * 60 * 60 * 1000);
    }
  });

  app.on('before-quit', () => {
    runner.stopCurrent();
    terminal.killRunning();
    qwen.stopServer();
    if (appPaths.isPortable) {
      cleanTmpDir(appPaths);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
