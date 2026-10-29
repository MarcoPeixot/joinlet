import { applyOps, carryRoutes, emptyLayout, emptyModel, own, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, LayoutState, NodeBox } from '@strukt/core';
import { createStore } from 'zustand/vanilla';
import { VIEW_LOCK } from './locks';

export interface Snapshot {
  model: DiagramModel;
  layout: LayoutState;
}

export interface Selection {
  nodes: ID[];
  edges: ID[];
}

export interface DiagramState extends Snapshot {
  selection: Selection;
  past: Snapshot[];
  future: Snapshot[];
  /** Snapshot taken when a drag starts; committed to history when it ends. */
  pending: Snapshot | null;
  lastError: string | null;
  /** Bumped on every failed batch, so a repeated identical error still notifies subscribers. */
  errorSeq: number;
  /**
   * Why editing is locked (an AI draft is pending), or null. `apply`/`arrange`/`undo`/`redo`/`load`
   * fail with this message; `moveLive`/`beginGesture` become no-ops; a gesture already in progress
   * when the lock engaged may still finish through `endGesture`.
   */
  readOnly: string | null;
  apply: (ops: DiagramOp[], positions?: Record<ID, NodeBox>) => boolean;
  moveLive: (positions: Record<ID, NodeBox>) => void;
  /** Router cache for the current geometry: not an undo step and never kept in history. */
  setRoutes: (edges: LayoutState['edges']) => void;
  /** Layout-only undo step (e.g. "Reorganizar"): new positions, same model object. */
  arrange: (positions: Record<ID, NodeBox>) => void;
  beginGesture: () => void;
  /** Ends the gesture; `ops` (e.g. regrouping on drop) and `positions` join the drag in the same undo step. */
  endGesture: (ops?: DiagramOp[], positions?: Record<ID, NodeBox>) => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Partial<Selection>) => void;
  load: (snapshot: Snapshot) => void;
  setReadOnly: (reason: string | null) => void;
}

const HISTORY_LIMIT = 100;
const NO_SELECTION: Selection = { nodes: [], edges: [] };

/** History keeps positions only: routes are derived and recomputed after undo/redo. */
const withoutRoutes = (snapshot: Snapshot): Snapshot => ({ model: snapshot.model, layout: { nodes: snapshot.layout.nodes, edges: {} } });

/**
 * `target` with the current routes of the edges it still has, until the router catches up: without them every
 * connection would flash to a plain line and back on each edit (only the edges that moved do).
 */
const withLiveRoutes = (s: DiagramState, target: Snapshot, edgeIds?: Readonly<Record<ID, ID>>): LayoutState => ({
  nodes: target.layout.nodes,
  edges: carryRoutes(s.layout.edges, s.model, target.model, edgeIds),
});

function push(stack: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const next = [...stack, withoutRoutes(snapshot)];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function prune(selection: Selection, model: DiagramModel): Selection {
  const edgeIds = new Set(model.edges.map((e) => e.id));
  return {
    nodes: selection.nodes.filter((id) => own(model.elements, id)),
    edges: selection.edges.filter((id) => edgeIds.has(id)),
  };
}

/** Undo/redo swap whole snapshots with no op to follow: a kept edge id could now name a parallel sibling. */
function historySelection(selection: Selection, model: DiagramModel): Selection {
  return { nodes: prune(selection, model).nodes, edges: [] };
}

/** Selection after a batch: nodes follow renames, edges follow their (possibly renumbered) ids. */
function follow(selection: Selection, ops: readonly DiagramOp[], edgeIds: Readonly<Record<ID, ID>>): Selection {
  let nodes = selection.nodes;
  for (const op of ops) if (op.op === 'rename') nodes = nodes.map((id) => (id === op.id ? op.to : id));
  return { nodes, edges: selection.edges.flatMap((id) => (Object.hasOwn(edgeIds, id) ? [edgeIds[id]] : [])) };
}

type Commit = { ok: true; patch: Partial<DiagramState> } | { ok: false; message: string };

function failure(s: DiagramState, message: string): Partial<DiagramState> {
  return { lastError: message, errorSeq: s.errorSeq + 1 };
}

/** Applies a batch on top of `s`, recording `before` as its single undo step. */
function commit(s: DiagramState, before: Snapshot, ops: readonly DiagramOp[], positions: Record<ID, NodeBox> = {}): Commit {
  const result = applyOps(s.model, ops);
  if (!result.ok) return { ok: false, message: result.error.message };
  return {
    ok: true,
    patch: {
      model: result.model,
      layout: withLiveRoutes(s, { model: result.model, layout: syncLayout(s.layout, result.model, ops, positions) }, result.edgeIds),
      past: push(s.past, before),
      future: [],
      lastError: null,
      selection: prune(follow(s.selection, ops, result.edgeIds), result.model),
    },
  };
}

export function createDiagramStore(initial?: Snapshot) {
  return createStore<DiagramState>()((set, get) => ({
    model: initial?.model ?? emptyModel(),
    layout: initial?.layout ?? emptyLayout(),
    selection: NO_SELECTION,
    past: [],
    future: [],
    pending: null,
    lastError: null,
    errorSeq: 0,
    readOnly: null,

    apply(ops, positions = {}) {
      const s = get();
      if (s.readOnly) {
        set(failure(s, s.readOnly));
        return false;
      }
      const result = commit(s, { model: s.model, layout: s.layout }, ops, positions);
      if (!result.ok) {
        set(failure(s, result.message));
        return false;
      }
      set(result.patch);
      return true;
    },

    moveLive(positions) {
      if (get().readOnly) return;
      const nodes = { ...get().layout.nodes };
      for (const [id, box] of Object.entries(positions)) nodes[id] = { ...own(nodes, id), ...box };
      // Keep cached routes: edges whose endpoints did not move still match their key.
      set({ layout: { nodes, edges: get().layout.edges } });
    },

    setRoutes(edges) {
      set({ layout: { ...get().layout, edges } });
    },

    arrange(positions) {
      const s = get();
      if (s.readOnly) {
        set(failure(s, s.readOnly));
        return;
      }
      const nodes = { ...s.layout.nodes };
      for (const [id, box] of Object.entries(positions)) if (own(s.model.elements, id)) nodes[id] = { ...own(nodes, id), ...box };
      set({ layout: { nodes, edges: {} }, past: push(s.past, { model: s.model, layout: s.layout }), future: [] });
    },

    beginGesture() {
      const s = get();
      if (s.pending || s.readOnly) return;
      set({ pending: { model: s.model, layout: s.layout } });
    },

    endGesture(ops = [], positions = {}) {
      const s = get();
      // Locked with nothing pending: no gesture to finish, so this must not start committing ops.
      if (s.readOnly && !s.pending) return;
      const before = s.pending ?? { model: s.model, layout: s.layout };
      let outcome: Partial<DiagramState> = { lastError: null };
      if (ops.length) {
        const result = commit(s, before, ops, positions);
        if (result.ok) {
          set({ ...result.patch, pending: null });
          return;
        }
        outcome = failure(s, result.message);
      }
      // `layout.edges` is the router cache: `setRoutes` replaces the layout object mid-gesture without moving anything.
      const moved = before.layout.nodes !== s.layout.nodes || before.model !== s.model;
      set({ ...outcome, pending: null, ...(moved ? { past: push(s.past, before), future: [] } : {}) });
    },

    undo() {
      const s = get();
      if (s.readOnly) {
        set(failure(s, s.readOnly));
        return;
      }
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        model: prev.model,
        layout: withLiveRoutes(s, prev),
        past: s.past.slice(0, -1),
        future: [withoutRoutes({ model: s.model, layout: s.layout }), ...s.future],
        selection: historySelection(s.selection, prev.model),
      });
    },

    redo() {
      const s = get();
      if (s.readOnly) {
        set(failure(s, s.readOnly));
        return;
      }
      const next = s.future[0];
      if (!next) return;
      set({
        model: next.model,
        layout: withLiveRoutes(s, next),
        past: push(s.past, { model: s.model, layout: s.layout }),
        future: s.future.slice(1),
        selection: historySelection(s.selection, next.model),
      });
    },

    select(selection) {
      const s = get();
      set({ selection: { nodes: selection.nodes ?? s.selection.nodes, edges: selection.edges ?? s.selection.edges } });
    },

    load(snapshot) {
      const s = get();
      // A read-only link still shows other diagrams (the lock stays); every other lock holds the diagram it guards.
      if (s.readOnly && s.readOnly !== VIEW_LOCK) {
        set(failure(s, s.readOnly));
        return;
      }
      set({ ...snapshot, past: [], future: [], pending: null, selection: NO_SELECTION, lastError: null });
    },

    setReadOnly(reason) {
      set({ readOnly: reason });
    },
  }));
}

export type DiagramStore = ReturnType<typeof createDiagramStore>;
