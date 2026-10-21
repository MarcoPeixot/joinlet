import { ViewportPortal, useNodes, useReactFlow, useStore } from '@xyflow/react';
import { Fragment, useEffect, useRef } from 'react';
import { useDiagram } from '../state/appStore';
import { useCollaborationView } from '../workspace/collaborationView';

const MAX_SELECTED = 50;

/**
 * Other people's pointers and selected nodes on the diagram, drawn in flow space (they follow pan and zoom), and this
 * client's own pointer and selection published to the room. Nothing renders outside a shared diagram.
 */
export function RemotePresence() {
  const flow = useReactFlow();
  const { others, client } = useCollaborationView();
  const zoom = useStore((state) => state.transform[2]);
  const nodes = useNodes(); // re-render when a node moves or resizes
  const selection = useDiagram((state) => state.selection.nodes);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const shared = client?.item.startsWith('diagram:') ? client : null;

  const publish = (selected: readonly string[]) => {
    shared?.setPresence({ diagram: { ...(pointer.current ? { pointer: pointer.current } : {}), ...(selected.length ? { nodes: selected.slice(0, MAX_SELECTED) } : {}) } });
  };
  const latest = useRef(selection);
  latest.current = selection;

  useEffect(() => {
    if (!shared) return;
    const pane = document.querySelector<HTMLElement>('.react-flow');
    if (!pane) return;
    const move = (event: PointerEvent) => {
      pointer.current = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      publish(latest.current);
    };
    const leave = () => {
      pointer.current = null;
      publish(latest.current);
    };
    pane.addEventListener('pointermove', move);
    pane.addEventListener('pointerleave', leave);
    return () => {
      pane.removeEventListener('pointermove', move);
      pane.removeEventListener('pointerleave', leave);
      pointer.current = null;
      shared.setPresence(null);
    };
    // `publish` only reads refs and `shared`, so it is not a dependency of its own.
  }, [shared, flow]);

  useEffect(() => publish(selection), [selection, shared]);

  const people = shared ? others.filter((person) => person.state?.diagram) : [];
  if (!people.length) return null;
  void nodes;
  return (
    <ViewportPortal>
      {people.map((person) => {
        const { pointer: at, nodes: selected } = person.state!.diagram!;
        return (
          <Fragment key={person.id}>
            {selected?.map((id) => {
              const node = flow.getInternalNode(id);
              if (!node) return null;
              const { x, y } = node.internals.positionAbsolute;
              return (
                <div key={id} data-remote-selection={person.name} className="pointer-events-none absolute rounded-[10px]" style={{ left: x - 4, top: y - 4, width: (node.measured.width ?? 0) + 8, height: (node.measured.height ?? 0) + 8, border: `2px solid ${person.color}` }}>
                  <span className="absolute -top-5 left-[-2px] whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium leading-[18px] text-white" style={{ backgroundColor: person.color, transform: `scale(${1 / zoom})`, transformOrigin: 'left bottom' }}>{person.name}</span>
                </div>
              );
            })}
            {at && (
              <div data-remote-pointer={person.name} className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${at.x}px, ${at.y}px) scale(${1 / zoom})`, transformOrigin: '0 0' }}>
                <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden><path d="M1 1l12 7-5 1.5L6 15z" fill={person.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                <span className="ml-3 -mt-1 inline-block whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium leading-[18px] text-white" style={{ backgroundColor: person.color }}>{person.name}</span>
              </div>
            )}
          </Fragment>
        );
      })}
    </ViewportPortal>
  );
}
