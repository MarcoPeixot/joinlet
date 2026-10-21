import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { PresenceState } from '@strukt/workspace/collaboration';
import * as Y from 'yjs';
import type { Collaborator } from '../workspace/collaboration';

/** What the editor draws for another person: their selection (`from` = `to` for a plain cursor), name and color. */
export interface RemoteCursor {
  from: number;
  to: number;
  name: string;
  color: string;
}

/** This client's selection as presence: Yjs relative positions, so it still points at the same text after concurrent edits. */
export function selectionPresence(ytext: Y.Text, anchor: number, head: number): NonNullable<PresenceState['doc']> {
  const at = (index: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, Math.max(0, Math.min(index, ytext.length)))) as NonNullable<PresenceState['doc']>['anchor'];
  return { anchor: at(anchor), head: at(head) };
}

/** The others' selections as offsets into `ytext` right now; anyone without a document selection here is left out. */
export function resolveCursors(peers: readonly Collaborator[], ytext: Y.Text): RemoteCursor[] {
  const doc = ytext.doc;
  if (!doc) return [];
  const resolve = (json: unknown): number | null => {
    try {
      const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc);
      return absolute && absolute.type === ytext ? Math.max(0, Math.min(absolute.index, ytext.length)) : null;
    } catch { return null; }
  };
  return peers.flatMap((peer) => {
    const selection = peer.state?.doc;
    if (!selection) return [];
    const anchor = resolve(selection.anchor);
    const head = resolve(selection.head);
    if (anchor === null || head === null) return [];
    return [{ from: Math.min(anchor, head), to: Math.max(anchor, head), name: peer.name, color: peer.color }];
  });
}

class Caret extends WidgetType {
  constructor(readonly name: string, readonly color: string) { super(); }
  eq(other: Caret): boolean { return other.name === this.name && other.color === this.color; }
  toDOM(): HTMLElement {
    // The name is drawn by CSS (`::after`), never as text: the editor's text content must stay the document's text.
    const caret = document.createElement('span');
    caret.className = 'cm-remote-caret';
    caret.dataset.name = this.name;
    caret.style.setProperty('--remote-color', this.color);
    caret.setAttribute('aria-hidden', 'true');
    return caret;
  }
  ignoreEvent(): boolean { return true; }
}

/** Replaces the remote cursors drawn in the editor. */
export const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setRemoteCursors)) continue;
      const length = transaction.state.doc.length;
      const ranges: Range<Decoration>[] = [];
      for (const cursor of effect.value) {
        const from = Math.min(cursor.from, length);
        const to = Math.min(cursor.to, length);
        if (to > from) ranges.push(Decoration.mark({ class: 'cm-remote-selection', attributes: { style: `background-color: ${cursor.color}33` } }).range(from, to));
        ranges.push(Decoration.widget({ widget: new Caret(cursor.name, cursor.color), side: 1 }).range(to));
      }
      value = Decoration.set(ranges, true);
    }
    return value;
  },
  provide: (self) => EditorView.decorations.from(self),
});

const theme = EditorView.theme({
  '.cm-remote-caret': { position: 'relative', borderLeft: '2px solid var(--remote-color)', marginLeft: '-1px', marginRight: '-1px', pointerEvents: 'none' },
  '.cm-remote-caret::after': { content: 'attr(data-name)', position: 'absolute', top: '-1.45em', left: '-2px', padding: '0 5px', borderRadius: '4px 4px 4px 0', backgroundColor: 'var(--remote-color)', color: '#fff', fontFamily: 'var(--font-ui)', fontSize: '11px', fontWeight: '500', lineHeight: '1.45', whiteSpace: 'nowrap', userSelect: 'none' },
});

/** CodeMirror extension that shows the others' cursors and selections with their names (feed it with `setRemoteCursors`). */
export const remoteCursors = [field, theme];
