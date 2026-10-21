import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { liveMessages, liveThreads } from '@strukt/workspace';
import type { CommentAnchor, CommentThread } from '@strukt/workspace';
import { ViewportPortal, useNodes, useReactFlow, useStore } from '@xyflow/react';
import type { ReactFlowInstance } from '@xyflow/react';
import { Plus, Check, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useDiagram } from '../state/appStore';
import { IconButton } from '../ui/IconButton';
import { useUi } from '../ui/uiStore';
import { anchorPoint, placeMarkers } from './anchorPoint';
import type { BoxOf } from './anchorPoint';
import { Composer } from './Composer';
import { anchorLabel } from './format';
import { comments, useComments, useWho } from './session';
import { ThreadCard } from './ThreadCard';

const PIN = 26;
/** Everything that is comment chrome (pins, popovers): the tool never starts a comment from a click on it. */
const UI = 'sk-comment-ui';
const NOT_THE_CANVAS = `.${UI}, .react-flow__controls, .react-flow__minimap, .react-flow__panel, button, a`;

/** A node's box in flow coordinates, from React Flow's measurements. */
const boxes = (flow: ReactFlowInstance): BoxOf => (id) => {
  const node = flow.getInternalNode(id);
  if (!node) return null;
  return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 };
};

/** Where in the diagram a click landed: a node, a connection, or a point of the canvas. */
function anchorAt(event: MouseEvent, flow: ReactFlowInstance, nodeIds: (id: string) => boolean, edgeIds: (id: string) => boolean): CommentAnchor {
  const target = event.target as Element;
  const node = target.closest?.('.react-flow__node')?.getAttribute('data-id');
  if (node && nodeIds(node)) return { type: 'node', id: node };
  const edge = target.closest?.('.react-flow__edge')?.getAttribute('data-id');
  if (edge && edgeIds(edge)) return { type: 'edge', id: edge };
  const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
  return { type: 'point', x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
}

/** With the comment tool on, a click on the canvas picks the place of a new conversation instead of selecting or dragging. */
function useCommentTool(enabled: boolean): void {
  const flow = useReactFlow();
  const model = useDiagram((state) => state.model);
  useEffect(() => {
    if (!enabled) return;
    const pane = document.querySelector<HTMLElement>('.react-flow');
    if (!pane) return;
    pane.classList.add('sk-commenting');
    const ours = (event: Event) => !!(event.target as Element | null)?.closest?.(NOT_THE_CANVAS);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || ours(event)) return;
      event.stopPropagation();
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || ours(event)) return;
      event.stopPropagation();
      event.preventDefault();
      comments.startDraft(anchorAt(event, flow, (id) => own(model.elements, id) !== undefined, (id) => model.edges.some((edge) => edge.id === id)));
    };
    pane.addEventListener('pointerdown', down, true);
    pane.addEventListener('click', click, true);
    return () => {
      pane.classList.remove('sk-commenting');
      pane.removeEventListener('pointerdown', down, true);
      pane.removeEventListener('click', click, true);
    };
  }, [enabled, flow, model]);
}

/** A positioned thing that keeps its size when the canvas zooms and does not pan or drag the canvas. */
function Spot({ x, y, zoom, z, children }: { x: number; y: number; zoom: number; z: number; children: ReactNode }) {
  return (
    <div className={`${UI} nopan nodrag nowheel pointer-events-auto absolute left-0 top-0`} style={{ transform: `translate(${x}px, ${y}px) scale(${1 / zoom})`, transformOrigin: '0 0', zIndex: z }}>
      {children}
    </div>
  );
}

function Pin({ thread, active, onClick }: { thread: CommentThread; active: boolean; onClick(): void }) {
  const count = liveMessages(thread).length;
  const first = thread.messages[0]!;
  const resolved = thread.status === 'resolved';
  return (
    <button
      type="button"
      data-comment-pin={thread.id}
      aria-label={uiText("Conversa de {0}: {1} {2}{3}", [first.author.name, count, count === 1 ? uiText("mensagem") : uiText("mensagens"), resolved ? ', resolvida' : ''])}
      aria-expanded={active}
      onClick={onClick}
      className={`flex items-center justify-center rounded-full rounded-bl-[3px] border-2 border-white text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform hover:scale-110 ${active ? 'ring-2 ring-accent' : ''} ${resolved ? 'opacity-60' : ''}`}
      style={{ width: PIN, height: PIN, marginLeft: -PIN / 2, marginTop: -PIN, backgroundColor: first.author.color }}
    >
      {resolved ? <Check size={13} /> : count}
    </button>
  );
}

/** Where a popover goes so that it stays on screen: to the left of the pin near the right edge (or the panel), above it near the bottom. */
function placementOf(flow: ReactFlowInstance, at: { x: number; y: number }, panelOpen: boolean): { left: boolean; up: boolean } {
  const screen = flow.flowToScreenPosition(at);
  const room = (globalThis.innerWidth ?? 1600) - (panelOpen ? 376 : 0);
  const height = globalThis.innerHeight ?? 900;
  return { left: screen.x + 340 > room, up: screen.y + 380 > height && screen.y > height - screen.y };
}

function Popover({ label, onClose, place, children }: { label: string; onClose(): void; place: { left: boolean; up: boolean }; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="sk-float absolute flex max-h-[min(60vh,520px)] w-[320px] flex-col gap-2 overflow-y-auto rounded-panel p-3"
      style={{ ...(place.left ? { right: -PIN / 2 } : { left: -PIN / 2 }), ...(place.up ? { bottom: PIN + 8 } : { top: 8 }) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    >
      <div className="flex justify-end"><IconButton label={uiText("Fechar conversa")} iconSize={14} onClick={onClose}><X /></IconButton></div>
      {children}
    </div>
  );
}

/**
 * The comments on the canvas, in flow space so they follow pan and zoom: a pin on each open conversation (a resolved one
 * only while the panel lists the resolved), the conversation that is open as a popover beside its pin, and the place
 * just picked with the comment tool, waiting for its first message.
 */
export function CommentLayer() {
  const flow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  useNodes(); // re-render when a node moves or resizes
  const model = useDiagram((state) => state.model);
  const file = useComments((state) => state.file);
  const active = useComments((state) => state.active);
  const draft = useComments((state) => state.draft);
  const filter = useComments((state) => state.filter);
  const panelOpen = useUi((state) => state.rightPanel === 'comments');
  const commentMode = useComments((state) => state.tool);
  const who = useWho();
  useCommentTool(commentMode && who.canWrite);
  const boxOf = boxes(flow);
  const threads = useMemo(() => liveThreads(file), [file]);
  const shown = threads.filter((thread) => thread.status === 'open' || thread.id === active || (panelOpen && filter === 'resolved'));
  const placed = placeMarkers(shown, model, boxOf, (PIN + 4) / zoom);
  // With the panel open the conversation is shown there (highlighted); the popover is for when it is closed.
  const open = panelOpen ? null : placed.find((entry) => entry.thread.id === active) ?? null;
  const draftAt = draft ? anchorPoint(draft.anchor, model, boxOf) : null;
  const now = Date.now();
  return (
    <ViewportPortal>
      {/* Above every node, whatever they were raised to (a selected node sits at 1000): one layer for pins and popovers. */}
      <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: 3000 }}>
      {placed.map(({ thread, x, y }) => (
        <Spot key={thread.id} x={x} y={y} zoom={zoom} z={thread.id === active ? 30 : 20}>
          <Pin thread={thread} active={thread.id === active} onClick={() => comments.open(active === thread.id ? null : thread.id)} />
        </Spot>
      ))}
      {open && (
        <Spot x={open.x} y={open.y} zoom={zoom} z={40}>
          <Popover label={uiText("Conversa sobre {0}", [anchorLabel(open.thread.anchor, model).text])} onClose={() => comments.open(null)} place={placementOf(flow, open, panelOpen)}>
            <ThreadCard thread={open.thread} model={model} active now={now} bare />
          </Popover>
        </Spot>
      )}
      {draft && draftAt && (
        <Spot x={draftAt.x} y={draftAt.y} zoom={zoom} z={40}>
          <span aria-hidden className="flex items-center justify-center rounded-full rounded-bl-[3px] border-2 border-dashed border-accent bg-panel text-accent" style={{ width: PIN, height: PIN, marginLeft: -PIN / 2, marginTop: -PIN }}><Plus size={14} /></span>
          <Popover label={uiText("Novo comentário sobre {0}", [anchorLabel(draft.anchor, model).text])} onClose={() => comments.cancelDraft()} place={placementOf(flow, draftAt, panelOpen)}>
            <p className="text-caption font-medium">{uiText("Novo comentário sobre")} {anchorLabel(draft.anchor, model).text}</p>
            <Composer label={uiText("Novo comentário")} placeholder={uiText("Escreva o comentário…")} submitLabel={uiText("Comentar")} autoFocus onCancel={() => comments.cancelDraft()} onSubmit={(text) => comments.createThread(draft.anchor, text)} />
          </Popover>
        </Spot>
      )}
      </div>
    </ViewportPortal>
  );
}
