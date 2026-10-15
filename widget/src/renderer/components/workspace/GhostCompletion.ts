import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { Prec, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
export interface GhostSuggestion { position: number; text: string; source: Text }
export const setGhostSuggestion = StateEffect.define<GhostSuggestion | null>();
class GhostWidget extends WidgetType {
  constructor(private readonly text: string) { super(); }
  toDOM(): HTMLElement { const dom = document.createElement('span'); dom.className = 'code-ghost-completion'; dom.style.cssText = 'opacity:0.5;white-space:pre-wrap;pointer-events:none'; dom.textContent = this.text; dom.setAttribute('aria-hidden', 'true'); return dom; }
}
export const ghostSuggestionField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) value = null;
    for (const effect of transaction.effects) if (effect.is(setGhostSuggestion)) value = effect.value;
    if (value && (!transaction.state.doc.eq(value.source) || !transaction.state.selection.main.empty || transaction.state.selection.main.head !== value.position)) return null;
    return value;
  },
  provide: field => EditorView.decorations.from(field, (value): DecorationSet => value ? Decoration.set([Decoration.widget({ widget: new GhostWidget(value.text), side: 1 }).range(value.position)]) : Decoration.none),
});
export function acceptGhostSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(ghostSuggestionField, false);
  if (!suggestion || view.state.readOnly || !view.state.doc.eq(suggestion.source) || !view.state.selection.main.empty || view.state.selection.main.head !== suggestion.position) return false;
  view.dispatch({ changes: { from: suggestion.position, insert: suggestion.text }, selection: { anchor: suggestion.position + suggestion.text.length }, effects: setGhostSuggestion.of(null), userEvent: 'input.complete' });
  return true;
}
export const ghostCompletionExtension: Extension = [ghostSuggestionField, Prec.highest(keymap.of([
  { key: 'Tab', run: acceptGhostSuggestion },
  { key: 'Escape', run: view => { if (!view.state.field(ghostSuggestionField, false)) return false; view.dispatch({ effects: setGhostSuggestion.of(null) }); return true; } },
]))];
