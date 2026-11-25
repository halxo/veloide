import { marked } from 'marked';
import { escapeHtml } from '../model/sanitize';
import { parseDiagnostics } from '../editor/errorParser';
import type { Diagnostic, RunEvent, TerminalEvent } from '../model/types';
import { ICONS } from './icons';

export type DrawerTab = 'output' | 'terminal';

export interface OutputDrawerCallbacks {
  onSendStdin: (text: string) => void;
  onTerminalExec: (cmd: string) => void;
  onTerminalKill: () => void;
  onJumpDiagnostic: (diag: Diagnostic) => void;
  onDiagnosticsUpdated: (diagnostics: Diagnostic[]) => void;
  onArgsChange: (args: string) => void;
}

export class OutputDrawer {
  private el: HTMLElement;
  private resizeHandle: HTMLElement;
  private outputBody: HTMLElement;
  private outputLog: HTMLElement;
  private previewHost: HTMLElement;
  private diagStrip: HTMLElement;
  private metaEl: HTMLElement;
  private stdinForm: HTMLFormElement;
  private stdinInput: HTMLInputElement;
  private argsInput: HTMLInputElement;

  private termBody: HTMLElement;
  private termLog: HTMLElement;
  private termCwdEl: HTMLElement;
  private termForm: HTMLFormElement;
  private termInput: HTMLInputElement;

  private tabOutputBtn: HTMLButtonElement;
  private tabTerminalBtn: HTMLButtonElement;

  private activeTab: DrawerTab = 'output';
  private isOpen = false;
  private heightPx = 250;
  private fullOutputText = '';
  private cmdHistory: string[] = [];
  private historyIdx = -1;
  private callbacks: OutputDrawerCallbacks;

  constructor(container: HTMLElement, callbacks: OutputDrawerCallbacks) {
    this.el = container;
    this.callbacks = callbacks;

    this.el.innerHTML = `
      <div class="vi-drawer-resize" title="Drag to resize"></div>
      <div class="vi-drawer-header">
        <div class="vi-drawer-header-left">
          <div class="vw-sidebar-tabs">
            <button type="button" class="vw-sidebar-tab is-active" data-dtab="output">Output</button>
            <button type="button" class="vw-sidebar-tab" data-dtab="terminal">Terminal</button>
          </div>
          <span class="vi-drawer-meta"></span>
        </div>
        <div class="vi-drawer-header-right">
          <input type="text" class="vi-args-input" placeholder="Args (optional)…" title="Command-line arguments passed on Run" spellcheck="false" />
          <button type="button" class="vw-icon-btn vi-drawer-clear" title="Clear">${ICONS.trash}</button>
          <button type="button" class="vw-icon-btn vi-drawer-close" title="Close Panel (Ctrl+\`)">${ICONS.close}</button>
        </div>
      </div>

      <div class="vi-drawer-pane vi-output-pane">
        <div class="vi-diag-strip" hidden></div>
        <pre class="vi-output-log"></pre>
        <div class="vi-preview-host" hidden></div>
        <form class="vi-stdin-bar" hidden>
          <span class="vi-stdin-label">stdin ›</span>
          <input type="text" class="vi-stdin-input" placeholder="Send line to running process…" autocomplete="off" spellcheck="false" />
        </form>
      </div>

      <div class="vi-drawer-pane vi-terminal-pane" hidden>
        <pre class="vi-term-log"><span class="vi-term-hint">All installed VeloIde compilers are on PATH. Press Ctrl+C to interrupt.</span>\n</pre>
        <form class="vi-term-bar">
          <span class="vi-term-cwd">~</span>
          <span class="vi-term-prompt">›</span>
          <input type="text" class="vi-term-input" placeholder="Run any shell or compiler command…" autocomplete="off" spellcheck="false" />
          <button type="button" class="vi-prompt-btn vi-term-kill" title="Interrupt (Ctrl+C)">Stop</button>
        </form>
      </div>
    `;

    this.resizeHandle = this.el.querySelector('.vi-drawer-resize') as HTMLElement;
    this.outputBody = this.el.querySelector('.vi-output-pane') as HTMLElement;
    this.outputLog = this.el.querySelector('.vi-output-log') as HTMLElement;
    this.previewHost = this.el.querySelector('.vi-preview-host') as HTMLElement;
    this.diagStrip = this.el.querySelector('.vi-diag-strip') as HTMLElement;
    this.metaEl = this.el.querySelector('.vi-drawer-meta') as HTMLElement;
    this.stdinForm = this.el.querySelector('.vi-stdin-bar') as HTMLFormElement;
    this.stdinInput = this.el.querySelector('.vi-stdin-input') as HTMLInputElement;
    this.argsInput = this.el.querySelector('.vi-args-input') as HTMLInputElement;

    this.termBody = this.el.querySelector('.vi-terminal-pane') as HTMLElement;
    this.termLog = this.el.querySelector('.vi-term-log') as HTMLElement;
    this.termCwdEl = this.el.querySelector('.vi-term-cwd') as HTMLElement;
    this.termForm = this.el.querySelector('.vi-term-bar') as HTMLFormElement;
    this.termInput = this.el.querySelector('.vi-term-input') as HTMLInputElement;

    this.tabOutputBtn = this.el.querySelector('[data-dtab="output"]') as HTMLButtonElement;
    this.tabTerminalBtn = this.el.querySelector('[data-dtab="terminal"]') as HTMLButtonElement;

    this.bindEvents();
    this.el.style.height = '0px';
    this.el.classList.add('is-closed');
  }

  private bindEvents(): void {
    this.tabOutputBtn.addEventListener('click', () => this.switchTab('output'));
    this.tabTerminalBtn.addEventListener('click', () => this.switchTab('terminal'));

    this.el.querySelector('.vi-drawer-close')?.addEventListener('click', () => this.setOpen(false));
    this.el.querySelector('.vi-drawer-clear')?.addEventListener('click', () => {
      if (this.activeTab === 'output') this.clearOutput();
      else this.termLog.innerHTML = '';
    });

    this.argsInput.addEventListener('input', () => {
      this.callbacks.onArgsChange(this.argsInput.value);
    });

    this.stdinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.stdinInput.value;
      this.stdinInput.value = '';
      this.appendOutputSpan(`${val}\n`, 'vi-out-stdin');
      this.callbacks.onSendStdin(`${val}\n`);
    });

    this.termForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const cmd = this.termInput.value.trim();
      if (!cmd) return;
      this.cmdHistory.unshift(cmd);
      this.cmdHistory = this.cmdHistory.slice(0, 60);
      this.historyIdx = -1;
      this.termInput.value = '';
      this.appendTermSpan(`› ${cmd}\n`, 'vi-term-cmd');
      this.callbacks.onTerminalExec(cmd);
    });

    this.termInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.cmdHistory.length > 0) {
          this.historyIdx = Math.min(this.cmdHistory.length - 1, this.historyIdx + 1);
          this.termInput.value = this.cmdHistory[this.historyIdx];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIdx > 0) {
          this.historyIdx--;
          this.termInput.value = this.cmdHistory[this.historyIdx];
        } else {
          this.historyIdx = -1;
          this.termInput.value = '';
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.callbacks.onTerminalKill();
      }
    });

    this.el.querySelector('.vi-term-kill')?.addEventListener('click', () => {
      this.callbacks.onTerminalKill();
    });

    // Vertical resize handle
    let startY = 0;
    let startH = 0;
    const onMove = (e: MouseEvent) => {
      const next = Math.max(130, Math.min(window.innerHeight * 0.72, startH + (startY - e.clientY)));
      this.heightPx = next;
      this.el.style.height = `${next}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    this.resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = this.heightPx;
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  setOpen(open: boolean, tab?: DrawerTab): void {
    this.isOpen = open;
    if (tab) this.switchTab(tab);
    this.el.classList.toggle('is-closed', !open);
    this.el.style.height = open ? `${this.heightPx}px` : '0px';
    if (open && this.activeTab === 'terminal') {
      requestAnimationFrame(() => this.termInput.focus());
    }
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  switchTab(tab: DrawerTab): void {
    this.activeTab = tab;
    this.tabOutputBtn.classList.toggle('is-active', tab === 'output');
    this.tabTerminalBtn.classList.toggle('is-active', tab === 'terminal');
    this.outputBody.hidden = tab !== 'output';
    this.termBody.hidden = tab !== 'terminal';
    this.argsInput.hidden = tab !== 'output';
    if (tab === 'terminal' && this.isOpen) {
      requestAnimationFrame(() => this.termInput.focus());
    }
  }

  setTerminalCwd(cwd: string): void {
    const short = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || cwd;
    this.termCwdEl.textContent = short;
    this.termCwdEl.title = cwd;
  }

  clearOutput(): void {
    this.fullOutputText = '';
    this.outputLog.innerHTML = '';
    this.outputLog.hidden = false;
    this.previewHost.hidden = true;
    this.previewHost.innerHTML = '';
    this.diagStrip.hidden = true;
    this.diagStrip.innerHTML = '';
    this.metaEl.textContent = '';
    this.callbacks.onDiagnosticsUpdated([]);
  }

  handleRunEvent(ev: RunEvent): void {
    if (ev.type === 'start') {
      this.setOpen(true, 'output');
      this.clearOutput();
      this.stdinForm.hidden = false;
      this.metaEl.textContent = `Running · ${ev.source ?? ''}`;
      this.metaEl.className = 'vi-drawer-meta is-running';
      this.appendOutputSpan(`$ ${ev.command ?? ''}\n`, 'vi-out-cmd');
      return;
    }

    if (ev.type === 'stdout' && ev.text) {
      this.fullOutputText += ev.text;
      this.appendOutputSpan(ev.text, 'vi-out-stdout');
      return;
    }

    if (ev.type === 'stderr' && ev.text) {
      this.fullOutputText += ev.text;
      this.appendOutputSpan(ev.text, 'vi-out-stderr');
      return;
    }

    if (ev.type === 'preview' && ev.content !== undefined) {
      this.setOpen(true, 'output');
      this.outputLog.hidden = true;
      this.stdinForm.hidden = true;
      this.previewHost.hidden = false;
      if (ev.format === 'html') {
        this.previewHost.innerHTML = `<iframe class="vi-html-frame" sandbox="allow-scripts"></iframe>`;
        const frame = this.previewHost.querySelector('iframe') as HTMLIFrameElement;
        frame.srcdoc = ev.content;
      } else {
        const rendered = marked.parse(ev.content, { async: false }) as string;
        this.previewHost.innerHTML = `<div class="vi-md-preview">${rendered}</div>`;
      }
      return;
    }

    if (ev.type === 'exit') {
      this.stdinForm.hidden = true;
      const ms = ev.durationMs ?? 0;
      const dur = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
      if (ev.cancelled) {
        this.metaEl.textContent = `Stopped (${dur})`;
        this.metaEl.className = 'vi-drawer-meta';
      } else if (ev.code === 0) {
        this.metaEl.textContent = `Exit 0 · ${dur}`;
        this.metaEl.className = 'vi-drawer-meta is-ok';
      } else {
        this.metaEl.textContent = `Exit ${ev.code ?? 1} · ${dur}`;
        this.metaEl.className = 'vi-drawer-meta is-err';
      }

      const diagnostics = parseDiagnostics(this.fullOutputText);
      this.renderDiagnostics(diagnostics);
      this.callbacks.onDiagnosticsUpdated(diagnostics);
    }
  }

  handleTerminalEvent(ev: TerminalEvent): void {
    if (ev.cwd) this.setTerminalCwd(ev.cwd);
    if (ev.type === 'stdout' && ev.text) {
      this.appendTermSpan(ev.text, 'vi-out-stdout');
    } else if (ev.type === 'stderr' && ev.text) {
      this.appendTermSpan(ev.text, 'vi-out-stderr');
    } else if (ev.type === 'exit' && ev.code && ev.code !== 0) {
      this.appendTermSpan(`[exit ${ev.code}]\n`, 'vi-term-hint');
    }
  }

  private renderDiagnostics(diags: Diagnostic[]): void {
    if (diags.length === 0) {
      this.diagStrip.hidden = true;
      return;
    }
    this.diagStrip.innerHTML = '';
    for (const d of diags.slice(0, 8)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vi-diag-pill${d.severity === 'warning' ? ' is-warn' : ''}`;
      const shortFile = d.file ? d.file.split(/[\\/]/).pop() : '';
      btn.innerHTML = `
        <span class="vi-diag-loc">${escapeHtml(shortFile ? `${shortFile}:${d.line}` : `Ln ${d.line}`)}</span>
        <span class="vi-diag-msg">${escapeHtml(d.message.slice(0, 90))}</span>
      `;
      btn.addEventListener('click', () => this.callbacks.onJumpDiagnostic(d));
      this.diagStrip.appendChild(btn);
    }
    this.diagStrip.hidden = false;
  }

  private appendOutputSpan(text: string, cls: string): void {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    this.outputLog.appendChild(span);
    this.outputLog.scrollTop = this.outputLog.scrollHeight;
  }

  private appendTermSpan(text: string, cls: string): void {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    this.termLog.appendChild(span);
    this.termLog.scrollTop = this.termLog.scrollHeight;
  }
}
