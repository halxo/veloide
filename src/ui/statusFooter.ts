import type { QwenStatus, RuntimeResolution } from '../model/types';

export interface StatusFooterCallbacks {
  onClickLanguage: () => void;
  onClickToolchain: () => void;
  onClickQwen: () => void;
}

export class StatusFooter {
  private container: HTMLElement;
  private cursorEl: HTMLElement;
  private linesEl: HTMLElement;
  private langBtn: HTMLButtonElement;
  private runtimeBtn: HTMLButtonElement;
  private portableBadge: HTMLElement;
  private qwenBtn: HTMLButtonElement;
  private latencyEl: HTMLElement;

  constructor(container: HTMLElement, callbacks: StatusFooterCallbacks) {
    this.container = container;
    this.container.innerHTML = `
      <div class="vw-footer-left">
        <span id="vi-stat-cursor" class="vw-stat">Ln 1, Col 1</span>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <span id="vi-stat-lines" class="vw-stat">1 line</span>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <button type="button" id="vi-stat-lang" class="vi-footer-btn" title="Switch language">TypeScript</button>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <button type="button" id="vi-stat-runtime" class="vi-footer-btn" title="Manage compilers">Detecting…</button>
      </div>
      <div class="vw-footer-right">
        <span id="vi-stat-portable" class="vi-portable-badge" hidden title="All settings, compilers, and models stored next to the app">Portable</span>
        <button type="button" id="vi-stat-qwen" class="vi-footer-btn" title="Toggle local Qwen2.5-Coder-1.5B autocomplete">Qwen 1.5B: Off</button>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <span id="vw-stat-latency" class="vw-stat vw-stat-latency is-fast" title="Measured input latency">Input &lt; 1ms</span>
      </div>
    `;

    this.cursorEl = this.container.querySelector('#vi-stat-cursor') as HTMLElement;
    this.linesEl = this.container.querySelector('#vi-stat-lines') as HTMLElement;
    this.langBtn = this.container.querySelector('#vi-stat-lang') as HTMLButtonElement;
    this.runtimeBtn = this.container.querySelector('#vi-stat-runtime') as HTMLButtonElement;
    this.portableBadge = this.container.querySelector('#vi-stat-portable') as HTMLElement;
    this.qwenBtn = this.container.querySelector('#vi-stat-qwen') as HTMLButtonElement;
    this.latencyEl = this.container.querySelector('#vw-stat-latency') as HTMLElement;

    this.langBtn.addEventListener('click', () => callbacks.onClickLanguage());
    this.runtimeBtn.addEventListener('click', () => callbacks.onClickToolchain());
    this.qwenBtn.addEventListener('click', () => callbacks.onClickQwen());
  }

  setPortable(isPortable: boolean): void {
    this.portableBadge.hidden = !isPortable;
  }

  updateCursor(info: { line: number; col: number; lines: number }): void {
    this.cursorEl.textContent = `Ln ${info.line}, Col ${info.col}`;
    this.linesEl.textContent = `${info.lines.toLocaleString()} ${info.lines === 1 ? 'line' : 'lines'}`;
  }

  updateLanguage(name: string): void {
    this.langBtn.textContent = name;
  }

  updateRuntime(runtime: RuntimeResolution | null): void {
    if (!runtime) {
      this.runtimeBtn.textContent = 'No runner';
      this.runtimeBtn.classList.remove('is-ready', 'is-missing');
      return;
    }
    if (runtime.ready) {
      this.runtimeBtn.textContent = runtime.label || 'Ready';
      this.runtimeBtn.classList.add('is-ready');
      this.runtimeBtn.classList.remove('is-missing');
    } else if (runtime.source === 'missing-managed') {
      this.runtimeBtn.textContent = `${runtime.toolchainId}: on-demand`;
      this.runtimeBtn.classList.remove('is-ready');
      this.runtimeBtn.classList.add('is-missing');
    } else {
      this.runtimeBtn.textContent = 'No compiler';
      this.runtimeBtn.classList.remove('is-ready', 'is-missing');
    }
  }

  updateQwen(status: QwenStatus | null, activity: 'idle' | 'thinking' = 'idle'): void {
    if (!status) {
      this.qwenBtn.textContent = 'Qwen 1.5B: Desktop only';
      return;
    }
    this.qwenBtn.classList.remove('is-ready', 'is-thinking');
    if (status.installing) {
      this.qwenBtn.textContent = 'Qwen 1.5B: Downloading…';
      this.qwenBtn.classList.add('is-thinking');
    } else if (!status.enabled) {
      this.qwenBtn.textContent = 'Qwen 1.5B: Off';
    } else if (!status.installed) {
      this.qwenBtn.textContent = 'Qwen 1.5B: Download';
    } else if (status.loading || activity === 'thinking') {
      this.qwenBtn.textContent = status.loading ? 'Qwen 1.5B: Loading…' : 'Qwen 1.5B: Thinking…';
      this.qwenBtn.classList.add('is-thinking');
    } else {
      this.qwenBtn.textContent = 'Qwen 1.5B: On';
      this.qwenBtn.classList.add('is-ready');
    }
  }

  updateLatency(ms: number): void {
    const label = ms < 1 ? 'Input < 1ms' : `Input ${ms.toFixed(1)}ms`;
    this.latencyEl.textContent = label;
    this.latencyEl.classList.toggle('is-fast', ms < 16);
  }
}
