const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('veloideDesktop', {
  // App info & links
  getAppInfo: () => ipcRenderer.invoke('veloide:get-app-info'),
  openExternal: (url) => ipcRenderer.invoke('veloide:open-external', url),
  onOpenTarget: (cb) => subscribe('veloide:open-target', cb),

  // Settings
  getSettings: () => ipcRenderer.invoke('veloide:get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('veloide:update-settings', patch),

  // Files, folders, search, snapshots
  openFileDialog: () => ipcRenderer.invoke('veloide:open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('veloide:open-folder-dialog'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('veloide:save-file-dialog', defaultName),
  readFile: (filePath) => ipcRenderer.invoke('veloide:read-file', filePath),
  saveFile: (filePath, content, options) =>
    ipcRenderer.invoke('veloide:save-file', filePath, content, options),
  readFolder: (folderPath) => ipcRenderer.invoke('veloide:read-folder', folderPath),
  listFilesFlat: (folderPath) => ipcRenderer.invoke('veloide:list-files-flat', folderPath),
  searchFolder: (folderPath, query, options) =>
    ipcRenderer.invoke('veloide:search-folder', folderPath, query, options),
  listSnapshots: (filePath) => ipcRenderer.invoke('veloide:list-snapshots', filePath),
  readSnapshot: (filePath, snapshotId) =>
    ipcRenderer.invoke('veloide:read-snapshot', filePath, snapshotId),

  // Toolchains & portable prefill
  getRegistrySummary: () => ipcRenderer.invoke('veloide:get-registry-summary'),
  resolveRuntime: (payload) => ipcRenderer.invoke('veloide:resolve-runtime', payload),
  installToolchain: (id) => ipcRenderer.invoke('veloide:install-toolchain', id),
  cancelToolchainInstall: (id) => ipcRenderer.invoke('veloide:cancel-toolchain-install', id),
  removeToolchain: (id) => ipcRenderer.invoke('veloide:remove-toolchain', id),
  listToolchains: () => ipcRenderer.invoke('veloide:list-toolchains'),
  prefillOffline: (payload) => ipcRenderer.invoke('veloide:prefill-offline', payload),
  onToolchainProgress: (cb) => subscribe('veloide:toolchain-progress', cb),

  // Code runner
  runCode: (request) => ipcRenderer.invoke('veloide:run-code', request),
  stopRun: () => ipcRenderer.invoke('veloide:stop-run'),
  sendRunStdin: (text) => ipcRenderer.invoke('veloide:run-stdin', text),
  onRunEvent: (cb) => subscribe('veloide:run-event', cb),

  // Terminal
  terminalExec: (command) => ipcRenderer.invoke('veloide:terminal-exec', command),
  terminalStdin: (text) => ipcRenderer.invoke('veloide:terminal-stdin', text),
  terminalKill: () => ipcRenderer.invoke('veloide:terminal-kill'),
  terminalCwd: (nextCwd) => ipcRenderer.invoke('veloide:terminal-cwd', nextCwd),
  onTerminalEvent: (cb) => subscribe('veloide:terminal-event', cb),

  // Local Qwen2.5-Coder-1.5B autocomplete
  qwenStatus: () => ipcRenderer.invoke('veloide:qwen-status'),
  qwenSetEnabled: (enabled) => ipcRenderer.invoke('veloide:qwen-set-enabled', enabled),
  qwenInstall: () => ipcRenderer.invoke('veloide:qwen-install'),
  qwenCancelInstall: () => ipcRenderer.invoke('veloide:qwen-cancel-install'),
  qwenRemove: () => ipcRenderer.invoke('veloide:qwen-remove'),
  qwenComplete: (params) => ipcRenderer.invoke('veloide:qwen-complete', params),
  onQwenStatus: (cb) => subscribe('veloide:qwen-status', cb),
  onQwenProgress: (cb) => subscribe('veloide:qwen-progress', cb),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('veloide:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('veloide:install-update'),
  onUpdateStatus: (cb) => subscribe('veloide:update-status', cb),
});
