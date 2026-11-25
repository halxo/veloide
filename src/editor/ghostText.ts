import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

interface GhostSuggestion {
  pos: number;
  text: string;
}

const setGhostEffect = StateEffect.define<GhostSuggestion | null>();

class GhostTextWidget extends WidgetType {
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'vi-ghost-text';
    span.textContent = this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostEffect)) {
        return effect.value;
      }
    }
    if (tr.docChanged || tr.selection) {
      return null;
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (suggestion): DecorationSet => {
      if (!suggestion || !suggestion.text) return Decoration.none;
      const widget = Decoration.widget({
        widget: new GhostTextWidget(suggestion.text),
        side: 1,
      });
      return Decoration.set([widget.range(suggestion.pos)]);
    }),
});

export interface GhostTextOptions {
  isEnabled: () => boolean;
  getContext: () => { filename: string; language: string };
  requestCompletion: (params: {
    prefix: string;
    suffix: string;
    filename: string;
    language: string;
  }) => Promise<string>;
  onActivity?: (state: 'idle' | 'thinking') => void;
}

/**
 * CodeMirror 6 inline ghost-text extension backed by local Qwen2.5-Coder-1.5B FIM.
 * - Tab accepts full suggestion
 * - Ctrl/Cmd+Right accepts next word
 * - Escape clears suggestion
 * - Debounced 180ms after typing, with prefix cache and automatic cancellation
 */
export function createGhostTextExtension(options: GhostTextOptions): Extension {
  const prefixCache = new Map<string, string>();
  const MAX_CACHE = 40;

  const acceptFull = (view: EditorView): boolean => {
    const sug = view.state.field(ghostField);
    if (!sug || !sug.text) return false;
    view.dispatch({
      changes: { from: sug.pos, to: sug.pos, insert: sug.text },
      selection: { anchor: sug.pos + sug.text.length },
      effects: setGhostEffect.of(null),
    });
    return true;
  };

  const acceptWord = (view: EditorView): boolean => {
    const sug = view.state.field(ghostField);
    if (!sug || !sug.text) return false;
    const m = sug.text.match(/^(\s*\S+|\s+)/);
    const chunk = m ? m[0] : sug.text;
    const remainder = sug.text.slice(chunk.length);
    view.dispatch({
      changes: { from: sug.pos, to: sug.pos, insert: chunk },
      selection: { anchor: sug.pos + chunk.length },
      effects: setGhostEffect.of(remainder ? { pos: sug.pos + chunk.length, text: remainder } : null),
    });
    return true;
  };

  const dismiss = (view: EditorView): boolean => {
    const sug = view.state.field(ghostField);
    if (!sug) return false;
    view.dispatch({ effects: setGhostEffect.of(null) });
    return true;
  };

  const plugin = ViewPlugin.fromClass(
    class {
      private timer: number | null = null;
      private seq = 0;

      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
          this.timer = null;
        }
        this.seq++;

        if (!options.isEnabled()) return;

        // Only trigger on user typing (not programmatic loads or single deletions)
        const isUserType = update.transactions.some((tr) => tr.isUserEvent('input.type'));
        if (!isUserType) return;

        const sel = update.state.selection.main;
        if (!sel.empty) return;

        const requestId = this.seq;
        const pos = sel.head;
        const docText = update.state.doc.toString();

        // Don't trigger on completely empty buffers
        if (docText.trim().length < 2) return;

        this.timer = window.setTimeout(() => {
          this.timer = null;
          void this.trigger(update.view, requestId, pos, docText);
        }, 180);
      }

      private async trigger(
        view: EditorView,
        requestId: number,
        pos: number,
        docText: string
      ): Promise<void> {
        if (!options.isEnabled()) return;
        const prefix = docText.slice(Math.max(0, pos - 4000), pos);
        const suffix = docText.slice(pos, Math.min(docText.length, pos + 1200));
        const ctx = options.getContext();
        const cacheKey = `${ctx.language}:${prefix.slice(-240)}|${suffix.slice(0, 80)}`;

        const cached = prefixCache.get(cacheKey);
        if (cached) {
          if (requestId === this.seq && view.state.selection.main.head === pos) {
            view.dispatch({ effects: setGhostEffect.of({ pos, text: cached }) });
          }
          return;
        }

        options.onActivity?.('thinking');
        try {
          const text = await options.requestCompletion({
            prefix,
            suffix,
            filename: ctx.filename,
            language: ctx.language,
          });
          if (!text) return;
          if (prefixCache.size >= MAX_CACHE) {
            const firstKey = prefixCache.keys().next().value;
            if (firstKey) prefixCache.delete(firstKey);
          }
          prefixCache.set(cacheKey, text);

          if (requestId === this.seq && view.state.selection.main.head === pos) {
            view.dispatch({ effects: setGhostEffect.of({ pos, text }) });
          }
        } finally {
          options.onActivity?.('idle');
        }
      }

      destroy(): void {
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
          this.timer = null;
        }
      }
    }
  );

  return [
    ghostField,
    plugin,
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptFull },
        { key: 'Mod-ArrowRight', run: acceptWord },
        { key: 'Escape', run: dismiss },
      ])
    ),
  ];
}
