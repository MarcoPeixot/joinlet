import { EditorView } from '@codemirror/view';

/** CodeMirror chrome in the app's tokens (code panel and doc editor); the host surface shows through. */
export const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', color: 'var(--sk-ink)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--sk-accent)', paddingBlock: '10px' },
  '.cm-cursor': { borderLeftColor: 'var(--sk-accent)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--sk-faint)', border: 'none', paddingLeft: '6px' },
  '.cm-lineNumbers .cm-gutterElement': { paddingRight: '10px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--sk-panel-2) 70%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--sk-muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--sk-accent-soft)' },
  '.cm-placeholder': { color: 'var(--sk-faint)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--sk-accent-soft)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--sk-panel)',
    border: '1px solid var(--sk-line-strong)',
    borderRadius: 'var(--sk-radius-control)',
    boxShadow: 'var(--sk-shadow-pop)',
    color: 'var(--sk-ink)',
    overflow: 'hidden',
  },
});
