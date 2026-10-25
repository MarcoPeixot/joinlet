import { BoardMiniMap } from './BoardMiniMap';
import { uiText } from '../i18n';
import { isViewOnly } from '../workspace/boot';
import { own } from '@strukt/core';
import { addNote, addSection, connectCards, freeSpot, moveBoard, NOTE_SIZE, removeFromBoard, SECTION_SIZE, knownFolders, spaceBoard } from '@strukt/workspace';
import type { Board } from '@strukt/workspace';
import { Background, BackgroundVariant, ConnectionMode, Panel, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { EdgeChange, NodeChange, OnBeforeDelete, OnConnect, OnConnectEnd, OnNodeDrag } from '@xyflow/react';
import { Expand, Square, StickyNote } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../ui/EmptyState';
import { FlowToggle } from '../ui/FlowToggle';
import { IconButton } from '../ui/IconButton';
import { CANVAS } from '../ui/theme';
import { ZoomControls } from '../ui/ZoomControls';
import { showToast, toggleMinimap, useUi } from '../ui/uiStore';
import { openItem } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { boardToFlow, boardInFolder, deletePlan, followSection, startSectionDrag } from './boardFlow';
import {RepositoryEnrichmentNotice} from '../panels/RepositoryEnrichmentNotice';
import type { BoardEdge, BoardNode, SectionDrag } from './boardFlow';
import { startBoardRouting } from './boardRoutes';
import { CardNodeView } from './CardNode';
import { FloatingEdge } from './FloatingEdge';
import { SectionNodeView } from './SectionNode';
import './board.css';

const nodeTypes = { card: CardNodeView, section: SectionNodeView };
const edgeTypes = { float: FloatingEdge };
const EMPTY = new Set<string>();
/** Initial fit and the Controls button fit the same way. */
const FIT = { padding: 0.2, maxZoom: 1 };
const board = (): Board => workspace.store.getState().data!.board;
const connect = (from: string, to: string) => workspace.updateBoard((b) => connectCards(b, crypto.randomUUID(), from, to));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function BoardCanvas() {
  const viewOnly = isViewOnly();
  const current = useWorkspace((s) => s.data?.board);
  const manifest=useWorkspace(s=>s.data?.manifest);
  const [folder,setFolder]=useState('');
  const choseFolder=useRef(false);
  const folders=useMemo(()=>manifest?knownFolders([...manifest.diagrams,...manifest.docs,...manifest.sketches]):[],[manifest]);
  const visible=useMemo(()=>current&&manifest?boardInFolder(current,manifest,folder):current,[current,manifest,folder]);
  useEffect(()=>{if(!choseFolder.current&&(manifest?.docs.filter(d=>d.source).length??0)>12){choseFolder.current=true;setFolder('__main__');}},[manifest]);
  useEffect(()=>{if(folder&&folder!=='__root__'&&folder!=='__main__'&&!folders.includes(folder))setFolder('');},[folder,folders]);
  const theme = useUi((s) => s.theme);
  const flow = useReactFlow();
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY);
  /** The note just created with "Nova nota": its text box takes the keyboard. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const drag = useRef<SectionDrag | null>(null);
  useEffect(() => startBoardRouting(workspace.store), []);
  const { nodes, edges } = useMemo(
    () => (visible ? boardToFlow(visible, selected, focusId) : { nodes: [], edges: [] }),
    [visible, selected, focusId],
  );
  useEffect(()=>{setSelected(EMPTY);const frame=requestAnimationFrame(()=>void flow.fitView({...FIT,duration:200}));return()=>cancelAnimationFrame(frame);},[folder,flow]);

  const select = useCallback((changes: { id: string; selected: boolean }[]) => {
    const next = new Set(selectedRef.current);
    for (const change of changes) {
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    setSelected(next);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<BoardNode>[]) => {
      const moved: Record<string, { x?: number; y?: number; w?: number; h?: number }> = {};
      const selection: { id: string; selected: boolean }[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const group = drag.current;
          if (group?.id === change.id) Object.assign(moved, followSection(group, change.position));
          else if (!group || !own(group.cards, change.id)) moved[change.id] = { ...moved[change.id], ...change.position };
        } else if (change.type === 'dimensions' && change.dimensions && change.resizing !== undefined) {
          moved[change.id] = { ...moved[change.id], w: change.dimensions.width, h: change.dimensions.height };
        } else if (change.type === 'select') {
          selection.push(change);
        }
      }
      if (Object.keys(moved).length) workspace.updateBoard((b) => moveBoard(b, moved));
      if (selection.length) select(selection);
    },
    [select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<BoardEdge>[]) => select(changes.flatMap((change) => (change.type === 'select' ? [change] : []))),
    [select],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<BoardNode>>((_event, node) => {
    drag.current = node.type === 'section' ? startSectionDrag(board(), node.id) : null;
  }, []);
  const onNodeDragStop = useCallback<OnNodeDrag<BoardNode>>(() => {
    drag.current = null;
  }, []);

  const onConnect = useCallback<OnConnect>((c) => connect(c.source, c.target), []);
  /** Dropping the port anywhere on another card connects too (not only on its handle). */
  const onConnectEnd = useCallback<OnConnectEnd>((event, state) => {
    if (state.isValid || !state.fromNode) return;
    const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
    const target = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')?.getAttribute('data-id');
    if (target) connect(state.fromNode.id, target);
  }, []);

  const onBeforeDelete = useCallback<OnBeforeDelete<BoardNode, BoardEdge>>(async ({ nodes: gone, edges: cut }) => {
    const { ids, refused } = deletePlan(board(), gone.map((n) => n.id), cut.map((e) => e.id));
    if (refused) showToast(uiText("Diagramas, documentos e sketches são excluídos pela barra lateral."));
    if (ids.length) workspace.updateBoard((b) => removeFromBoard(b, ids));
    setSelected(EMPTY);
    return false;
  }, []);

  const onNodeDoubleClick = useCallback((_event: unknown, node: BoardNode) => {
    if (node.type !== 'card') return;
    const { card } = node.data;
    if (card.kind !== 'note' && card.slug) void openItem(card.kind, card.slug);
  }, []);

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
    const id = crypto.randomUUID();
    workspace.updateBoard((b) => addNote(b, id, freeSpot(b, center(NOTE_SIZE), NOTE_SIZE, visibleBounds())));
    setSelected(new Set([id]));
    setFocusId(id);
  };
  const addSectionHere = () => workspace.updateBoard((b) => addSection(b, crypto.randomUUID(), center(SECTION_SIZE), uiText("Nova seção")));
  const spaceOverview = () => {
    workspace.updateBoard(spaceBoard);
    requestAnimationFrame(() => void flow.fitView({ ...FIT, duration: 250 }));
  };

  const canvas = CANVAS[theme];
  const minimap = useUi((s) => s.minimap);
  return (
    <div className="strukt-board absolute inset-0">
      <ReactFlow<BoardNode, BoardEdge>
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onBeforeDelete={onBeforeDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        // Sections stay behind cards even when selected.
        elevateNodesOnSelect={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT}
        onlyRenderVisibleElements={(current?.cards.length??0)>80}
        colorMode={theme}
        nodesDraggable={!viewOnly}
        nodesConnectable={!viewOnly}
        elementsSelectable
        deleteKeyCode={viewOnly ? null : ['Backspace', 'Delete']}
      >
        <Background id="minor" variant={BackgroundVariant.Dots} gap={20} size={2} color={canvas.dot} bgColor={canvas.bg} />
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
          <IconButton label={uiText("Espaçar Overview")} title={uiText("Aumentar o espaço entre os cards e as conexões do Overview")} onClick={spaceOverview} disabled={(current?.cards.length ?? 0) < 2}>
            <Expand />
            <span className="sk-overview-spacing-text text-caption font-medium">{uiText("Espaçar")}</span>
          </IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          </>}
          <FlowToggle>
            <span className="text-caption font-medium">{uiText("Fluxo")}</span>
          </FlowToggle>
          {folders.length>0&&<select aria-label={uiText('Filtrar Overview por pasta')} className="max-w-44 rounded bg-panel px-2 py-1 text-caption" value={folder} onChange={event=>{choseFolder.current=true;setFolder(event.target.value);}}><option value="">{uiText('Todos os itens')}</option><option value="__main__">{uiText('Visão principal')}</option><option value="__root__">{uiText('Sem pasta')}</option>{folders.map(path=><option key={path} value={path}>{path}</option>)}</select>}
        </Panel>
        {!viewOnly&&<Panel position="top-left" style={{top:52}}><RepositoryEnrichmentNotice/></Panel>}
        <Panel position="bottom-right" className="sk-overview-status sk-corner rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-meta text-muted">
          {plural(visible?.cards.length ?? 0, 'card', 'cards')} {"·"} {plural(visible?.connections.length ?? 0, uiText("conexão"), uiText("conexões"))} <span className="sk-overview-hint">{uiText("· duplo clique abre ou rotula")}</span></Panel>
        {(current?.cards.length ?? 0) === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <EmptyState className="pointer-events-auto" illustration="board" title={uiText("O overview está vazio")} text={uiText("Reúna diagramas, documentos e notas num só lugar e ligue as ideias.")} action={viewOnly ? undefined : { label: uiText("Nova nota"), icon: <StickyNote size={14} />, onClick: addNoteHere }} />
          </div>
        )}
        {minimap && <BoardMiniMap />}
        <Panel position="bottom-left" className="sk-corner">
          <ZoomControls fit={FIT} minimap={minimap} onToggleMinimap={toggleMinimap} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** The Overview (spec §3 M4): workspace overview on its own React Flow instance. */
export function BoardView() {
  return (
    <ReactFlowProvider>
      <BoardCanvas />
    </ReactFlowProvider>
  );
}
