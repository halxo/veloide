import { escapeHtml, formatBytes } from '../model/sanitize';
import type { QwenStatus, ToolchainStatus } from '../model/types';

export interface ToolchainModalCallbacks {
  onInstallToolchain: (id: string) => Promise<void>;
  onRemoveToolchain: (id: string) => Promise<void>;
  onInstallQwen: () => Promise<void>;
  onToggleQwen: (enabled: boolean) => Promise<void>;
  onRemoveQwen: () => Promise<void>;
  onPrefillOffline: (toolchainIds: string[], includeQwen: boolean) => Promise<void>;
}

/**
 * Minimal VeloWrite-styled modal for:
 *  - Viewing installed compilers, system compilers, and disk usage
 *  - Installing or removing any compiler or Qwen2.5-Coder-1.5B
 *  - Portable Offline Prefill (pick compilers to preload onto USB stick)
 */
export class ToolchainModal {
  private overlay: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private footerEl: HTMLDivElement;
  private callbacks: ToolchainModalCallbacks;
  private mode: 'manage' | 'prefill' = 'manage';
  private selectedPrefill = new Set<string>(['zig', 'python', 'bun']);
  private prefillQwen = false;
  private dataRoot = '';
  private isPortable = false;

  constructor(callbacks: ToolchainModalCallbacks) {
    this.callbacks = callbacks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'vw-palette-overlay vi-modal-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');

    this.overlay.innerHTML = `
      <div class="vw-palette-modal vi-tc-modal">
        <div class="vi-tc-header">
          <div>
            <div class="vi-tc-title">Toolchains &amp; Local Model</div>
            <div class="vi-tc-sub"></div>
          </div>
          <button type="button" class="vi-prompt-btn vi-tc-close">Close</button>
        </div>
        <div class="vi-tc-body"></div>
        <div class="vi-tc-footer" hidden></div>
      </div>
    `;

    this.titleEl = this.overlay.querySelector('.vi-tc-title') as HTMLElement;
    this.subEl = this.overlay.querySelector('.vi-tc-sub') as HTMLElement;
    this.bodyEl = this.overlay.querySelector('.vi-tc-body') as HTMLDivElement;
    this.footerEl = this.overlay.querySelector('.vi-tc-footer') as HTMLDivElement;

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.querySelector('.vi-tc-close')?.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('is-open')) {
        this.close();
      }
    });

    document.body.appendChild(this.overlay);
  }

  setAppContext(dataRoot: string, isPortable: boolean): void {
    this.dataRoot = dataRoot;
    this.isPortable = isPortable;
  }

  open(
    mode: 'manage' | 'prefill',
    toolchains: ToolchainStatus[],
    qwen: QwenStatus | null
  ): void {
    this.mode = mode;
    this.render(toolchains, qwen);
    this.overlay.classList.add('is-open');
  }

  refresh(toolchains: ToolchainStatus[], qwen: QwenStatus | null): void {
    if (!this.overlay.classList.contains('is-open')) return;
    this.render(toolchains, qwen);
  }

  close(): void {
    this.overlay.classList.remove('is-open');
  }

  private render(toolchains: ToolchainStatus[], qwen: QwenStatus | null): void {
    const totalDisk =
      toolchains.reduce((acc, t) => acc + (t.diskBytes || 0), 0) + (qwen?.diskBytes || 0);

    if (this.mode === 'prefill') {
      this.titleEl.textContent = 'Prepare for Offline (USB / Air-Gapped)';
      this.subEl.textContent = `Downloads selected compilers into ${this.dataRoot || 'VeloIde data folder'}`;
    } else {
      this.titleEl.textContent = 'Toolchains & Qwen2.5-Coder-1.5B';
      this.subEl.textContent = `${this.isPortable ? 'Portable' : 'Local'} storage: ${formatBytes(totalDisk)} · ${this.dataRoot}`;
    }

    const frag = document.createDocumentFragment();

    // Qwen2.5-Coder-1.5B Row
    if (qwen) {
      const qRow = document.createElement('div');
      qRow.className = 'vi-tc-row is-featured';

      if (this.mode === 'prefill') {
        qRow.innerHTML = `
          <label class="vi-tc-check-row">
            <input type="checkbox" class="vi-prefill-qwen" ${this.prefillQwen || qwen.installed ? 'checked' : ''} ${qwen.installed ? 'disabled' : ''} />
            <div class="vi-tc-info">
              <span class="vi-tc-name">${escapeHtml(qwen.modelName)} <span class="vi-tc-badge">Autocomplete</span></span>
              <span class="vi-tc-meta">${qwen.installed ? `Already installed (${formatBytes(qwen.diskBytes)})` : `${formatBytes(qwen.totalDownloadBytes)} · ${escapeHtml(qwen.modelLicense)} · 100% offline`}</span>
            </div>
          </label>
        `;
        qRow.querySelector('.vi-prefill-qwen')?.addEventListener('change', (e) => {
          this.prefillQwen = (e.target as HTMLInputElement).checked;
        });
      } else {
        const badge = qwen.installed
          ? qwen.enabled
            ? `<span class="vi-tc-badge is-ok">Enabled · ${formatBytes(qwen.diskBytes)}</span>`
            : `<span class="vi-tc-badge">Installed (Off) · ${formatBytes(qwen.diskBytes)}</span>`
          : `<span class="vi-tc-badge">On-demand · ${formatBytes(qwen.totalDownloadBytes)}</span>`;
        qRow.innerHTML = `
          <div class="vi-tc-info">
            <span class="vi-tc-name">${escapeHtml(qwen.modelName)} ${badge}</span>
            <span class="vi-tc-meta">Local ghost-text FIM autocomplete · ${escapeHtml(qwen.modelSource)} (${escapeHtml(qwen.modelLicense)})</span>
          </div>
          <div class="vi-tc-actions"></div>
        `;
        const actions = qRow.querySelector('.vi-tc-actions') as HTMLElement;
        if (qwen.installed) {
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'vi-prompt-btn';
          toggleBtn.textContent = qwen.enabled ? 'Disable' : 'Enable';
          toggleBtn.addEventListener('click', () => void this.callbacks.onToggleQwen(!qwen.enabled));
          actions.appendChild(toggleBtn);

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'vi-prompt-btn is-danger';
          delBtn.textContent = 'Remove';
          delBtn.addEventListener('click', () => void this.callbacks.onRemoveQwen());
          actions.appendChild(delBtn);
        } else {
          const dlBtn = document.createElement('button');
          dlBtn.type = 'button';
          dlBtn.className = 'vi-prompt-btn is-primary';
          dlBtn.textContent = 'Download';
          dlBtn.addEventListener('click', () => {
            this.close();
            void this.callbacks.onInstallQwen();
          });
          actions.appendChild(dlBtn);
        }
      }
      frag.appendChild(qRow);
    }

    // Compiler Toolchains
    for (const tc of toolchains) {
      const row = document.createElement('div');
      row.className = 'vi-tc-row';
      const langsLabel = tc.languages.join(', ') || tc.id;

      if (this.mode === 'prefill') {
        if (!tc.canDownload && !tc.installedManaged) continue;
        const checked = tc.installedManaged || this.selectedPrefill.has(tc.id);
        row.innerHTML = `
          <label class="vi-tc-check-row">
            <input type="checkbox" ${checked ? 'checked' : ''} ${tc.installedManaged ? 'disabled' : ''} />
            <div class="vi-tc-info">
              <span class="vi-tc-name">${escapeHtml(tc.name)} <span class="vi-tc-ver">${escapeHtml(tc.version)}</span></span>
              <span class="vi-tc-meta">${escapeHtml(langsLabel)} · ${tc.installedManaged ? `Installed (${formatBytes(tc.diskBytes)})` : formatBytes(tc.downloadSize)}</span>
            </div>
          </label>
        `;
        row.querySelector('input')?.addEventListener('change', (e) => {
          if ((e.target as HTMLInputElement).checked) this.selectedPrefill.add(tc.id);
          else this.selectedPrefill.delete(tc.id);
        });
      } else {
        const statusBadge = tc.installedManaged
          ? `<span class="vi-tc-badge is-ok">VeloIde · ${formatBytes(tc.diskBytes)}</span>`
          : tc.systemBin
            ? `<span class="vi-tc-badge is-sys">System PATH</span>`
            : tc.canDownload
              ? `<span class="vi-tc-badge">${formatBytes(tc.downloadSize)}</span>`
              : `<span class="vi-tc-badge">System only</span>`;

        row.innerHTML = `
          <div class="vi-tc-info">
            <span class="vi-tc-name">${escapeHtml(tc.name)} <span class="vi-tc-ver">${escapeHtml(tc.version)}</span> ${statusBadge}</span>
            <span class="vi-tc-meta">${escapeHtml(langsLabel)} · ${escapeHtml(tc.source)} (${escapeHtml(tc.license)})</span>
          </div>
          <div class="vi-tc-actions"></div>
        `;

        const actions = row.querySelector('.vi-tc-actions') as HTMLElement;
        if (tc.installedManaged) {
          const rmBtn = document.createElement('button');
          rmBtn.type = 'button';
          rmBtn.className = 'vi-prompt-btn is-danger';
          rmBtn.textContent = 'Remove';
          rmBtn.addEventListener('click', () => void this.callbacks.onRemoveToolchain(tc.id));
          actions.appendChild(rmBtn);
        } else if (tc.canDownload) {
          const inBtn = document.createElement('button');
          inBtn.type = 'button';
          inBtn.className = 'vi-prompt-btn';
          inBtn.textContent = tc.systemBin ? 'Install isolated' : 'Install';
          inBtn.addEventListener('click', () => {
            this.close();
            void this.callbacks.onInstallToolchain(tc.id);
          });
          actions.appendChild(inBtn);
        }
      }
      frag.appendChild(row);
    }

    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(frag);

    if (this.mode === 'prefill') {
      this.footerEl.hidden = false;
      this.footerEl.innerHTML = `
        <span class="vi-tc-sub">Selected toolchains will install directly into VeloIde's data directory.</span>
        <button type="button" class="vi-prompt-btn is-primary vi-prefill-go">Download Selected</button>
      `;
      this.footerEl.querySelector('.vi-prefill-go')?.addEventListener('click', () => {
        const ids = Array.from(this.selectedPrefill).filter((id) => {
          const tc = toolchains.find((t) => t.id === id);
          return tc && tc.canDownload && !tc.installedManaged;
        });
        const includeQwen = this.prefillQwen && Boolean(qwen && !qwen.installed);
        this.close();
        void this.callbacks.onPrefillOffline(ids, includeQwen);
      });
    } else {
      this.footerEl.hidden = true;
    }
  }
}
