export type ThemeMode = 'light' | 'dark' | 'sepia';

export interface UserSettings {
  theme: ThemeMode;
  fontSize: number;
  sidebarOpen: boolean;
  alwaysAllowInstalls: boolean;
  qwenEnabled: boolean;
  qwenAsked: boolean;
  customRunCommands: Record<string, string>;
  recentFiles: string[];
  lastFolder: string | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
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

export interface SnapshotEntry {
  id: string;
  filePath: string;
  createdAt: number;
  size: number;
  lines: number;
  hash: string;
}

export interface FileReadResult {
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
  size: number;
  snapshots: SnapshotEntry[];
}

export interface FileSaveResult {
  ok: boolean;
  conflict?: boolean;
  diskMtimeMs?: number;
  message?: string;
  path?: string;
  name?: string;
  mtimeMs?: number;
  size?: number;
  snapshots?: SnapshotEntry[];
}

export interface FolderEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: 'dir' | 'file';
  children?: FolderEntry[];
}

export interface FolderTree {
  root: string;
  name: string;
  entries: FolderEntry[];
  truncated?: boolean;
}

export interface FlatFileEntry {
  name: string;
  path: string;
  relativePath: string;
}

export interface SearchHit {
  filePath: string;
  relativePath: string;
  line: number;
  column: number;
  preview: string;
}

export interface EditorTab {
  id: string;
  name: string;
  filePath: string | null;
  languageId: string;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
  isScratch: boolean;
  snapshots: SnapshotEntry[];
}

export interface Diagnostic {
  file?: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  raw: string;
}

export interface ToolchainStatus {
  id: string;
  name: string;
  version: string;
  source: string;
  license: string;
  dependsOn: string[];
  installedManaged: boolean;
  managedBin: string | null;
  systemBin: string | null;
  canDownload: boolean;
  downloadSize: number;
  downloadUrl: string | null;
  packageManagerHint: string | null;
  diskBytes: number;
  languages: string[];
}

export interface RuntimeResolution {
  ready: boolean;
  source: 'builtin' | 'custom' | 'system' | 'managed' | 'missing-managed' | 'missing-system' | 'unknown';
  label?: string;
  toolchainId?: string;
  toolchainName?: string;
  version?: string;
  downloadSource?: string;
  license?: string;
  downloadSize?: number;
  missingDeps?: string[];
  languageName?: string;
  packageManagerHint?: string | null;
  builtinRunner?: string;
}

export interface ToolchainProgressEvent {
  toolchainId: string;
  name: string;
  phase: 'downloading' | 'downloaded' | 'extracting' | 'done';
  percent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  detail?: string;
}

export interface RunEvent {
  type: 'start' | 'stdout' | 'stderr' | 'preview' | 'exit';
  command?: string;
  cwd?: string;
  source?: string;
  text?: string;
  format?: 'html' | 'markdown';
  content?: string;
  code?: number;
  durationMs?: number;
  stage?: 'compile' | 'run';
  cancelled?: boolean;
}

export interface RunResponse {
  ok: boolean;
  code?: number;
  durationMs?: number;
  needsInstall?: boolean;
  missingSystem?: boolean;
  unknownLanguage?: boolean;
  language?: { id: string; name: string; extensions?: string[] } | null;
  runtime?: RuntimeResolution;
}

export interface TerminalEvent {
  type: 'start' | 'stdout' | 'stderr' | 'exit' | 'cwd';
  command?: string;
  cwd?: string;
  text?: string;
  code?: number;
}

export interface QwenStatus {
  enabled: boolean;
  asked: boolean;
  installed: boolean;
  running: boolean;
  loading: boolean;
  installing: boolean;
  canInstall: boolean;
  modelName: string;
  modelSource: string;
  modelLicense: string;
  totalDownloadBytes: number;
  diskBytes: number;
  lowRamWarning: boolean;
  totalRamGb: number;
}

export interface QwenProgressEvent {
  step: 'runtime' | 'model' | 'done';
  label: string;
  downloadedBytes?: number;
  totalBytes?: number;
  percent: number;
  bytesPerSecond?: number;
}

export interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  releaseName?: string;
  percent?: number;
  bytesPerSecond?: number;
  message?: string;
}

export interface DesktopAppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  isPortable: boolean;
  dataRoot: string;
  repoUrl: string;
  releasesUrl: string;
  launchTarget: { path: string; isDirectory: boolean } | null;
}

export interface VeloIdeDesktopBridge {
  getAppInfo: () => Promise<DesktopAppInfo>;
  openExternal: (url: string) => Promise<void>;
  onOpenTarget: (cb: (target: { path: string; isDirectory: boolean }) => void) => () => void;

  getSettings: () => Promise<UserSettings>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<UserSettings>;

  openFileDialog: () => Promise<FileReadResult[]>;
  openFolderDialog: () => Promise<FolderTree | null>;
  saveFileDialog: (defaultName?: string) => Promise<string | null>;
  readFile: (filePath: string) => Promise<FileReadResult>;
  saveFile: (
    filePath: string,
    content: string,
    options?: { expectedMtimeMs?: number | null; force?: boolean }
  ) => Promise<FileSaveResult>;
  readFolder: (folderPath: string) => Promise<FolderTree | null>;
  listFilesFlat: (folderPath: string) => Promise<FlatFileEntry[]>;
  searchFolder: (folderPath: string, query: string, options?: { caseSensitive?: boolean }) => Promise<SearchHit[]>;
  listSnapshots: (filePath: string) => Promise<SnapshotEntry[]>;
  readSnapshot: (filePath: string, snapshotId: string) => Promise<string | null>;

  getRegistrySummary: () => Promise<{
    languages: Array<{ id: string; name: string; extensions: string[]; toolchain: string | null; builtinRunner: string | null }>;
    toolchains: ToolchainStatus[];
  }>;
  resolveRuntime: (payload: {
    filePath: string | null;
    content: string;
    languageId: string;
  }) => Promise<{ language: { id: string; name: string } | null; runtime: RuntimeResolution }>;
  installToolchain: (id: string) => Promise<ToolchainStatus>;
  cancelToolchainInstall: (id: string) => Promise<boolean>;
  removeToolchain: (id: string) => Promise<ToolchainStatus>;
  listToolchains: () => Promise<ToolchainStatus[]>;
  prefillOffline: (payload: { toolchainIds: string[]; includeQwen: boolean }) => Promise<Array<{ id: string; ok: boolean; error?: string }>>;
  onToolchainProgress: (cb: (ev: ToolchainProgressEvent) => void) => () => void;

  runCode: (request: {
    filePath: string | null;
    content: string;
    languageId: string;
    isScratch: boolean;
    workspaceRoot: string | null;
    args?: string;
  }) => Promise<RunResponse>;
  stopRun: () => Promise<boolean>;
  sendRunStdin: (text: string) => Promise<boolean>;
  onRunEvent: (cb: (ev: RunEvent) => void) => () => void;

  terminalExec: (command: string) => Promise<{ code: number; cwd: string }>;
  terminalStdin: (text: string) => Promise<boolean>;
  terminalKill: () => Promise<boolean>;
  terminalCwd: (nextCwd?: string) => Promise<string>;
  onTerminalEvent: (cb: (ev: TerminalEvent) => void) => () => void;

  qwenStatus: () => Promise<QwenStatus>;
  qwenSetEnabled: (enabled: boolean) => Promise<QwenStatus>;
  qwenInstall: () => Promise<QwenStatus>;
  qwenCancelInstall: () => Promise<boolean>;
  qwenRemove: () => Promise<QwenStatus>;
  qwenComplete: (params: {
    prefix: string;
    suffix: string;
    filename: string;
    language: string;
    maxTokens?: number;
  }) => Promise<{ text: string; latencyMs?: number; disabled?: boolean; cancelled?: boolean }>;
  onQwenStatus: (cb: (status: QwenStatus) => void) => () => void;
  onQwenProgress: (cb: (ev: QwenProgressEvent) => void) => () => void;

  checkForUpdates: () => Promise<{ ok: boolean; packaged?: boolean; portable?: boolean; error?: string }>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (cb: (ev: UpdateStatusEvent) => void) => () => void;
}

declare global {
  interface Window {
    veloideDesktop?: VeloIdeDesktopBridge;
  }
}
