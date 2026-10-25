import { uiText } from '../i18n';
import { selectPresentationComponent } from '../present/presentStore';
import { center, connectorStyle, descendantsOf, innermostGroupAt, isAncestor, own, translateSubtree } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, NodeBox, Rect, SnapGuide } from '@strukt/core';
import { Background, BackgroundVariant, ConnectionMode, Panel, ReactFlow, useReactFlow } from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange, OnNodeDrag } from '@xyflow/react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { draftProjection } from '../ai/overlay';
import { useAi } from '../ai/session';
import { StruktEdgeView } from '../diagram/edges/StruktEdge';
import { GroupNode } from '../diagram/nodes/GroupNode';
import { IconNode } from '../diagram/nodes/IconNode';
import { ShapeNode } from '../diagram/nodes/ShapeNode';
import { CardNode } from '../diagram/nodes/CardNode';
import { TableNode } from '../diagram/nodes/TableNode';
import { ParticipantNode } from '../diagram/nodes/ParticipantNode';
import { enterMarks } from '../diagram/enter';
import type { EnterMarks } from '../diagram/enter';
import { DIM_OPACITY, neighborhood, reachFocus, withPreview } from '../diagram/focus';
import { toFlow } from '../diagram/toFlow';
import type { ElementNode, FlowProjection, StruktEdge } from '../diagram/toFlow';
import { diagramStore, useDiagram } from '../state/appStore';
import { CANVAS } from '../ui/theme';
import { useIsMobile } from '../ui/useBreakpoint';
import { ZoomControls } from '../ui/ZoomControls';
import { useDockOpen } from '../ui/dock';
import { canvasWidth } from '../ui/room';
import { uiStore, useUi } from '../ui/uiStore';
import { useVersions } from '../versions/session';
import { useBranchCompare } from '../github/compare';
import { useWorkspace } from '../workspace/appWorkspace';
import { HelperLines } from './HelperLines';
import { snapDraggedRect } from './snapping';
import { fitOptionsFor } from './fit';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { WatercolorDefs } from './WatercolorDefs';
import { evidenceFor } from '../workspace/lookup';

const nodeTypes = { shape: ShapeNode, icon: IconNode, card: CardNode, table: TableNode, participant: ParticipantNode, sgroup: GroupNode };
const edgeTypes = { strukt: StruktEdgeView };
const DiagramMiniMap = lazyWithRetry(() => import('./DiagramMiniMap').then(m => ({ default: m.DiagramMiniMap })));
const NodeHoverCard = lazyWithRetry(() => import('./NodeHoverCard').then(m => ({ default: m.NodeHoverCard })));

/** Above this many nodes React Flow only mounts the ones in view; the minimap is skipped past the second limit. */
const VIRTUALIZE_ABOVE = 150;
const MINIMAP_MAX_NODES = 400;

function motionOff(): boolean {
  return uiStore.getState().reduceMotion || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const joinClass = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * What the last commit added, for a moment: nodes fade in staggered (opacity only) and new edges draw in once.
 * Nothing when motion is reduced, when the diagram was swapped, or when a draft/compare preview is showing.
 */
function useEnterMarks(model: DiagramModel, slug: string | null): EnterMarks | null {
  const [track, setTrack] = useState<{ model: DiagramModel; slug: string | null; marks: EnterMarks | null }>({ model, slug, marks: null });
  // Derived while rendering (not in an effect) so the class is on the very first frame of the new nodes.
  if (track.model !== model || track.slug !== slug) {
    const found = track.slug === slug && !motionOff() ? enterMarks(snapshot(track.model), snapshot(model)) : null;
    setTrack({ model, slug, marks: found ?? (track.slug === slug ? track.marks : null) });
  }
  const { marks } = track;
  useEffect(() => {
    if (!marks) return;
    const longest = Math.max(0, ...Object.values(marks.nodes));
    const timer = setTimeout(() => setTrack((current) => (current.marks === marks ? { ...current, marks: null } : current)), longest + 700);
    return () => clearTimeout(timer);
  }, [marks]);
  return marks;
}

const snapshot = (model: DiagramModel) => ({ nodes: model.order, edges: model.edges.map((edge) => edge.id) });

function withEnter(projection: FlowProjection, marks: EnterMarks): FlowProjection {
  return {
    ...projection,
    nodes: projection.nodes.map((node) => {
      const delay = own(marks.nodes, node.id);
      if (delay === undefined) return node;
      return { ...node, className: joinClass(node.className, 'sk-enter'), style: { ...node.style, '--sk-enter-delay': `${delay}ms` } as CSSProperties };
    }),
    edges: projection.edges.map((edge) => {
      if (!marks.edges.has(edge.id) || !edge.data || connectorStyle(edge.data.edge.connector).dashed) return edge;
      return { ...edge, className: joinClass(edge.className, 'sk-edge-draw'), data: { ...edge.data, draw: true } };
    }),
  };
}

function toggle(list: ID[], id: ID, on: boolean): ID[] {
  if (on) return list.includes(id) ? list : [...list, id];
  return list.filter((other) => other !== id);
}

export function DiagramCanvas() {
  const model = useDiagram((s) => s.model);
  const layout = useDiagram((s) => s.layout);
  const selection = useDiagram((s) => s.selection);
  const theme = useUi((s) => s.theme);
  const frozen = useUi((s) => s.frozen);
  const fitRequest = useUi((s) => s.fitRequest);
  const aiDraft = useAi((s) => s.draft);
  const comparing = useVersions((s) => s.view?.preview ?? null);
  const compareOldLayout = useVersions((s) => s.view?.oldLayout ?? null);
  const branchPreview = useBranchCompare((s) => s.preview);
  const branchOldLayout = useBranchCompare((s) => s.oldLayout);
  const minimap = useUi((s) => s.minimap);
  const presenting = useUi((s) => s.presenting);
  const activeFlowEdges = useUi((s) => s.activeFlowEdges);
  const activeFlowNodes = useUi((s) => s.activeFlowNodes);
  const activeTag = useUi((s) => s.activeTag);
  const shared = useWorkspace((s) => s.data?.shared);
  const diagramSlug = useWorkspace((s) => s.diagram);
  const evidence = useWorkspace((s) => evidenceFor(s.data, s.diagram));
  // A perspective is a way of reading the diagram, not an edit: the model below stays whole and only what is drawn changes.
  const read = useUi((s) => s.perspectiveRead);
  // Hiding changes the geometry the pointer works on: the canvas does not move or connect things while it is on.
  const reading = read?.reading;
  // An AI draft and a version compare are the same read-only diff preview (only one can be open at a time).
  const draft = aiDraft ?? comparing ?? branchPreview;
  const flow = useReactFlow();
  const mobile = useIsMobile();
  const fitInset = useUi((s) => s.fitInsetBottom);
  // How wide the pane is next to the docked chrome: a narrow one keeps the fitted diagram clear of the tool palette.
  const dockOpen = useDockOpen();
  const paneWidth = useUi((s) => canvasWidth(window.innerWidth, { sidebar: s.sidebarOpen, code: s.codeOpen ? s.codeWidth : null, dock: dockOpen && !mobile, sidebarWidth: s.sidebarWidth, dockWidth: s.dockWidth }));
  const fitOptions = useMemo(() => fitOptionsFor(mobile, fitInset, paneWidth), [mobile, fitInset, paneWidth]);
  // Read through a ref: opening the AI composer changes the inset but must not re-fit the view by itself.
  const fitRef = useRef(fitOptions);
  fitRef.current = fitOptions;
  useEffect(() => {
    if (!fitRequest) return;
    // Wait a frame so React Flow has the new nodes before measuring the bounds.
    const targets = uiStore.getState().fitNodes;
    const frame = requestAnimationFrame(() => void flow.fitView({ ...fitRef.current, ...(targets ? { nodes: targets.map(id => ({ id })) } : {}), duration: 200 }));
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, flow]);
  // Rotating a phone (or crossing the breakpoint) re-fits once the resizing settles.
  useEffect(() => {
    if (!mobile) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void flow.fitView({ ...fitRef.current, duration: 200 }), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [mobile, flow]);
  // The bottom sheet (Propriedades) covers the lower ~45 % of a phone: bring a selected node above it.
  const selectedId = selection.nodes.length === 1 && !selection.edges.length ? selection.nodes[0]! : null;
  useEffect(() => {
    if (!mobile || !selectedId) return;
    const frame = requestAnimationFrame(() => {
      const internal = flow.getInternalNode(selectedId);
      if (!internal) return;
      const bottom = flow.flowToScreenPosition({ x: internal.internals.positionAbsolute.x, y: internal.internals.positionAbsolute.y + (internal.measured.height ?? 0) }).y;
      const sheetTop = window.innerHeight * 0.55 - 8;
      const delta = bottom + 28 - sheetTop;
      if (delta > 0) {
        const view = flow.getViewport();
        void flow.setViewport({ ...view, y: view.y - delta }, { duration: 200 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [mobile, selectedId, flow]);
  // One element selected, nothing being dragged: it glows, its neighbours stay lit, its edges pulse, the rest
  // fades (a passport "Antes/Depois" chain or a hovered row narrows or widens what stays lit).
  const reachChain = useUi((s) => s.reach);
  const preview = useUi((s) => s.focusPreview);
  const focused = !draft && !frozen && selection.nodes.length === 1 && !selection.edges.length ? selection.nodes[0]! : null;
  const focus = useMemo(() => {
    if (!focused) return null;
    const base = reachChain?.origin === focused ? reachFocus(model, focused, reachChain.direction) : neighborhood(model, focused);
    return preview ? withPreview(model, base, preview) : base;
  }, [focused, model, reachChain, preview]);
  // While an AI draft is pending the canvas shows the proposal (read-only), not the diagram.
  const projection = useMemo(() => {
    const result = draft ? draftProjection(draft, draft === branchPreview ? branchOldLayout ?? layout : draft === comparing ? compareOldLayout ?? layout : layout, theme) : toFlow(read?.model ?? model, read?.layout ?? layout, selection, theme, frozen ?? undefined, focus, evidence);
    if (draft) return result;
    if (!activeFlowEdges.length && !activeFlowNodes.length && activeTag && diagramSlug) {
      const matching = new Set(model.order.filter((id) => {
        const view = shared && own(shared.views, diagramSlug);
        const entityId = view && own(view, id);
        return entityId && shared && own(shared.entities, entityId)?.tags?.includes(activeTag);
      }));
      return {
        ...result,
        nodes: result.nodes.map((node) => ({ ...node, className: matching.has(node.id) ? 'sk-focus-origin' : 'sk-dim' })),
        edges: result.edges.map((edge) => {
          const linked = model.edges.find((item) => item.id === edge.id);
          const visible = linked && matching.has(linked.from) && matching.has(linked.to);
          return visible ? edge : { ...edge, className: 'sk-dim', data: edge.data ? { ...edge.data, dimmed: true } : undefined };
        }),
      };
    }
    if (!activeFlowEdges.length && !activeFlowNodes.length) return result;
    const edgeIds = new Set(activeFlowEdges);
    const nodeIds = new Set(activeFlowNodes);
    for (const edge of model.edges) if (edgeIds.has(edge.id)) { nodeIds.add(edge.from); nodeIds.add(edge.to); }
    return {
      ...result,
      nodes: result.nodes.map((node) => ({ ...node, className: nodeIds.has(node.id) ? 'sk-focus-origin' : 'sk-dim' })),
      edges: result.edges.map((edge): StruktEdge => {
        if (!edge.data) return edge;
        return edgeIds.has(edge.id)
          ? { ...edge, className: 'sk-focus-edge', data: { ...edge.data, focus: 'out', dimmed: false } }
          : { ...edge, className: 'sk-dim', data: { ...edge.data, focus: undefined, dimmed: true } };
      }),
    };
  }, [draft, branchPreview, branchOldLayout, comparing, compareOldLayout, model, layout, read, selection, theme, frozen, focus, activeFlowEdges, activeFlowNodes, activeTag, shared, diagramSlug, evidence]);
  const entering = useEnterMarks(model, diagramSlug ?? null);
  const dimmedProjection = useMemo(() => (draft || !read ? projection : read.dim(projection)), [projection, read, draft]);
  const shown = useMemo(() => (entering && !draft ? withEnter(dimmedProjection, entering) : dimmedProjection), [dimmedProjection, entering, draft]);
  const rectsRef = useRef(projection.rects);
  rectsRef.current = projection.rects;
  const draggedRef = useRef<ID | null>(null);

  const onNodesChange = useCallback((changes: NodeChange<ElementNode>[]) => {
    const state = diagramStore.getState();
    const rects = rectsRef.current;
    const moving = new Set(changes.flatMap((c) => (c.type === 'position' && c.position ? [c.id] : [])));
    const positions: Record<ID, NodeBox> = {};
    let selected: ID[] | null = null;
    let guides: SnapGuide[] | null = null;
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        const el = state.model.elements[change.id];
        const current = rects[change.id];
        if (!el || !current) continue;
        // A dragged ancestor already carries this element along.
        if ([...moving].some((other) => other !== change.id && isAncestor(state.model, other, change.id))) continue;
        const parent = el.parentId ? rects[el.parentId] : undefined;
        let x = change.position.x + (parent?.x ?? 0);
        let y = change.position.y + (parent?.y ?? 0);
        if (moving.size === 1 && (change.dragging || change.id === draggedRef.current)) {
          const snap = snapDraggedRect(state.model, rects, change.id, x, y);
          x = snap.x;
          y = snap.y;
          if (change.dragging) guides = snap.guides;
        }
        if (el.kind === 'group') Object.assign(positions, translateSubtree(state.model, rects, change.id, x - current.x, y - current.y));
        else positions[change.id] = { x, y };
      } else if (change.type === 'select') {
        selected = toggle(selected ?? [...state.selection.nodes], change.id, change.selected);
      }
    }
    if (guides) uiStore.setState({ guides });
    if (Object.keys(positions).length) state.moveLive(positions);
    if (selected) state.select({ nodes: selected });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<StruktEdge>[]) => {
    const state = diagramStore.getState();
    let selected: ID[] | null = null;
    for (const change of changes) {
      if (change.type === 'select') selected = toggle(selected ?? [...state.selection.edges], change.id, change.selected);
    }
    if (selected) state.select({ edges: selected });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return;
    diagramStore.getState().apply([{ op: 'connect', from: connection.source, to: connection.target }]);
  }, []);

  const onNodeDragStart = useCallback<OnNodeDrag<ElementNode>>((_event, _node, dragged) => {
    const state = diagramStore.getState();
    const pinned: Record<ID, Rect> = {};
    for (const node of dragged) {
      let parent = state.model.elements[node.id]?.parentId;
      while (parent) {
        const rect = rectsRef.current[parent];
        if (rect) pinned[parent] = rect;
        parent = state.model.elements[parent]?.parentId;
      }
    }
    draggedRef.current = dragged.length === 1 ? dragged[0]!.id : null;
    uiStore.setState({ frozen: pinned });
    state.beginGesture();
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<ElementNode>>((_event, _node, dragged) => {
    const state = diagramStore.getState();
    const rects = rectsRef.current;
    const ops: DiagramOp[] = [];
    for (const node of dragged) {
      const el = state.model.elements[node.id];
      const rect = rects[node.id];
      if (!el || !rect || (el.parentId && dragged.some((other) => other.id === el.parentId))) continue;
      const exclude = new Set([node.id, ...descendantsOf(state.model, node.id)]);
      const target = innermostGroupAt(state.model, rects, center(rect), exclude) ?? null;
      if (target !== (el.parentId ?? null)) ops.push({ op: 'move_to_group', id: node.id, parentId: target });
    }
    draggedRef.current = null;
    uiStore.setState({ frozen: null, guides: [] });
    // Drag and regrouping are one batch: one undo step.
    state.endGesture(ops);
  }, []);

  const onPaneClick = useCallback(() => {
    diagramStore.getState().select({ nodes: [], edges: [] });
    uiStore.setState({ editingId: null });
  }, []);

  const canvas = CANVAS[theme];
  return (
    <div style={{ '--sk-dim': DIM_OPACITY } as CSSProperties} className={`absolute inset-0${draft ? ' sk-draft' : ''}${focus || (!draft && (activeFlowNodes.length > 0 || activeFlowEdges.length > 0 || !!(activeTag || read?.dims))) ? ' sk-focusing' : ''}`}>
      <WatercolorDefs />
      <ReactFlow<ElementNode, StruktEdge>
        proOptions={{ hideAttribution: true }}
        nodes={shown.nodes}
        edges={shown.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onNodeClick={(_event, node) => { if (presenting) selectPresentationComponent(node.id); }}
        nodesDraggable={!draft && !presenting && !reading}
        nodesConnectable={!draft && !presenting && !reading}
        elementsSelectable={!draft && !presenting}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        deleteKeyCode={null}
        // Keys are ours (useShortcuts): React Flow's arrow nudge would bypass history.
        disableKeyboardA11y
        multiSelectionKeyCode={['Shift', uiText("Meta"), 'Control']}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={4}
        fitView
        fitViewOptions={fitOptions}
        colorMode={theme}
        // Big diagrams only mount what is on screen.
        onlyRenderVisibleElements={projection.nodes.length > VIRTUALIZE_ABOVE}
      >
        {/* Paper dots keep the canvas aligned without competing with the diagram. */}
        <Background id="minor" variant={BackgroundVariant.Dots} gap={22} size={1.6} color={canvas.dot} bgColor={canvas.bg} />
        {/* Minimap and zoom share the bottom-left corner; the right edge belongs to Propriedades/Versões. The minimap
            has no toggle here (it hides by itself while the diagram fits): Configurações › Geral and ⌘K switch it. */}
        {minimap && !presenting && projection.nodes.length <= MINIMAP_MAX_NODES && (
          <ChunkBoundary><Suspense fallback={null}><DiagramMiniMap /></Suspense></ChunkBoundary>
        )}
        {!presenting && (
          <Panel position="bottom-left" className="sk-corner">
            <ZoomControls fit={fitOptions} />
          </Panel>
        )}
        <HelperLines />
      </ReactFlow>
      <ChunkBoundary><Suspense fallback={null}><NodeHoverCard /></Suspense></ChunkBoundary>
    </div>
  );
}
