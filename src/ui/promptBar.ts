import { escapeHtml, formatBytes } from '../model/sanitize';

export interface PromptAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/**
 * Calm one-line inline banner right beneath the topbar — VeloWrite's
 * "explain before it happens" principle without blocking dialog popups.
 */
export class PromptBar {
  private el: HTMLElement;
  private onEnter: (() => void) | null = null;
  private onEsc: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = container;
    this.el.hidden = true;

    window.addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      if (e.key === 'Escape' && this.onEsc) {
        e.preventDefault();
        this.onEsc();
      } else if (
        e.key === 'Enter' &&
        this.onEnter &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        this.onEnter();
      }
    });
  }

  showConfirm(options: {
    message: string;
    detail?: string;
    actions: PromptAction[];
    onEnter?: () => void;
    onEsc?: () => void;
  }): void {
    this.onEnter = options.onEnter ?? null;
    this.onEsc = options.onEsc ?? (() => this.hide());

    this.el.innerHTML = `
      <div class="vi-prompt-inner">
        <div class="vi-prompt-copy">
          <span class="vi-prompt-msg">${escapeHtml(options.message)}</span>
          ${options.detail ? `<span class="vi-prompt-detail">${escapeHtml(options.detail)}</span>` : ''}
        </div>
        <div class="vi-prompt-actions"></div>
      </div>
    `;

    const actionsEl = this.el.querySelector('.vi-prompt-actions') as HTMLElement;
    for (const act of options.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = act.primary ? 'vi-prompt-btn is-primary' : 'vi-prompt-btn';
      btn.textContent = act.label;
      btn.addEventListener('click', () => act.onClick());
      actionsEl.appendChild(btn);
    }

    this.el.hidden = false;
  }

  showCustomCommandInput(options: {
    message: string;
    detail?: string;
    placeholder: string;
    initialValue?: string;
    onSubmit: (value: string) => void;
    onCancel?: () => void;
  }): void {
    this.onEnter = null;
    this.onEsc = () => {
      this.hide();
      options.onCancel?.();
    };

    this.el.innerHTML = `
      <div class="vi-prompt-inner">
        <div class="vi-prompt-copy">
          <span class="vi-prompt-msg">${escapeHtml(options.message)}</span>
          ${options.detail ? `<span class="vi-prompt-detail">${escapeHtml(options.detail)}</span>` : ''}
        </div>
        <form class="vi-prompt-form">
          <input type="text" class="vi-prompt-input" placeholder="${escapeHtml(options.placeholder)}" value="${escapeHtml(options.initialValue ?? '')}" spellcheck="false" />
          <button type="submit" class="vi-prompt-btn is-primary">Save &amp; Run</button>
          <button type="button" class="vi-prompt-btn vi-prompt-cancel">Cancel</button>
        </form>
      </div>
    `;

    const form = this.el.querySelector('.vi-prompt-form') as HTMLFormElement;
    const input = this.el.querySelector('.vi-prompt-input') as HTMLInputElement;
    const cancelBtn = this.el.querySelector('.vi-prompt-cancel') as HTMLButtonElement;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      this.hide();
      options.onSubmit(val);
    });

    cancelBtn.addEventListener('click', () => {
      this.hide();
      options.onCancel?.();
    });

    this.el.hidden = false;
    requestAnimationFrame(() => input.focus());
  }

  showProgress(options: {
    label: string;
    percent: number;
    downloadedBytes?: number;
    totalBytes?: number;
    onCancel?: () => void;
  }): void {
    this.onEnter = null;
    this.onEsc = null;

    const bytesInfo =
      options.totalBytes && options.totalBytes > 0
        ? `${formatBytes(options.downloadedBytes || 0)} / ${formatBytes(options.totalBytes)}`
        : `${options.percent}%`;

    this.el.innerHTML = `
      <div class="vi-prompt-inner">
        <div class="vi-prompt-copy">
          <span class="vi-prompt-msg">${escapeHtml(options.label)}</span>
          <span class="vi-prompt-detail">${escapeHtml(bytesInfo)}</span>
        </div>
        <div class="vi-prompt-progress-wrap">
          <div class="vi-prompt-progress-track">
            <div class="vi-prompt-progress-fill" style="width:${Math.max(2, Math.min(100, options.percent))}%"></div>
          </div>
          ${options.onCancel ? `<button type="button" class="vi-prompt-btn vi-prompt-cancel">Cancel</button>` : ''}
        </div>
      </div>
    `;

    if (options.onCancel) {
      const cancelBtn = this.el.querySelector('.vi-prompt-cancel') as HTMLButtonElement | null;
      cancelBtn?.addEventListener('click', () => options.onCancel?.());
    }

    this.el.hidden = false;
  }

  hide(): void {
    this.onEnter = null;
    this.onEsc = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }
}
