import { uiText } from '../i18n';
import { isViewOnly } from '../workspace/boot';
import { computeRects, own } from '@strukt/core';
import type { DiagramElement, ID, NodeBox } from '@strukt/core';
import { freeSpot, ITEM_LIST, knownFolders, NOTE_COLORS, NOTE_SIZE, SECTION_SIZE, spaceBoard, updateConnection } from '@strukt/workspace';
import type { Board, BoardCard, BoardConnection, ItemKind, Manifest } from '@strukt/workspace';
import { Panel, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Expand, Square, StickyNote } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShortcuts } from '../app/useShortcuts';
import type { ShortcutCanvas } from '../app/useShortcuts';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { CanvasScopeProvider } from '../canvas/scope';
import type { CanvasScope, OverviewScope } from '../canvas/scope';
import { createRouteRunner } from '../state/routeRunner';
import { startRouting } from '../state/routing';
import { createDiagramStore } from '../state/diagramStore';
import { VIEW_LOCK } from '../state/locks';
import { EmptyState } from '../ui/EmptyState';
import { FlowToggle } from '../ui/FlowToggle';
import { IconButton } from '../ui/IconButton';
import { showToast } from '../ui/uiStore';
import { openItem } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { RepositoryEnrichmentNotice } from '../panels/RepositoryEnrichmentNotice';
import { boardInFolder } from './boardFlow';
import { withBends } from './bends';
import { OverviewCardNode } from './CardNode';
import { boardToScene, matchConnections, removalOps, sceneToBoard } from './scene';
import './board.css';

const nodeTypes = { boardCard: OverviewCardNode };
/** Cards are drawn by the Overview's own node; sections are the canvas's groups. */
const typeOf = (el: DiagramElement) => (el.kind === 'node' ? ('boardCard' as const) : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const currentBoard = (): Board | undefined => workspace.store.getState().data?.board;

function titleOf(manifest: Manifest | undefined) {
  return (card: BoardCard) => {
    if (card.kind === 'note') return card.text ?? '';
    const kind = card.kind as ItemKind;
    return manifest?.[ITEM_LIST[kind]].find((entry) => entry.slug === card.slug)?.title ?? card.slug ?? card.id;
  };
}

/**
 * The Overview on the one canvas (canvas/DiagramCanvas.tsx): `board.json` turned into a diagram model on a store of
 * its own (board/scene.ts), so it moves, connects, groups, routes and undoes exactly like a diagram, and every
 * edit is written back to the board. Sections are groups that hug their cards; what only the Overview has stays:
 * item previews, notes, the manual elbow of a connection, the folder filter, double click to open.
 */
function OverviewCanvas() {
  const viewOnly = isViewOnly();
  const board = useWorkspace((s) => s.data?.board);
  const manifest = useWorkspace((s) => s.data?.manifest);
  const [folder, setFolder] = useState('');
  const choseFolder = useRef(false);
  const folders = useMemo(() => (manifest ? knownFolders([...manifest.diagrams, ...manifest.docs, ...manifest.sketches]) : []), [manifest]);
  const visible = useMemo(() => (board && manifest ? boardInFolder(board, manifest, folder) : board), [board, manifest, folder]);
  useEffect(() => { if (!choseFolder.current && (manifest?.docs.filter((d) => d.source).length ?? 0) > 12) { choseFolder.current = true; setFolder('__main__'); } }, [manifest]);
  useEffect(() => { if (folder && folder !== '__root__' && folder !== '__main__' && !folders.includes(folder)) setFolder(''); }, [folder, folders]);
  const flow = useReactFlow();
  const store = useMemo(() => createDiagramStore(), []);
  const [focusId, setFocusId] = useState<ID | null>(null);
  /** The board this canvas last wrote: when it comes back from the workspace it is not reloaded (history stays). */
  const written = useRef<Board | null>(null);
  const shownFolder = useRef<string | null>(null);
  /** Ids the canvas has drawn since it loaded: one gone from the canvas is gone from the board; the rest is kept. */
  const drawn = useRef(new Set<ID>());
  /** Removed connections remain available to undo, including their stable id and manual bend. */
  const connections = useRef(new Map<string, BoardConnection>());
  const loading = useRef(false);

  // The board changed elsewhere (a new item, another tab, a pull) or the folder filter changed: draw it afresh.
  useLayoutEffect(() => {
    if (!visible || !board) return;
    if (board === written.current && shownFolder.current === folder) return;
    written.current = board;
    shownFolder.current = folder;
    const snapshot = boardToScene(visible, titleOf(manifest));
    connections.current = new Map(board.connections.map((c) => [c.id, c]));
    drawn.current = new Set(snapshot.model.order);
    loading.current = true;
    store.getState().load(snapshot);
    loading.current = false;
  }, [visible, board, folder, manifest, store]);

  useEffect(() => store.getState().setReadOnly(viewOnly ? VIEW_LOCK : null), [store, viewOnly]);

  // Every committed edit is written back to the board (a drag once, when it ends).
  useEffect(() => store.subscribe((state, prev) => {
    if (loading.current || state.pending) return;
    const before = prev.pending ?? prev;
    if (state.model === before.model && state.layout.nodes === before.layout.nodes) return;
    const base = currentBoard();
    if (!base) return;
    for (const id of state.model.order) drawn.current.add(id);
    const next = sceneToBoard(state, base, drawn.current, [...connections.current.values()]);
    for (const connection of next.connections) connections.current.set(connection.id, connection);
    written.current = next;
    workspace.updateBoard(() => next);
  }), [store]);

  const bendOf = useCallback((edgeId: ID) => {
    const base = currentBoard();
    return base ? matchConnections(store.getState(), base.connections).get(edgeId)?.bend : undefined;
  }, [store]);

  // Routed like a diagram; a connection with a manual elbow keeps it.
  useEffect(() => {
    const route = createRouteRunner();
    return startRouting(store, async (model, rects) => withBends(await route(model, rects), model, rects, bendOf));
  }, [store, bendOf]);

  const overview = useMemo<OverviewScope>(() => ({
    card(id) {
      const el = own(store.getState().model.elements, id);
      const known = currentBoard()?.cards.find((card) => card.id === id);
      if (known && known.kind !== 'note') return known;
      if (!el || el.kind !== 'node') return undefined;
      // A note shows what the canvas holds (its text is the element's label, its color the element's).
      return { ...(known ?? { id, kind: 'note', x: 0, y: 0, ...NOTE_SIZE }), text: el.label ?? '', ...(el.color ? { color: el.color } : {}) };
    },
    focusId,
    setNote(id, patch) {
      store.getState().apply([{ op: 'update', id, set: { ...(patch.text !== undefined ? { label: patch.text || null } : {}), ...(patch.color ? { color: patch.color } : {}) } }]);
    },
    bend: bendOf,
    setBend(edgeId, bend) {
      const base = currentBoard();
      const connection = base && matchConnections(store.getState(), base.connections).get(edgeId);
      if (!base || !connection) return;
      const next = updateConnection(base, connection.id, { bend });
      for (const connection of next.connections) connections.current.set(connection.id, connection);
      written.current = next;
      workspace.updateBoard(() => next);
      // Drawn at once: the elbow, or (back to routing) no route until the router draws one.
      const state = store.getState();
      const routes = { ...state.layout.edges };
      delete routes[edgeId];
      state.setRoutes(bend === null ? routes : withBends(routes, state.model, computeRects(state.model, state.layout), bendOf));
    },
    open(id) {
      const card = currentBoard()?.cards.find((c) => c.id === id);
      if (card && card.kind !== 'note' && card.slug) void openItem(card.kind, card.slug);
    },
  }), [store, focusId, bendOf]);

  /** Delete: notes, sections (their cards stay) and connections; diagrams, docs and sketches go from the sidebar. */
  const remove = useCallback(() => {
    const state = store.getState();
    const base = currentBoard();
    if (!base) return;
    const { ops, refused } = removalOps(state.model, state.selection, base);
    if (refused) showToast(uiText("Diagramas, documentos e sketches são excluídos pela barra lateral."));
    if (ops.length) state.apply(ops);
    state.select({ nodes: [], edges: [] });
  }, [store]);

  const scope = useMemo<CanvasScope>(() => ({ kind: 'overview', store, overview }), [store, overview]);
  const shortcuts = useMemo<ShortcutCanvas>(() => ({ kind: 'overview', store, remove: viewOnly ? undefined : remove }), [store, remove, viewOnly]);
  const noCenter = useCallback(() => ({ x: 0, y: 0 }), []);
  useShortcuts(noCenter, shortcuts);

  const center = (size: { w: number; h: number }) => {
    const pane = document.querySelector('.strukt-board')?.getBoundingClientRect();
    const point = flow.screenToFlowPosition({ x: (pane?.left ?? 0) + (pane?.width ?? 800) / 2, y: (pane?.top ?? 0) + (pane?.height ?? 600) / 2 });
    return { x: Math.round(point.x - size.w / 2), y: Math.round(point.y - size.h / 2) };
  };
  /** The part of the board on screen, in flow coordinates (inset from the edges and clear of the toolbar). */
  const visibleBounds = () => {
    const pane = document.querySelector('.strukt-board')?.getBoundingClientRect();
    if (!pane) return undefined;
    const topLeft = flow.screenToFlowPosition({ x: pane.left + 16, y: pane.top + 56 });
    const bottomRight = flow.screenToFlowPosition({ x: pane.right - 16, y: pane.bottom - 16 });
    return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
  };
  const addNoteHere = () => {
    const base = currentBoard();
    if (!base) return;
    const id = crypto.randomUUID();
    const at = freeSpot(base, center(NOTE_SIZE), NOTE_SIZE, visibleBounds());
    if (!store.getState().apply([{ op: 'add_node', id, color: NOTE_COLORS[0] }], { [id]: { ...at, ...NOTE_SIZE } })) return;
    store.getState().select({ nodes: [id], edges: [] });
    setFocusId(id);
  };
  const addSectionHere = () => {
    const base = currentBoard();
    if (!base) return;
    const id = crypto.randomUUID();
    // In a free spot like a note: drawn over cards it would look like it holds them, and it holds nothing yet.
    const at = freeSpot(base, center(SECTION_SIZE), SECTION_SIZE, visibleBounds());
    store.getState().apply([{ op: 'add_group', id, label: uiText("Nova seção") }], { [id]: { ...at, ...SECTION_SIZE } });
  };
  const spaceOverview = () => {
    const base = currentBoard();
    if (!base) return;
    const spaced = spaceBoard(base);
    const positions: Record<ID, NodeBox> = {};
    for (const item of [...spaced.cards, ...spaced.sections]) positions[item.id] = { x: item.x, y: item.y, w: item.w, h: item.h };
    store.getState().arrange(positions);
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 250 }));
  };

  const cardCount = visible?.cards.length ?? 0;
  return (
    <CanvasScopeProvider value={scope}>
      <DiagramCanvas className="strukt-board" nodeTypes={nodeTypes} typeOf={typeOf} onNodeDoubleClick={overview.open}>
        <Panel position="top-left" className="sk-overview-tools sk-float flex items-center gap-0.5 rounded-panel p-1">
          {!viewOnly && <>
            <IconButton label={uiText("Nova nota")} onClick={addNoteHere}>
              <StickyNote />
              <span className="text-caption font-medium">{uiText("Nota")}</span>
            </IconButton>
            <IconButton label={uiText("Nova seção")} onClick={addSectionHere}>
              <Square />
              <span className="text-caption font-medium">{uiText("Seção")}</span>
            </IconButton>
            <IconButton label={uiText("Espaçar Overview")} title={uiText("Aumentar o espaço entre os cards e as conexões do Overview")} onClick={spaceOverview} disabled={(board?.cards.length ?? 0) < 2}>
              <Expand />
              <span className="sk-overview-spacing-text text-caption font-medium">{uiText("Espaçar")}</span>
            </IconButton>
            <span className="mx-1 h-5 w-px bg-line" />
          </>}
          <FlowToggle>
            <span className="text-caption font-medium">{uiText("Fluxo")}</span>
          </FlowToggle>
          {folders.length > 0 && <select aria-label={uiText('Filtrar Overview por pasta')} className="max-w-44 rounded bg-panel px-2 py-1 text-caption" value={folder} onChange={(event) => { choseFolder.current = true; setFolder(event.target.value); }}><option value="">{uiText('Todos os itens')}</option><option value="__main__">{uiText('Visão principal')}</option><option value="__root__">{uiText('Sem pasta')}</option>{folders.map((path) => <option key={path} value={path}>{path}</option>)}</select>}
        </Panel>
        {!viewOnly && <Panel position="top-left" style={{ top: 52 }}><RepositoryEnrichmentNotice /></Panel>}
        <Panel position="bottom-right" className="sk-overview-status sk-corner rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-meta text-muted">
          {plural(cardCount, 'card', 'cards')} {"·"} {plural(visible?.connections.length ?? 0, uiText("conexão"), uiText("conexões"))} <span className="sk-overview-hint">{uiText("· duplo clique abre ou rotula")}</span>
        </Panel>
        {(board?.cards.length ?? 0) === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <EmptyState className="pointer-events-auto" illustration="board" title={uiText("O overview está vazio")} text={uiText("Reúna diagramas, documentos e notas num só lugar e ligue as ideias.")} action={viewOnly ? undefined : { label: uiText("Nova nota"), icon: <StickyNote size={14} />, onClick: addNoteHere }} />
          </div>
        )}
      </DiagramCanvas>
    </CanvasScopeProvider>
  );
}

/** The Overview (spec §3 M4): the workspace's items, notes and sections on the same canvas as a diagram. */
export function BoardView() {
  return (
    <ReactFlowProvider>
      <OverviewCanvas />
    </ReactFlowProvider>
  );
}
