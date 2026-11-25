import { escapeHtml, formatBytes, formatRelativeTime } from '../model/sanitize';
import type { FolderEntry, FolderTree, SearchHit, SnapshotEntry } from '../model/types';
import { ICONS } from './icons';

export type SidebarTab = 'files' | 'search' | 'history';

export interface SidebarCallbacks {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSelectFile: (filePath: string) => void;
  onSearch: (query: string) => Promise<SearchHit[]>;
  onSelectSearchHit: (hit: SearchHit) => void;
  onRestoreSnapshot: (snapshot: SnapshotEntry) => void;
}

export class WorkspaceSidebar {
  private el: HTMLElement;
  private bodyEl: HTMLElement;
  private tabButtons: Record<SidebarTab, HTMLButtonElement>;
  private activeTab: SidebarTab = 'files';
  private callbacks: SidebarCallbacks;

  private folderTree: FolderTree | null = null;
  private activeFilePath: string | null = null;
  private expandedDirs = new Set<string>();
  private snapshots: SnapshotEntry[] = [];
  private lastQuery = '';
  private lastHits: SearchHit[] = [];

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.el = container;
    this.callbacks = callbacks;

    this.el.innerHTML = `
      <div class="vw-sidebar-header">
        <div class="vw-sidebar-tabs" role="tablist">
          <button type="button" class="vw-sidebar-tab is-active" data-tab="files" role="tab">Files</button>
          <button type="button" class="vw-sidebar-tab" data-tab="search" role="tab">Search</button>
          <button type="button" class="vw-sidebar-tab" data-tab="history" role="tab">History</button>
        </div>
        <button type="button" class="vw-icon-btn vi-open-folder-btn" title="Open Folder">${ICONS.folder}</button>
      </div>
      <div class="vw-sidebar-body"></div>
    `;

    this.bodyEl = this.el.querySelector('.vw-sidebar-body') as HTMLElement;
    this.tabButtons = {
      files: this.el.querySelector('[data-tab="files"]') as HTMLButtonElement,
      search: this.el.querySelector('[data-tab="search"]') as HTMLButtonElement,
      history: this.el.querySelector('[data-tab="history"]') as HTMLButtonElement,
    };

    for (const [tab, btn] of Object.entries(this.tabButtons) as Array<[SidebarTab, HTMLButtonElement]>) {
      btn.addEventListener('click', () => this.switchTab(tab));
    }

    this.el.querySelector('.vi-open-folder-btn')?.addEventListener('click', () => {
      this.callbacks.onOpenFolder();
    });

    this.render();
  }

  setOpen(open: boolean): void {
    this.el.classList.toggle('is-collapsed', !open);
  }

  switchTab(tab: SidebarTab): void {
    this.activeTab = tab;
    for (const [key, btn] of Object.entries(this.tabButtons)) {
      btn.classList.toggle('is-active', key === tab);
    }
    this.render();
    if (tab === 'search') {
      const inp = this.bodyEl.querySelector<HTMLInputElement>('.vi-search-input');
      inp?.focus();
    }
  }

  setFolderTree(tree: FolderTree | null): void {
    this.folderTree = tree;
    if (tree) {
      this.expandedDirs.add(tree.root);
    }
    if (this.activeTab === 'files') {
      this.render();
    }
  }

  setActiveFile(filePath: string | null, snapshots: SnapshotEntry[]): void {
    this.activeFilePath = filePath;
    this.snapshots = snapshots;
    this.render();
  }

  private render(): void {
    if (this.activeTab === 'files') this.renderFiles();
    else if (this.activeTab === 'search') this.renderSearch();
    else this.renderHistory();
  }

  private renderFiles(): void {
    if (!this.folderTree) {
      this.bodyEl.innerHTML = `
        <div class="vw-sidebar-empty">
          <p>No folder open</p>
          <p style="font-weight:400; color:var(--vw-ink-muted); margin-bottom:12px;">
            Open a file or folder for quick fixes, or just type in a scratch buffer and press <code>F5</code>.
          </p>
          <div class="vi-empty-actions">
            <button type="button" class="vw-pill-btn vi-btn-open-folder">${ICONS.folder}<span>Open Folder</span></button>
            <button type="button" class="vw-pill-btn vi-btn-open-file">${ICONS.file}<span>Open File</span></button>
          </div>
        </div>
      `;
      this.bodyEl.querySelector('.vi-btn-open-folder')?.addEventListener('click', () => this.callbacks.onOpenFolder());
      this.bodyEl.querySelector('.vi-btn-open-file')?.addEventListener('click', () => this.callbacks.onOpenFile());
      return;
    }

    const frag = document.createDocumentFragment();
    const header = document.createElement('div');
    header.className = 'vi-tree-root-label';
    header.textContent = this.folderTree.name;
    header.title = this.folderTree.root;
    frag.appendChild(header);

    const list = document.createElement('div');
    list.className = 'vi-tree-list';
    this.renderEntries(list, this.folderTree.entries, 0);
    frag.appendChild(list);

    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(frag);
  }

  private renderEntries(container: HTMLElement, entries: FolderEntry[], depth: number): void {
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vi-tree-item';
      btn.style.paddingLeft = `${10 + depth * 14}px`;

      if (entry.kind === 'dir') {
        const isExpanded = this.expandedDirs.has(entry.path);
        btn.classList.toggle('is-expanded', isExpanded);
        btn.innerHTML = `
          <span class="vi-tree-chevron">${ICONS.chevronRight}</span>
          <span class="vi-tree-icon">${ICONS.folder}</span>
          <span class="vi-tree-name">${escapeHtml(entry.name)}</span>
        `;
        btn.addEventListener('click', () => {
          if (this.expandedDirs.has(entry.path)) this.expandedDirs.delete(entry.path);
          else this.expandedDirs.add(entry.path);
          this.renderFiles();
        });
        container.appendChild(btn);

        if (isExpanded && entry.children && entry.children.length > 0) {
          this.renderEntries(container, entry.children, depth + 1);
        }
      } else {
        const isCurrent = this.activeFilePath === entry.path;
        if (isCurrent) btn.classList.add('is-active');
        btn.innerHTML = `
          <span class="vi-tree-chevron is-spacer"></span>
          <span class="vi-tree-icon">${ICONS.file}</span>
          <span class="vi-tree-name">${escapeHtml(entry.name)}</span>
        `;
        btn.title = entry.relativePath;
        btn.addEventListener('click', () => this.callbacks.onSelectFile(entry.path));
        container.appendChild(btn);
      }
    }
  }

  private renderSearch(): void {
    if (!this.folderTree) {
      this.bodyEl.innerHTML = `
        <div class="vw-sidebar-empty">
          <p>Folder search</p>
          <p style="font-weight:400; color:var(--vw-ink-muted); margin-bottom:12px;">
            Open a folder to search across files with ripgrep. Use <code>Ctrl+F</code> to search inside the current file.
          </p>
          <button type="button" class="vw-pill-btn vi-btn-open-folder">${ICONS.folder}<span>Open Folder</span></button>
        </div>
      `;
      this.bodyEl.querySelector('.vi-btn-open-folder')?.addEventListener('click', () => this.callbacks.onOpenFolder());
      return;
    }

    this.bodyEl.innerHTML = `
      <div class="vi-search-panel">
        <div class="vi-search-box">
          <span class="vi-search-icon">${ICONS.search}</span>
          <input type="text" class="vi-search-input" placeholder="Search in ${escapeHtml(this.folderTree.name)}…" value="${escapeHtml(this.lastQuery)}" spellcheck="false" />
        </div>
        <div class="vi-search-results"></div>
      </div>
    `;

    const input = this.bodyEl.querySelector('.vi-search-input') as HTMLInputElement;
    const resultsEl = this.bodyEl.querySelector('.vi-search-results') as HTMLElement;

    let timer: number | null = null;
    const runSearch = async () => {
      const q = input.value.trim();
      this.lastQuery = q;
      if (!q) {
        this.lastHits = [];
        resultsEl.innerHTML = `<div class="vi-search-meta">Type to search across ${escapeHtml(this.folderTree?.name ?? 'folder')}</div>`;
        return;
      }
      resultsEl.innerHTML = `<div class="vi-search-meta">Searching…</div>`;
      const hits = await this.callbacks.onSearch(q);
      if (this.lastQuery !== q) return;
      this.lastHits = hits;
      this.renderSearchHits(resultsEl, hits);
    };

    input.addEventListener('input', () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void runSearch(), 180);
    });

    if (this.lastHits.length > 0) {
      this.renderSearchHits(resultsEl, this.lastHits);
    } else {
      resultsEl.innerHTML = `<div class="vi-search-meta">Type to search across ${escapeHtml(this.folderTree.name)}</div>`;
    }
  }

  private renderSearchHits(container: HTMLElement, hits: SearchHit[]): void {
    if (hits.length === 0) {
      container.innerHTML = `<div class="vi-search-meta">No matches found.</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    const count = document.createElement('div');
    count.className = 'vi-search-meta';
    count.textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
    frag.appendChild(count);

    for (const hit of hits) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vi-search-hit';
      btn.innerHTML = `
        <span class="vi-search-hit-file">${escapeHtml(hit.relativePath)}<span class="vi-search-hit-ln">:${hit.line}</span></span>
        <span class="vi-search-hit-preview">${escapeHtml(hit.preview)}</span>
      `;
      btn.addEventListener('click', () => this.callbacks.onSelectSearchHit(hit));
      frag.appendChild(btn);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  }

  private renderHistory(): void {
    if (!this.activeFilePath) {
      this.bodyEl.innerHTML = `
        <div class="vw-sidebar-empty">
          <p>Local snapshots (0 / 3)</p>
          <p style="font-weight:400; color:var(--vw-ink-muted);">
            Save this scratch buffer to a file to keep up to 3 local recovery snapshots on every save.
          </p>
        </div>
      `;
      return;
    }

    if (this.snapshots.length === 0) {
      this.bodyEl.innerHTML = `
        <div class="vw-sidebar-empty">
          <p>Local snapshots (0 / 3)</p>
          <p style="font-weight:400; color:var(--vw-ink-muted);">
            Each time you save changes to this file, VeloIde keeps the previous version locally so quick fixes are always reversible.
          </p>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();
    const head = document.createElement('div');
    head.className = 'vi-search-meta';
    head.textContent = `${this.snapshots.length} / 3 local snapshots`;
    frag.appendChild(head);

    for (const snap of this.snapshots) {
      const row = document.createElement('div');
      row.className = 'vi-snap-row';
      row.innerHTML = `
        <div class="vi-snap-info">
          <span class="vi-snap-time">${escapeHtml(formatRelativeTime(snap.createdAt))}</span>
          <span class="vi-snap-meta">${snap.lines} lines · ${escapeHtml(formatBytes(snap.size))}</span>
        </div>
        <button type="button" class="vi-snap-restore">Restore</button>
      `;
      row.querySelector('.vi-snap-restore')?.addEventListener('click', () => {
        this.callbacks.onRestoreSnapshot(snap);
      });
      frag.appendChild(row);
    }

    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(frag);
  }
}
