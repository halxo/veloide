import './styles/main.css';
import {
  DEFAULT_SETTINGS,
  type DesktopAppInfo,
  type Diagnostic,
  type EditorTab,
  type FileReadResult,
  type FolderTree,
  type QwenStatus,
  type RuntimeResolution,
  type SnapshotEntry,
  type ThemeMode,
  type UserSettings,
} from './model/types';
import { LANGUAGES, detectLanguageFromFilename, getLanguageById } from './model/languages';
import { escapeHtml, formatBytes, generateId } from './model/sanitize';
import { LocalStore } from './storage/localStore';
import { VeloCodeEditor } from './editor/codeEditor';
import { CommandPalette, type PaletteCommand } from './ui/commandPalette';
import { WorkspaceSidebar } from './ui/sidebar';
import { OutputDrawer } from './ui/outputDrawer';
import { PromptBar } from './ui/promptBar';
import { ToolchainModal } from './ui/toolchainModal';
import { StatusFooter } from './ui/statusFooter';
import { UpdateBanner } from './ui/updateBanner';
import { ICONS } from './ui/icons';

class VeloIdeApp {
  private store = new LocalStore();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private appInfo: DesktopAppInfo | null = null;
  private qwenStatus: QwenStatus | null = null;

  private tabs: EditorTab[] = [];
  private activeTabId: string | null = null;
  private folderTree: FolderTree | null = null;
  private currentRuntime: RuntimeResolution | null = null;
  private isRunning = false;
  private runArgs = '';
  private manualUpdateCheck = false;
  private dimTimer: number | null = null;
  private scratchSaveTimer: number | null = null;

  private topbarEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private saveStatusEl!: HTMLElement;
  private saveLabelEl!: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private drawerBtn!: HTMLButtonElement;

  private editor!: VeloCodeEditor;
  private sidebar!: WorkspaceSidebar;
  private drawer!: OutputDrawer;
  private promptBar!: PromptBar;
  private toolchainModal!: ToolchainModal;
  private palette!: CommandPalette;
  private footer!: StatusFooter;
  private banner!: UpdateBanner;

  async init(): Promise<void> {
    this.topbarEl = document.getElementById('vw-topbar') as HTMLElement;
    this.tabsEl = document.getElementById('vi-tabs') as HTMLElement;
    this.saveStatusEl = document.getElementById('vw-save-status') as HTMLElement;
    this.saveLabelEl = this.saveStatusEl.querySelector('.vw-save-label') as HTMLElement;
    this.runBtn = document.getElementById('vi-btn-run') as HTMLButtonElement;
    this.drawerBtn = document.getElementById('vi-btn-drawer') as HTMLButtonElement;

    const sidebarToggleBtn = document.getElementById('vw-btn-toggle-sidebar') as HTMLButtonElement;
    sidebarToggleBtn.innerHTML = ICONS.sidebar;
    const newScratchBtn = document.getElementById('vi-btn-new-scratch') as HTMLButtonElement;
    newScratchBtn.innerHTML = ICONS.plus;
    this.drawerBtn.innerHTML = ICONS.terminal;
    this.renderRunButton();

    this.settings = await this.store.loadSettings();
    this.applyTheme(this.settings.theme, false);

    this.initComponents();
    this.bindGlobalEvents(sidebarToggleBtn, newScratchBtn);

    if (window.veloideDesktop) {
      await this.initDesktopBridge();
    }

    // Boot straight into a file or recovered scratch buffer — zero welcome screens
    if (this.appInfo?.launchTarget) {
      await this.handleOpenTarget(this.appInfo.launchTarget);
    } else {
      const recovered = this.store.loadScratchRecovery();
      if (recovered.length > 0) {
        for (const item of recovered) {
          this.tabs.push({
            id: item.id,
            name: item.name,
            filePath: null,
            languageId: item.languageId,
            content: item.content,
            savedContent: item.content,
            mtimeMs: null,
            isScratch: true,
            snapshots: [],
          });
        }
        this.activateTab(this.tabs[0].id);
      } else {
        this.createScratchTab('typescript');
      }
    }

    // Offer Qwen2.5-Coder-1.5B once on first desktop launch if not yet asked
    if (this.qwenStatus && !this.qwenStatus.asked && !this.qwenStatus.installed && this.qwenStatus.canInstall) {
      this.showQwenFirstPrompt();
    }
  }

  private initComponents(): void {
    const editorHost = document.getElementById('vi-editor-host') as HTMLElement;
    const sidebarEl = document.getElementById('vw-sidebar') as HTMLElement;
    const drawerEl = document.getElementById('vi-drawer') as HTMLElement;
    const promptEl = document.getElementById('vi-prompt-bar') as HTMLElement;
    const footerEl = document.getElementById('vw-footer') as HTMLElement;

    this.promptBar = new PromptBar(promptEl);
    this.banner = new UpdateBanner(() => {
      void window.veloideDesktop?.installUpdate();
    });

    this.footer = new StatusFooter(footerEl, {
      onClickLanguage: () => this.openLanguagePicker(),
      onClickToolchain: () => void this.openToolchainModal('manage'),
      onClickQwen: () => void this.handleQwenFooterClick(),
    });

    this.sidebar = new WorkspaceSidebar(sidebarEl, {
      onOpenFile: () => void this.openFileDialog(),
      onOpenFolder: () => void this.openFolderDialog(),
      onSelectFile: (filePath) => void this.openFilePath(filePath),
      onSearch: async (query) => {
        if (!window.veloideDesktop || !this.folderTree) return [];
        return window.veloideDesktop.searchFolder(this.folderTree.root, query);
      },
      onSelectSearchHit: (hit) => {
        void this.openFilePath(hit.filePath).then(() => {
          this.editor.jumpToLocation(hit.line, hit.column);
        });
      },
      onRestoreSnapshot: (snap) => void this.restoreSnapshot(snap),
    });
    this.sidebar.setOpen(this.settings.sidebarOpen);

    this.drawer = new OutputDrawer(drawerEl, {
      onSendStdin: (text) => void window.veloideDesktop?.sendRunStdin(text),
      onTerminalExec: (cmd) => void window.veloideDesktop?.terminalExec(cmd),
      onTerminalKill: () => void window.veloideDesktop?.terminalKill(),
      onJumpDiagnostic: (diag) => void this.jumpToDiagnostic(diag),
      onDiagnosticsUpdated: (diags) => this.editor.setDiagnostics(diags),
      onArgsChange: (args) => {
        this.runArgs = args;
      },
    });

    this.editor = new VeloCodeEditor(editorHost, {
      onChange: (content) => this.handleEditorChange(content),
      onCursorChange: (info) => this.footer.updateCursor(info),
      onTypingActivity: () => this.handleTypingActivity(),
      onLatencySample: (ms) => this.footer.updateLatency(ms),
      isQwenEnabled: () => Boolean(this.qwenStatus?.enabled && this.qwenStatus?.installed),
      getActiveContext: () => {
        const tab = this.getActiveTab();
        return {
          filename: tab?.name ?? 'scratch.ts',
          language: tab?.languageId ?? 'typescript',
        };
      },
      requestQwenCompletion: async (params) => {
        if (!window.veloideDesktop) return '';
        const res = await window.veloideDesktop.qwenComplete(params);
        return res.text || '';
      },
      onQwenActivity: (state) => this.footer.updateQwen(this.qwenStatus, state),
    });
    this.editor.applyTheme(this.settings.theme);
    this.editor.applyFontSize(this.settings.fontSize);

    this.toolchainModal = new ToolchainModal({
      onInstallToolchain: (id) => this.installToolchainWithProgress(id),
      onRemoveToolchain: async (id) => {
        if (!window.veloideDesktop) return;
        await window.veloideDesktop.removeToolchain(id);
        this.banner.showToast(`Removed ${id} from VeloIde storage`);
        await this.refreshRuntimeForActiveTab();
        const list = await window.veloideDesktop.listToolchains();
        this.toolchainModal.refresh(list, this.qwenStatus);
      },
      onInstallQwen: () => this.installQwenWithProgress(),
      onToggleQwen: async (enabled) => {
        if (!window.veloideDesktop) return;
        this.qwenStatus = await window.veloideDesktop.qwenSetEnabled(enabled);
        this.footer.updateQwen(this.qwenStatus);
        const list = await window.veloideDesktop.listToolchains();
        this.toolchainModal.refresh(list, this.qwenStatus);
      },
      onRemoveQwen: async () => {
        if (!window.veloideDesktop) return;
        this.qwenStatus = await window.veloideDesktop.qwenRemove();
        this.footer.updateQwen(this.qwenStatus);
        this.banner.showToast('Removed Qwen2.5-Coder-1.5B model');
        const list = await window.veloideDesktop.listToolchains();
        this.toolchainModal.refresh(list, this.qwenStatus);
      },
      onPrefillOffline: (ids, includeQwen) => this.runOfflinePrefill(ids, includeQwen),
    });

    this.palette = new CommandPalette(() => this.buildPaletteCommands());
  }

  private async initDesktopBridge(): Promise<void> {
    const bridge = window.veloideDesktop;
    if (!bridge) return;

    this.appInfo = await bridge.getAppInfo();
    this.footer.setPortable(this.appInfo.isPortable);
    this.toolchainModal.setAppContext(this.appInfo.dataRoot, this.appInfo.isPortable);

    this.qwenStatus = await bridge.qwenStatus();
    this.footer.updateQwen(this.qwenStatus);

    const cwd = await bridge.terminalCwd();
    this.drawer.setTerminalCwd(cwd);

    bridge.onOpenTarget((target) => void this.handleOpenTarget(target));

    bridge.onRunEvent((ev) => {
      if (ev.type === 'start') {
        this.isRunning = true;
        this.renderRunButton();
      } else if (ev.type === 'exit') {
        this.isRunning = false;
        this.renderRunButton();
      }
      this.drawer.handleRunEvent(ev);
    });

    bridge.onTerminalEvent((ev) => this.drawer.handleTerminalEvent(ev));

    bridge.onQwenStatus((st) => {
      this.qwenStatus = st;
      this.footer.updateQwen(st);
    });

    bridge.onUpdateStatus((ev) => {
      this.banner.showStatus(ev, this.manualUpdateCheck);
      if (ev.status === 'up-to-date' || ev.status === 'error' || ev.status === 'downloaded') {
        this.manualUpdateCheck = false;
      }
    });

    // Reopen last folder quietly if available
    if (this.settings.lastFolder) {
      try {
        const tree = await bridge.readFolder(this.settings.lastFolder);
        if (tree) {
          this.folderTree = tree;
          this.sidebar.setFolderTree(tree);
        }
      } catch {
        // ignore stale folder
      }
    }
  }

  private bindGlobalEvents(sidebarToggleBtn: HTMLButtonElement, newScratchBtn: HTMLButtonElement): void {
    sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());
    newScratchBtn.addEventListener('click', () => this.openNewScratchPicker());
    this.runBtn.addEventListener('click', () => {
      if (this.isRunning) void this.stopActiveRun();
      else void this.runActiveTab();
    });
    this.drawerBtn.addEventListener('click', () => this.drawer.toggle());
    document.getElementById('vw-btn-palette')?.addEventListener('click', () => this.palette.open());

    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (e.key === 'F5' && !e.shiftKey) {
        e.preventDefault();
        void this.runActiveTab();
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        void this.stopActiveRun();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        void this.runActiveTab();
      } else if (mod && key === 'k') {
        e.preventDefault();
        this.palette.toggle();
      } else if (mod && e.shiftKey && key === 'p') {
        e.preventDefault();
        this.palette.open();
      } else if (mod && !e.shiftKey && key === 'p') {
        e.preventDefault();
        void this.openQuickFilePicker();
      } else if (mod && key === 's') {
        e.preventDefault();
        void this.saveActiveTab();
      } else if (mod && !e.shiftKey && key === 'o') {
        e.preventDefault();
        void this.openFileDialog();
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault();
        void this.openFolderDialog();
      } else if (mod && key === 'n') {
        e.preventDefault();
        this.createScratchTab(this.getActiveTab()?.languageId ?? 'typescript');
      } else if (mod && key === 'w') {
        e.preventDefault();
        if (this.activeTabId) this.closeTab(this.activeTabId);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (mod && e.key === '`') {
        e.preventDefault();
        this.drawer.toggle();
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        this.setSidebarOpen(true);
        this.sidebar.switchTab('search');
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.adjustFontSize(1);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        this.adjustFontSize(-1);
      }
    });

    window.addEventListener(
      'mousemove',
      () => {
        if (this.topbarEl.classList.contains('is-dimmed')) {
          this.topbarEl.classList.remove('is-dimmed');
        }
      },
      { passive: true }
    );

    window.addEventListener('beforeunload', () => {
      this.store.saveScratchRecovery(this.tabs);
    });
  }

  private handleTypingActivity(): void {
    if (!this.topbarEl.classList.contains('is-dimmed')) {
      this.topbarEl.classList.add('is-dimmed');
    }
    if (this.dimTimer !== null) window.clearTimeout(this.dimTimer);
    this.dimTimer = window.setTimeout(() => {
      this.topbarEl.classList.remove('is-dimmed');
      this.dimTimer = null;
    }, 3500);
  }

  private getActiveTab(): EditorTab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  private createScratchTab(languageId: string): void {
    const lang = getLanguageById(languageId);
    const scratchNum = this.tabs.filter((t) => t.isScratch).length + 1;
    const name = scratchNum === 1 ? `scratch${lang.defaultExt}` : `scratch-${scratchNum}${lang.defaultExt}`;
    const tab: EditorTab = {
      id: generateId(),
      name,
      filePath: null,
      languageId: lang.id,
      content: lang.starter,
      savedContent: lang.starter,
      mtimeMs: null,
      isScratch: true,
      snapshots: [],
    };
    this.tabs.push(tab);
    this.activateTab(tab.id);
    this.store.saveScratchRecovery(this.tabs);
  }

  private openFileFromResult(res: FileReadResult): void {
    const existing = this.tabs.find((t) => t.filePath === res.path);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }

    const lang = detectLanguageFromFilename(res.name, res.content);
    const tab: EditorTab = {
      id: generateId(),
      name: res.name,
      filePath: res.path,
      languageId: lang.id,
      content: res.content,
      savedContent: res.content,
      mtimeMs: res.mtimeMs,
      isScratch: false,
      snapshots: res.snapshots || [],
    };

    // Replace untouched initial scratch tab cleanly so there's zero clutter
    if (
      this.tabs.length === 1 &&
      this.tabs[0].isScratch &&
      this.tabs[0].content === this.tabs[0].savedContent
    ) {
      this.editor.disposeTab(this.tabs[0].id);
      this.tabs = [tab];
    } else {
      this.tabs.push(tab);
    }

    this.activateTab(tab.id);
  }

  private activateTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    this.activeTabId = tab.id;
    this.editor.switchToTab(tab.id, tab.content, tab.languageId);
    this.renderTabs();
    this.updateSaveBadge();
    this.footer.updateLanguage(getLanguageById(tab.languageId).name);
    this.sidebar.setActiveFile(tab.filePath, tab.snapshots);
    document.title = `${tab.name} — VeloIde`;
    void this.refreshRuntimeForActiveTab();
  }

  private closeTab(tabId: string): void {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    this.editor.disposeTab(tabId);
    this.store.saveScratchRecovery(this.tabs);

    if (this.tabs.length === 0) {
      this.createScratchTab('typescript');
      return;
    }
    if (this.activeTabId === tabId) {
      const next = this.tabs[Math.max(0, idx - 1)];
      this.activateTab(next.id);
    } else {
      this.renderTabs();
    }
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = '';
    for (const tab of this.tabs) {
      const isDirty = !tab.isScratch && tab.content !== tab.savedContent;
      const el = document.createElement('div');
      el.className = `vi-tab${tab.id === this.activeTabId ? ' is-active' : ''}`;
      el.setAttribute('role', 'tab');
      el.title = tab.filePath || `${tab.name} (scratch buffer)`;
      el.innerHTML = `
        <span class="vi-tab-name">${escapeHtml(tab.name)}</span>
        ${isDirty ? '<span class="vi-tab-dirty" aria-label="Unsaved"></span>' : ''}
        <button type="button" class="vi-tab-close" aria-label="Close ${escapeHtml(tab.name)}">${ICONS.close}</button>
      `;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.vi-tab-close')) {
          this.closeTab(tab.id);
          return;
        }
        this.activateTab(tab.id);
      });
      this.tabsEl.appendChild(el);
    }
  }

  private handleEditorChange(content: string): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    const wasDirty = tab.content !== tab.savedContent;
    tab.content = content;
    const isDirty = tab.content !== tab.savedContent;
    if (wasDirty !== isDirty) {
      this.renderTabs();
      this.updateSaveBadge();
    }
    if (tab.isScratch) {
      if (this.scratchSaveTimer !== null) window.clearTimeout(this.scratchSaveTimer);
      this.scratchSaveTimer = window.setTimeout(() => {
        this.store.saveScratchRecovery(this.tabs);
      }, 600);
    }
  }

  private updateSaveBadge(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    if (tab.isScratch) {
      this.saveStatusEl.classList.remove('is-unsaved');
      this.saveLabelEl.textContent = 'Scratch';
    } else if (tab.content !== tab.savedContent) {
      this.saveStatusEl.classList.add('is-unsaved');
      this.saveLabelEl.textContent = 'Unsaved';
    } else {
      this.saveStatusEl.classList.remove('is-unsaved');
      this.saveLabelEl.textContent = 'Saved';
    }
  }

  private renderRunButton(): void {
    if (this.isRunning) {
      this.runBtn.classList.add('is-running');
      this.runBtn.innerHTML = `${ICONS.stop}<span>Stop</span>`;
      this.runBtn.title = 'Stop running process (Shift+F5)';
    } else {
      this.runBtn.classList.remove('is-running');
      this.runBtn.innerHTML = `${ICONS.play}<span>Run</span>`;
      this.runBtn.title = 'Run current file (F5 or Ctrl+Enter)';
    }
  }

  private async handleOpenTarget(target: { path: string; isDirectory: boolean }): Promise<void> {
    if (!window.veloideDesktop) return;
    if (target.isDirectory) {
      const tree = await window.veloideDesktop.readFolder(target.path);
      if (tree) {
        this.folderTree = tree;
        this.sidebar.setFolderTree(tree);
        this.setSidebarOpen(true);
        this.drawer.setTerminalCwd(tree.root);
      }
      if (this.tabs.length === 0) this.createScratchTab('typescript');
    } else {
      await this.openFilePath(target.path);
    }
  }

  private async openFileDialog(): Promise<void> {
    if (!window.veloideDesktop) {
      this.banner.showToast('File dialogs require the VeloIde desktop app', true);
      return;
    }
    const files = await window.veloideDesktop.openFileDialog();
    for (const f of files) {
      this.openFileFromResult(f);
    }
  }

  private async openFolderDialog(): Promise<void> {
    if (!window.veloideDesktop) {
      this.banner.showToast('Folder browsing requires the VeloIde desktop app', true);
      return;
    }
    const tree = await window.veloideDesktop.openFolderDialog();
    if (!tree) return;
    this.folderTree = tree;
    this.sidebar.setFolderTree(tree);
    this.setSidebarOpen(true);
    this.drawer.setTerminalCwd(tree.root);
  }

  private async openFilePath(filePath: string): Promise<void> {
    if (!window.veloideDesktop) return;
    try {
      const res = await window.veloideDesktop.readFile(filePath);
      this.openFileFromResult(res);
    } catch (err) {
      this.banner.showToast(err instanceof Error ? err.message : 'Could not open file', true);
    }
  }

  private async saveActiveTab(force = false): Promise<boolean> {
    const tab = this.getActiveTab();
    if (!tab) return false;
    if (!window.veloideDesktop) {
      this.store.saveScratchRecovery(this.tabs);
      tab.savedContent = tab.content;
      this.updateSaveBadge();
      return true;
    }

    let targetPath = tab.filePath;
    if (!targetPath) {
      targetPath = await window.veloideDesktop.saveFileDialog(tab.name);
      if (!targetPath) return false;
    }

    const res = await window.veloideDesktop.saveFile(targetPath, tab.content, {
      expectedMtimeMs: tab.mtimeMs,
      force,
    });

    if (res.conflict) {
      this.promptBar.showConfirm({
        message: `${tab.name} changed on disk since you opened it.`,
        detail: 'Reload the disk version or overwrite (previous version stays in History).',
        actions: [
          {
            label: 'Reload from disk',
            onClick: () => {
              this.promptBar.hide();
              if (tab.filePath) {
                void window.veloideDesktop?.readFile(tab.filePath).then((fresh) => {
                  tab.content = fresh.content;
                  tab.savedContent = fresh.content;
                  tab.mtimeMs = fresh.mtimeMs;
                  tab.snapshots = fresh.snapshots;
                  this.editor.replaceContent(fresh.content);
                  this.updateSaveBadge();
                  this.sidebar.setActiveFile(tab.filePath, tab.snapshots);
                });
              }
            },
          },
          {
            label: 'Overwrite',
            primary: true,
            onClick: () => {
              this.promptBar.hide();
              void this.saveActiveTab(true);
            },
          },
          { label: 'Cancel', onClick: () => this.promptBar.hide() },
        ],
      });
      return false;
    }

    if (res.ok && res.path) {
      tab.filePath = res.path;
      tab.name = res.name || tab.name;
      tab.isScratch = false;
      tab.savedContent = tab.content;
      tab.mtimeMs = res.mtimeMs ?? tab.mtimeMs;
      tab.snapshots = res.snapshots ?? tab.snapshots;
      const detected = detectLanguageFromFilename(tab.name, tab.content);
      if (detected.id !== tab.languageId) {
        tab.languageId = detected.id;
        this.editor.setLanguage(detected.id);
        this.footer.updateLanguage(detected.name);
      }
      this.renderTabs();
      this.updateSaveBadge();
      this.sidebar.setActiveFile(tab.filePath, tab.snapshots);
      document.title = `${tab.name} — VeloIde`;
      void this.refreshRuntimeForActiveTab();
      return true;
    }

    return false;
  }

  private async restoreSnapshot(snap: SnapshotEntry): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !tab.filePath || !window.veloideDesktop) return;
    const prev = await window.veloideDesktop.readSnapshot(tab.filePath, snap.id);
    if (prev === null) return;
    tab.content = prev;
    this.editor.replaceContent(prev);
    this.renderTabs();
    this.updateSaveBadge();
    this.banner.showToast('Restored snapshot — press Ctrl+S to save');
  }

  private async refreshRuntimeForActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !window.veloideDesktop) {
      this.footer.updateRuntime(null);
      return;
    }
    const res = await window.veloideDesktop.resolveRuntime({
      filePath: tab.filePath ?? tab.name,
      content: tab.content,
      languageId: tab.languageId,
    });
    this.currentRuntime = res.runtime;
    this.footer.updateRuntime(res.runtime);
  }

  /**
   * The core VeloIde loop: press F5 → runs immediately if compiler exists,
   * or offers a calm one-line install prompt and then runs automatically.
   */
  private async runActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;

    if (!window.veloideDesktop) {
      // In web preview mode, still run HTML/Markdown/JSON built-in previews!
      if (tab.languageId === 'html' || tab.languageId === 'markdown') {
        this.drawer.handleRunEvent({
          type: 'preview',
          format: tab.languageId,
          content: tab.content,
        });
        this.drawer.handleRunEvent({ type: 'exit', code: 0, durationMs: 1 });
        return;
      }
      this.banner.showToast('Download VeloIde Desktop to compile & run code locally', true);
      return;
    }

    // Auto-save real dirty files before running so the compiler sees latest edits
    if (!tab.isScratch && tab.filePath && tab.content !== tab.savedContent) {
      await this.saveActiveTab();
    }

    this.editor.clearDiagnostics();

    const response = await window.veloideDesktop.runCode({
      filePath: tab.filePath ?? tab.name,
      content: tab.content,
      languageId: tab.languageId,
      isScratch: tab.isScratch,
      workspaceRoot: this.folderTree?.root ?? null,
      args: this.runArgs,
    });

    const toolchainId = response.runtime?.toolchainId;
    if (response.needsInstall && response.runtime && toolchainId) {
      const rt = response.runtime;

      if (this.settings.alwaysAllowInstalls) {
        await this.installToolchainWithProgress(toolchainId, true);
        return;
      }

      const sizeText = rt.downloadSize ? formatBytes(rt.downloadSize) : 'official archive';
      const depNote =
        rt.missingDeps && rt.missingDeps.length > 0 ? ` + ${rt.missingDeps.join(', ')}` : '';
      const doInstall = () => {
        this.promptBar.hide();
        void this.installToolchainWithProgress(toolchainId, true);
      };

      this.promptBar.showConfirm({
        message: `Install ${rt.toolchainName} ${rt.version ?? ''}${depNote} (${sizeText})?`,
        detail: `${rt.downloadSource ?? ''} · ${rt.license ?? ''} · isolated in VeloIde`,
        onEnter: doInstall,
        actions: [
          { label: 'Install (Enter)', primary: true, onClick: doInstall },
          {
            label: 'Always allow',
            onClick: () => {
              this.promptBar.hide();
              this.settings.alwaysAllowInstalls = true;
              void this.store.saveSettings({ alwaysAllowInstalls: true });
              void this.installToolchainWithProgress(toolchainId, true);
            },
          },
          { label: 'Cancel', onClick: () => this.promptBar.hide() },
        ],
      });
      return;
    }

    if (response.missingSystem || response.unknownLanguage) {
      const ext = tab.name.includes('.') ? tab.name.slice(tab.name.lastIndexOf('.')).toLowerCase() : '.txt';
      const hint = response.runtime?.packageManagerHint;
      this.promptBar.showCustomCommandInput({
        message: `${response.runtime?.languageName ?? ext} compiler not found.`,
        detail: hint ? `System install: ${hint} — or set a run command for ${ext}:` : `Set a run command for ${ext}:`,
        placeholder: `e.g. mycompiler {file}`,
        initialValue: this.settings.customRunCommands[ext] ?? '',
        onSubmit: (cmd) => {
          const updated = { ...this.settings.customRunCommands, [ext]: cmd };
          this.settings.customRunCommands = updated;
          void this.store.saveSettings({ customRunCommands: updated }).then(() => {
            void this.refreshRuntimeForActiveTab();
            void this.runActiveTab();
          });
        },
      });
    }
  }

  private async stopActiveRun(): Promise<void> {
    if (!window.veloideDesktop) return;
    await window.veloideDesktop.stopRun();
    this.isRunning = false;
    this.renderRunButton();
  }

  private async installToolchainWithProgress(toolchainId: string, runAfter = false): Promise<void> {
    if (!window.veloideDesktop) return;
    const unsub = window.veloideDesktop.onToolchainProgress((p) => {
      const label =
        p.phase === 'extracting'
          ? p.detail || `Extracting ${p.name}…`
          : `Downloading ${p.name}…`;
      this.promptBar.showProgress({
        label,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
        onCancel: () => void window.veloideDesktop?.cancelToolchainInstall(toolchainId),
      });
    });

    try {
      await window.veloideDesktop.installToolchain(toolchainId);
      this.promptBar.hide();
      await this.refreshRuntimeForActiveTab();
      this.banner.showToast(`Installed ${toolchainId} into VeloIde`);
      if (runAfter) {
        await this.runActiveTab();
      }
    } catch (err) {
      this.promptBar.hide();
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('cancelled')) {
        this.banner.showToast(msg, true);
      }
    } finally {
      unsub();
    }
  }

  private showQwenFirstPrompt(): void {
    if (!this.qwenStatus) return;
    const size = formatBytes(this.qwenStatus.totalDownloadBytes);
    const ramWarn = this.qwenStatus.lowRamWarning
      ? ` (${this.qwenStatus.totalRamGb} GB RAM detected — may be slow)`
      : '';
    this.promptBar.showConfirm({
      message: `Enable local Qwen2.5-Coder-1.5B autocomplete (${size})?${ramWarn}`,
      detail: '100% offline ghost-text completion · Apache-2.0 · toggle or disable anytime',
      actions: [
        {
          label: 'Enable & Download',
          primary: true,
          onClick: () => {
            this.promptBar.hide();
            void this.installQwenWithProgress();
          },
        },
        {
          label: 'Disable',
          onClick: () => {
            this.promptBar.hide();
            void window.veloideDesktop?.qwenSetEnabled(false).then((st) => {
              this.qwenStatus = st;
              this.footer.updateQwen(st);
            });
          },
        },
      ],
    });
  }

  private async handleQwenFooterClick(): Promise<void> {
    if (!window.veloideDesktop || !this.qwenStatus) {
      this.banner.showToast('Local Qwen2.5-Coder-1.5B runs in the desktop app', true);
      return;
    }
    if (this.qwenStatus.installing) return;
    if (!this.qwenStatus.installed) {
      this.showQwenFirstPrompt();
      return;
    }
    this.qwenStatus = await window.veloideDesktop.qwenSetEnabled(!this.qwenStatus.enabled);
    this.footer.updateQwen(this.qwenStatus);
    this.banner.showToast(
      this.qwenStatus.enabled ? 'Qwen2.5-Coder-1.5B autocomplete enabled' : 'Autocomplete disabled'
    );
  }

  private async installQwenWithProgress(): Promise<void> {
    if (!window.veloideDesktop) return;
    const unsub = window.veloideDesktop.onQwenProgress((p) => {
      this.promptBar.showProgress({
        label: p.label,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
        onCancel: () => void window.veloideDesktop?.qwenCancelInstall(),
      });
    });

    try {
      this.qwenStatus = await window.veloideDesktop.qwenInstall();
      this.promptBar.hide();
      this.footer.updateQwen(this.qwenStatus);
      this.banner.showToast('Qwen2.5-Coder-1.5B ready — type to see ghost text, Tab to accept');
    } catch (err) {
      this.promptBar.hide();
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('cancelled')) {
        this.banner.showToast(msg, true);
      }
    } finally {
      unsub();
    }
  }

  private async runOfflinePrefill(toolchainIds: string[], includeQwen: boolean): Promise<void> {
    if (!window.veloideDesktop || (toolchainIds.length === 0 && !includeQwen)) return;

    const unsubTc = window.veloideDesktop.onToolchainProgress((p) => {
      this.promptBar.showProgress({
        label: `Prefill: ${p.name} (${p.phase})…`,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
      });
    });
    const unsubQ = window.veloideDesktop.onQwenProgress((p) => {
      this.promptBar.showProgress({
        label: `Prefill: ${p.label}`,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
      });
    });

    try {
      const results = await window.veloideDesktop.prefillOffline({ toolchainIds, includeQwen });
      this.promptBar.hide();
      const okCount = results.filter((r) => r.ok).length;
      this.banner.showToast(`Offline prefill complete: ${okCount}/${results.length} installed`);
      await this.refreshRuntimeForActiveTab();
      this.qwenStatus = await window.veloideDesktop.qwenStatus();
      this.footer.updateQwen(this.qwenStatus);
    } finally {
      unsubTc();
      unsubQ();
    }
  }

  private async openToolchainModal(mode: 'manage' | 'prefill'): Promise<void> {
    if (!window.veloideDesktop) {
      this.banner.showToast('Toolchain management requires the desktop app', true);
      return;
    }
    const list = await window.veloideDesktop.listToolchains();
    this.qwenStatus = await window.veloideDesktop.qwenStatus();
    this.toolchainModal.open(mode, list, this.qwenStatus);
  }

  private async jumpToDiagnostic(diag: Diagnostic): Promise<void> {
    const active = this.getActiveTab();
    if (diag.file && active?.filePath && !active.filePath.endsWith(diag.file)) {
      if (this.folderTree && window.veloideDesktop) {
        const candidate = diag.file.includes('/') || diag.file.includes('\\')
          ? diag.file
          : `${this.folderTree.root}/${diag.file}`;
        try {
          await this.openFilePath(candidate);
        } catch {
          // stay on active file if scratch/temp path
        }
      }
    }
    this.editor.jumpToLocation(diag.line, diag.column);
  }

  private openLanguagePicker(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    const items: PaletteCommand[] = LANGUAGES.map((l) => ({
      id: `lang-${l.id}`,
      section: 'Switch Language',
      label: l.name,
      subtitle: l.extensions.join(', '),
      icon: ICONS.code,
      keywords: [l.id, ...l.extensions],
      run: () => {
        tab.languageId = l.id;
        if (tab.isScratch) {
          tab.name = `scratch${l.defaultExt}`;
        }
        this.editor.setLanguage(l.id);
        this.footer.updateLanguage(l.name);
        this.renderTabs();
        void this.refreshRuntimeForActiveTab();
      },
    }));
    this.palette.open(items, 'Select language for current buffer…');
  }

  private openNewScratchPicker(): void {
    const items: PaletteCommand[] = LANGUAGES.map((l) => ({
      id: `scratch-${l.id}`,
      section: 'New Scratch Buffer (type & press F5)',
      label: l.name,
      subtitle: `New ${l.defaultExt} scratch buffer`,
      icon: ICONS.bolt,
      keywords: [l.id, l.defaultExt, ...l.extensions],
      run: () => this.createScratchTab(l.id),
    }));
    this.palette.open(items, 'Pick a language for a new scratch buffer…');
  }

  private async openQuickFilePicker(): Promise<void> {
    if (!window.veloideDesktop || !this.folderTree) {
      await this.openFileDialog();
      return;
    }
    const files = await window.veloideDesktop.listFilesFlat(this.folderTree.root);
    const items: PaletteCommand[] = files.map((f) => ({
      id: `qf-${f.path}`,
      section: `Files in ${this.folderTree!.name}`,
      label: f.name,
      subtitle: f.relativePath,
      icon: ICONS.file,
      keywords: [f.relativePath],
      run: () => void this.openFilePath(f.path),
    }));
    this.palette.open(items, `Go to file in ${this.folderTree.name}…`);
  }

  private toggleSidebar(): void {
    this.setSidebarOpen(!this.settings.sidebarOpen);
  }

  private setSidebarOpen(open: boolean): void {
    this.settings.sidebarOpen = open;
    this.sidebar.setOpen(open);
    void this.store.saveSettings({ sidebarOpen: open });
  }

  private applyTheme(theme: ThemeMode, persist = true): void {
    this.settings.theme = theme;
    document.documentElement.dataset.theme = theme;
    if (this.editor) this.editor.applyTheme(theme);
    if (persist) void this.store.saveSettings({ theme });
  }

  private adjustFontSize(delta: number): void {
    const next = Math.max(11, Math.min(24, this.settings.fontSize + delta));
    this.settings.fontSize = next;
    this.editor.applyFontSize(next);
    void this.store.saveSettings({ fontSize: next });
  }

  private buildPaletteCommands(): PaletteCommand[] {
    const tab = this.getActiveTab();
    const qwenOn = Boolean(this.qwenStatus?.enabled && this.qwenStatus?.installed);

    const commands: PaletteCommand[] = [
      {
        id: 'run-code',
        section: 'Run & Code',
        label: this.isRunning ? 'Stop Running Process' : 'Run Current File',
        subtitle: this.currentRuntime?.label
          ? `Runner: ${this.currentRuntime.label}`
          : 'Auto-detects compiler or installs on demand',
        shortcut: 'F5',
        icon: this.isRunning ? ICONS.stop : ICONS.play,
        keywords: ['execute', 'compile', 'build', 'start'],
        run: () => (this.isRunning ? void this.stopActiveRun() : void this.runActiveTab()),
      },
      {
        id: 'new-scratch',
        section: 'Run & Code',
        label: 'New Scratch Buffer (Pick Language)',
        subtitle: 'Open a throwaway buffer in any of 45+ languages — no file needed',
        shortcut: 'Ctrl+N',
        icon: ICONS.bolt,
        keywords: ['scratch', 'playground', 'snippet', 'new'],
        run: () => this.openNewScratchPicker(),
      },
      {
        id: 'switch-language',
        section: 'Run & Code',
        label: 'Change Language Mode',
        subtitle: tab ? `Current: ${getLanguageById(tab.languageId).name}` : undefined,
        icon: ICONS.code,
        keywords: ['syntax', 'mode', 'compiler'],
        run: () => this.openLanguagePicker(),
      },
      {
        id: 'set-custom-cmd',
        section: 'Run & Code',
        label: 'Set Custom Run Command for Extension',
        subtitle: 'Override or support any esoteric/custom compiler in one line',
        icon: ICONS.terminal,
        keywords: ['custom', 'command', 'compiler', 'recipe'],
        run: () => {
          if (!tab) return;
          const ext = tab.name.includes('.')
            ? tab.name.slice(tab.name.lastIndexOf('.')).toLowerCase()
            : '.txt';
          this.promptBar.showCustomCommandInput({
            message: `Custom run command for ${ext} files`,
            detail: 'Use {file}, {out}, {dir} placeholders',
            placeholder: 'e.g. mycompiler {file}',
            initialValue: this.settings.customRunCommands[ext] ?? '',
            onSubmit: (cmd) => {
              const updated = { ...this.settings.customRunCommands, [ext]: cmd };
              this.settings.customRunCommands = updated;
              void this.store.saveSettings({ customRunCommands: updated }).then(() => {
                void this.refreshRuntimeForActiveTab();
                this.banner.showToast(`Saved run command for ${ext}`);
              });
            },
          });
        },
      },
      {
        id: 'toggle-terminal',
        section: 'Run & Code',
        label: 'Open Terminal (All VeloIde Compilers on PATH)',
        subtitle: 'Interactive workspace shell with managed compilers ready',
        shortcut: 'Ctrl+`',
        icon: ICONS.terminal,
        keywords: ['shell', 'console', 'output', 'bash', 'powershell'],
        run: () => this.drawer.setOpen(true, 'terminal'),
      },

      // Files
      {
        id: 'open-file',
        section: 'Files',
        label: 'Open File…',
        shortcut: 'Ctrl+O',
        icon: ICONS.file,
        keywords: ['browse', 'load'],
        run: () => void this.openFileDialog(),
      },
      {
        id: 'open-folder',
        section: 'Files',
        label: 'Open Folder…',
        shortcut: 'Ctrl+Shift+O',
        icon: ICONS.folder,
        keywords: ['project', 'directory', 'repo'],
        run: () => void this.openFolderDialog(),
      },
      {
        id: 'quick-open',
        section: 'Files',
        label: 'Go to File in Folder',
        shortcut: 'Ctrl+P',
        icon: ICONS.search,
        keywords: ['find file', 'jump'],
        run: () => void this.openQuickFilePicker(),
      },
      {
        id: 'search-folder',
        section: 'Files',
        label: 'Search Across Folder',
        shortcut: 'Ctrl+Shift+F',
        icon: ICONS.search,
        keywords: ['ripgrep', 'grep', 'find'],
        run: () => {
          this.setSidebarOpen(true);
          this.sidebar.switchTab('search');
        },
      },
      {
        id: 'save-file',
        section: 'Files',
        label: 'Save File',
        subtitle: 'Guarded atomic save with 3-snapshot local history',
        shortcut: 'Ctrl+S',
        icon: ICONS.save,
        keywords: ['write', 'disk'],
        run: () => void this.saveActiveTab(),
      },
      {
        id: 'show-history',
        section: 'Files',
        label: 'Local Snapshot History (3 per file)',
        icon: ICONS.history,
        keywords: ['recovery', 'restore', 'undo', 'backup'],
        run: () => {
          this.setSidebarOpen(true);
          this.sidebar.switchTab('history');
        },
      },

      // Toolchains & Qwen
      {
        id: 'manage-toolchains',
        section: 'Toolchains & Autocomplete',
        label: 'Toolchains: Show / Install / Remove',
        subtitle: 'Inspect disk usage and manage isolated compilers & Qwen 1.5B',
        icon: ICONS.package,
        keywords: ['compiler', 'sdk', 'disk', 'uninstall', 'manage'],
        run: () => void this.openToolchainModal('manage'),
      },
      {
        id: 'portable-prefill',
        section: 'Toolchains & Autocomplete',
        label: 'Portable: Prepare for Offline (Prefill Compilers)',
        subtitle: 'Download selected compilers & Qwen into local folder / USB stick',
        icon: ICONS.usb,
        keywords: ['usb', 'offline', 'airgap', 'prefill', 'portable'],
        run: () => void this.openToolchainModal('prefill'),
      },
      {
        id: 'toggle-qwen',
        section: 'Toolchains & Autocomplete',
        label: qwenOn
          ? 'Autocomplete: Disable Qwen2.5-Coder-1.5B'
          : 'Autocomplete: Enable Qwen2.5-Coder-1.5B',
        subtitle: this.qwenStatus?.installed
          ? '100% local FIM ghost-text completion via llama.cpp'
          : 'Downloads Qwen2.5-Coder-1.5B Q4_K_M (~1.06 GB, Apache-2.0) on first enable',
        icon: ICONS.spark,
        keywords: ['qwen', 'ai', 'autocomplete', 'fim', 'ghost', 'disable'],
        run: () => void this.handleQwenFooterClick(),
      },

      // Appearance
      {
        id: 'toggle-sidebar',
        section: 'Appearance',
        label: this.settings.sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
        shortcut: 'Ctrl+\\',
        icon: ICONS.sidebar,
        keywords: ['panel', 'files'],
        run: () => this.toggleSidebar(),
      },
      {
        id: 'theme-dark',
        section: 'Appearance',
        label: 'Theme: Dark (Velo Studio)',
        subtitle: 'Deep charcoal palette with warm amber accent',
        icon: ICONS.moon,
        keywords: ['theme', 'dark', 'night'],
        run: () => this.applyTheme('dark'),
      },
      {
        id: 'theme-light',
        section: 'Appearance',
        label: 'Theme: Light (Alabaster)',
        subtitle: 'VeloWrite crisp alabaster & pure paper surface',
        icon: ICONS.sun,
        keywords: ['theme', 'light', 'day'],
        run: () => this.applyTheme('light'),
      },
      {
        id: 'theme-sepia',
        section: 'Appearance',
        label: 'Theme: Sepia (Warm Parchment)',
        subtitle: 'VeloWrite warm parchment palette for long sessions',
        icon: ICONS.sepia,
        keywords: ['theme', 'sepia', 'warm'],
        run: () => this.applyTheme('sepia'),
      },
      ...(window.veloideDesktop
        ? [
            {
              id: 'check-updates',
              section: 'App',
              label: this.appInfo?.isPortable
                ? 'Open GitHub Releases (Portable Updates)'
                : 'Check for Updates (GitHub)',
              subtitle: this.appInfo
                ? `VeloIde v${this.appInfo.version} (${this.appInfo.isPortable ? 'Portable' : 'Installed'}) · halxo/veloide`
                : 'halxo/veloide',
              icon: ICONS.download,
              keywords: ['update', 'release', 'github', 'version'],
              run: () => {
                if (this.appInfo?.isPortable) {
                  void window.veloideDesktop?.openExternal(this.appInfo.releasesUrl);
                } else {
                  this.manualUpdateCheck = true;
                  void window.veloideDesktop?.checkForUpdates();
                }
              },
            },
          ]
        : []),
    ];

    // Recent files
    for (const filePath of (this.settings.recentFiles || []).slice(0, 6)) {
      const name = filePath.split(/[\\/]/).pop() || filePath;
      commands.push({
        id: `recent-${filePath}`,
        section: 'Recent Files',
        label: name,
        subtitle: filePath,
        icon: ICONS.file,
        keywords: ['recent', filePath],
        run: () => void this.openFilePath(filePath),
      });
    }

    return commands;
  }
}

const app = new VeloIdeApp();
void app.init();
