import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
export interface SelectionAnchor { left: number; top: number; width: number }

/** Read geometry after CodeMirror finishes updating; formatting keeps the editor's original selection. */
export function selectionToolbar(onChange: (anchor: SelectionAnchor | null) => void) {
  return ViewPlugin.fromClass(class {
    frame = 0;
    onScroll = () => this.schedule();
    constructor(readonly view: EditorView) { this.schedule(); view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true }); window.addEventListener('resize', this.onScroll); }
    schedule() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.measure()); }
    measure() {
      const { from, to, empty } = this.view.state.selection.main;
      if (empty || this.view.state.readOnly) { onChange(null); return; }
      if (!this.view.hasFocus) return;
      const start = this.view.coordsAtPos(from), end = this.view.coordsAtPos(to);
      const editor = this.view.scrollDOM.getBoundingClientRect();
      if (!start || !end || start.top < editor.top || start.top > editor.bottom) { onChange(null); return; }
      const width = Math.max(180, Math.min(340, window.innerWidth - 24, editor.width - 24));
      onChange({ width, left: Math.max(editor.left + 12, Math.min(editor.right - width - 12, (start.left + end.right) / 2 - width / 2)), top: Math.max(editor.top + 4, start.top - 46) });
    }
    update(update: ViewUpdate) { if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged || update.viewportChanged) this.schedule(); }
    destroy() { cancelAnimationFrame(this.frame); this.view.scrollDOM.removeEventListener('scroll', this.onScroll); window.removeEventListener('resize', this.onScroll); }
  });
}
