import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { getLanguageById } from '../model/languages';
import type { Diagnostic, ThemeMode } from '../model/types';
import { createGhostTextExtension } from './ghostText';

const setErrorLinesEffect = StateEffect.define<number[]>();

const errorLineDecoration = Decoration.line({ class: 'vi-error-line' });

const errorLinesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setErrorLinesEffect)) {
        const lines = effect.value;
        if (!lines.length) return Decoration.none;
        const ranges = [];
        for (const lineNo of lines) {
          if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
            const line = tr.state.doc.line(lineNo);
            ranges.push(errorLineDecoration.range(line.from));
          }
        }
        return Decoration.set(ranges, true);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Curated syntax palettes matching VeloWrite's Light, Dark, and Sepia themes
const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#e8a254' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d19a66' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#6cb6ff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#e5c07b' },
  { tag: [t.variableName, t.propertyName], color: '#e7e2d9' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7a756c', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#a8a298' },
  { tag: [t.tagName], color: '#e06c75' },
  { tag: [t.attributeName], color: '#d19a66' },
]);

const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#a63d00' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#2b6e3f' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#8f4f00' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1b5da8' },
  { tag: [t.typeName, t.className, t.namespace], color: '#7a4b00' },
  { tag: [t.variableName, t.propertyName], color: '#211f1c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8a857c', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#5c5852' },
  { tag: [t.tagName], color: '#b5343c' },
  { tag: [t.attributeName], color: '#8f4f00' },
]);

const sepiaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#9c3e18' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#396839' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#8c5214' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#265985' },
  { tag: [t.typeName, t.className, t.namespace], color: '#7d4c12' },
  { tag: [t.variableName, t.propertyName], color: '#302419' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8c7a64', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#6b5b49' },
  { tag: [t.tagName], color: '#a13434' },
  { tag: [t.attributeName], color: '#8c5214' },
]);

function syntaxForTheme(theme: ThemeMode): Extension {
  if (theme === 'light') return syntaxHighlighting(lightHighlight);
  if (theme === 'sepia') return syntaxHighlighting(sepiaHighlight);
  return syntaxHighlighting(darkHighlight);
}

const veloBaseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--vw-bg-paper)',
    color: 'var(--vw-ink-primary)',
    fontFamily: 'var(--vw-font-mono)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--vw-font-mono)',
    lineHeight: '1.65',
    padding: '12px 0 64px',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--vw-accent)',
    padding: '0 24px 0 8px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--vw-bg-paper)',
    color: 'var(--vw-ink-muted)',
    border: 'none',
    paddingLeft: '10px',
    paddingRight: '8px',
    opacity: '0.55',
    transition: 'opacity 160ms ease',
    userSelect: 'none',
  },
  '&:hover .cm-gutters': {
    opacity: '0.92',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--vw-ink-primary)',
    fontWeight: '500',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vi-active-line)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--vw-accent-soft) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--vw-accent)',
    borderLeftWidth: '2px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--vw-accent-soft)',
    outline: '1px solid var(--vw-accent)',
    borderRadius: '2px',
  },
  '.cm-panels': {
    backgroundColor: 'var(--vw-bg-elevated)',
    color: 'var(--vw-ink-primary)',
    borderColor: 'var(--vw-border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--vw-highlight-bg)',
    borderRadius: '2px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--vw-bg-elevated)',
    border: '1px solid var(--vw-border-strong)',
    borderRadius: '8px',
    boxShadow: 'var(--vw-float-shadow)',
    fontFamily: 'var(--vw-font-mono)',
    fontSize: '12.5px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--vw-accent-soft)',
    color: 'var(--vw-ink-primary)',
  },
});

export interface CodeEditorCallbacks {
  onChange: (content: string) => void;
  onCursorChange: (info: { line: number; col: number; lines: number; chars: number }) => void;
  onTypingActivity: () => void;
  onLatencySample: (ms: number) => void;
  isQwenEnabled: () => boolean;
  getActiveContext: () => { filename: string; language: string };
  requestQwenCompletion: (params: {
    prefix: string;
    suffix: string;
    filename: string;
    language: string;
  }) => Promise<string>;
  onQwenActivity: (state: 'idle' | 'thinking') => void;
}

export class VeloCodeEditor {
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private activeTabId: string | null = null;
  private languageCompartment = new Compartment();
  private themeCompartment = new Compartment();
  private fontCompartment = new Compartment();
  private currentTheme: ThemeMode = 'dark';
  private currentFontSize = 14;
  private callbacks: CodeEditorCallbacks;
  private lastInputTimestamp = 0;

  constructor(parent: HTMLElement, callbacks: CodeEditorCallbacks) {
    this.callbacks = callbacks;

    parent.addEventListener(
      'keydown',
      () => {
        this.lastInputTimestamp = performance.now();
      },
      { capture: true, passive: true }
    );

    const initialState = this.createState('', 'typescript');
    this.view = new EditorView({
      state: initialState,
      parent,
    });
  }

  private createState(content: string, languageId: string): EditorState {
    const langDef = getLanguageById(languageId);
    const ghostExt = createGhostTextExtension({
      isEnabled: () => this.callbacks.isQwenEnabled(),
      getContext: () => this.callbacks.getActiveContext(),
      requestCompletion: (params) => this.callbacks.requestQwenCompletion(params),
      onActivity: (s) => this.callbacks.onQwenActivity(s),
    });

    return EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [completeAnyWord],
          activateOnTyping: false, // Calm by default: Ctrl+Space for word list, ghost text handles inline completion
        }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        veloBaseTheme,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        this.themeCompartment.of(syntaxForTheme(this.currentTheme)),
        this.fontCompartment.of(
          EditorView.theme({
            '&': { fontSize: `${this.currentFontSize}px` },
          })
        ),
        this.languageCompartment.of(langDef.cm()),
        errorLinesField,
        ghostExt,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (this.lastInputTimestamp > 0) {
              const latency = performance.now() - this.lastInputTimestamp;
              this.lastInputTimestamp = 0;
              if (latency < 500) {
                this.callbacks.onLatencySample(latency);
              }
            }
            this.callbacks.onChange(update.state.doc.toString());
            if (update.transactions.some((tr) => tr.isUserEvent('input'))) {
              this.callbacks.onTypingActivity();
            }
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            this.callbacks.onCursorChange({
              line: line.number,
              col: head - line.from + 1,
              lines: update.state.doc.lines,
              chars: update.state.doc.length,
            });
          }
        }),
      ],
    });
  }

  switchToTab(tabId: string, content: string, languageId: string): void {
    if (this.activeTabId) {
      this.states.set(this.activeTabId, this.view.state);
    }

    let state = this.states.get(tabId);
    if (!state) {
      state = this.createState(content, languageId);
      this.states.set(tabId, state);
    } else if (state.doc.toString() !== content) {
      state = this.createState(content, languageId);
      this.states.set(tabId, state);
    }

    this.activeTabId = tabId;
    this.view.setState(state);
    this.applyTheme(this.currentTheme);
    this.applyFontSize(this.currentFontSize);
    this.emitCursorNow();
    this.view.focus();
  }

  disposeTab(tabId: string): void {
    this.states.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  replaceContent(content: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content },
    });
  }

  setLanguage(languageId: string): void {
    const langDef = getLanguageById(languageId);
    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(langDef.cm()),
    });
  }

  applyTheme(theme: ThemeMode): void {
    this.currentTheme = theme;
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(syntaxForTheme(theme)),
    });
  }

  applyFontSize(sizePx: number): void {
    this.currentFontSize = Math.max(11, Math.min(24, sizePx));
    this.view.dispatch({
      effects: this.fontCompartment.reconfigure(
        EditorView.theme({ '&': { fontSize: `${this.currentFontSize}px` } })
      ),
    });
  }

  setDiagnostics(diagnostics: Diagnostic[]): void {
    const lineNos = diagnostics.map((d) => d.line).filter((n) => n > 0);
    this.view.dispatch({
      effects: setErrorLinesEffect.of(lineNos),
    });
  }

  clearDiagnostics(): void {
    this.view.dispatch({ effects: setErrorLinesEffect.of([]) });
  }

  jumpToLocation(lineNo: number, col = 1): void {
    const clampedLine = Math.max(1, Math.min(this.view.state.doc.lines, lineNo));
    const line = this.view.state.doc.line(clampedLine);
    const pos = Math.min(line.to, line.from + Math.max(0, col - 1));
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    this.view.focus();
  }

  getContent(): string {
    return this.view.state.doc.toString();
  }

  focus(): void {
    this.view.focus();
  }

  private emitCursorNow(): void {
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    this.callbacks.onCursorChange({
      line: line.number,
      col: head - line.from + 1,
      lines: this.view.state.doc.lines,
      chars: this.view.state.doc.length,
    });
  }
}
