import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { docCommentBridge } from './commentBridge';

/** A passage with a conversation, as offsets into the doc right now. */
export interface MarkedRange { id: string; from: number; to: number; resolved: boolean; active: boolean }

/** Replaces the passages the editor marks. */
export const setCommentRanges = StateEffect.define<MarkedRange[]>();

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setCommentRanges)) continue;
      const length = transaction.state.doc.length;
      const ranges: Range<Decoration>[] = [];
      for (const range of effect.value) {
        const from = Math.max(0, Math.min(range.from, length));
        const to = Math.max(0, Math.min(range.to, length));
        if (to <= from) continue;
        ranges.push(Decoration.mark({
          class: `cm-comment${range.resolved ? ' cm-comment-resolved' : ''}${range.active ? ' cm-comment-active' : ''}`,
          attributes: { 'data-comment': range.id },
        }).range(from, to));
      }
      value = Decoration.set(ranges, true);
    }
    return value;
  },
  provide: (self) => EditorView.decorations.from(self),
});

const theme = EditorView.theme({
  '.cm-comment': { backgroundColor: 'var(--sk-accent-soft)', borderBottom: '2px solid var(--sk-accent)', cursor: 'pointer' },
  '.cm-comment-resolved': { backgroundColor: 'transparent', borderBottom: '2px dotted var(--sk-line-strong)' },
  '.cm-comment-active': { boxShadow: '0 0 0 2px var(--sk-accent)', borderRadius: '2px' },
});

/**
 * CodeMirror extension for comments: the passages that have a conversation are marked (feed it with
 * `setCommentRanges`), a click on one opens it, and ⌘⌥M comments on the selection.
 */
export const commentMarks = [
  field,
  theme,
  EditorView.domEventHandlers({
    click(event) {
      const mark = (event.target as HTMLElement | null)?.closest?.('[data-comment]');
      const id = mark?.getAttribute('data-comment');
      if (id) docCommentBridge.open?.(id);
      return false;
    },
  }),
  keymap.of([{ key: 'Mod-Alt-m', run: () => { docCommentBridge.comment?.(); return true; } }]),
];
