import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { MINIMAP_SIZE, miniMapTransform } from '../canvas/minimap';
import { ITEM_LIST } from '@strukt/workspace';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { uiText } from '../i18n';
import { useUi } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { sketchThumbnail } from '../sketch/thumbnail';
import { diagramFor, docFor, sketchFor } from './boardFlow';
import { useDiagramThumbnail } from './thumbnail';

/** Draw the actual Overview cards and their contents, instead of anonymous node rectangles. */
function OverviewNode({ id, x, y, width, height, selected }: { id: string; x: number; y: number; width: number; height: number; selected: boolean }) {
  const data = useWorkspace(s => s.data);
  const theme = useUi(s => s.theme);
  const card = data?.board.cards.find(c => c.id === id);
  const section = data?.board.sections.find(s => s.id === id);
  const diagram = useDiagramThumbnail(card?.kind === 'diagram' ? diagramFor(data, card.slug ?? '') : undefined, theme);
  const sketchText = card?.kind === 'sketch' ? sketchFor(data, card.slug ?? '') : undefined;
  const [sketch, setSketch] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSketch(null);
    if (sketchText) void sketchThumbnail(sketchText).then(value => { if (live) setSketch(value); });
    return () => { live = false; };
  }, [sketchText]);
  if (!data) return null;
  const title = section?.title ?? (card?.kind === 'note' ? card.text : card ? data.manifest[ITEM_LIST[card.kind]].find(item => item.slug === card.slug)?.title : '') ?? '';
  const thumbnail = card?.kind === 'diagram' ? diagram : sketch;
  const text = card?.kind === 'doc' ? docFor(data, card.slug ?? '')?.replace(/[#*`>]/g, '').split('\n').filter(Boolean).slice(0, 5) : [];
  const first = data.board.sections[0]?.id ?? data.board.cards[0]?.id;
  return <g data-overview-preview={id}>
    {id === first && data.board.connections.map(connection => {
      const from = data.board.cards.find(c => c.id === connection.from), to = data.board.cards.find(c => c.id === connection.to);
      if (!from || !to) return null;
      const sx = from.x + from.w, sy = from.y + from.h / 2, tx = to.x, ty = to.y + to.h / 2;
      return <path key={connection.id} d={`M${sx} ${sy} H${(sx+tx)/2} V${ty} H${tx}`} fill="none" stroke="var(--sk-muted)" strokeWidth={2} />;
    })}
    <rect x={x} y={y} width={width} height={height} rx={section ? 12 : 9} fill={section ? 'var(--sk-panel-2)' : card?.kind === 'note' ? card.color ?? '#fef3c7' : 'var(--sk-panel)'} fillOpacity={section ? 0.5 : 1} stroke={selected ? 'var(--sk-accent)' : 'var(--sk-line-strong)'} strokeWidth={selected ? 3 : 1.5} />
    <text x={x+12} y={y+22} fontSize={12} fontFamily="sans-serif" fill={card?.kind === 'note' ? '#292524' : 'var(--sk-ink)'}>{title.slice(0, Math.floor((width-24)/7))}</text>
    {thumbnail && <image data-card-thumbnail href={thumbnail} x={x+10} y={y+38} width={Math.max(1,width-20)} height={Math.max(1,height-48)} preserveAspectRatio="xMidYMid meet" />}
    {text?.map((line,index) => <text key={index} x={x+12} y={y+50+index*18} fontSize={10} fill="var(--sk-muted)">{line.slice(0,Math.floor((width-24)/5.5))}</text>)}
  </g>;
}

export function BoardMiniMap() {
  const nodes = useStore(state => state.nodes);
  const transform = useStore(state => state.transform);
  const paneWidth = useStore(state => state.width), paneHeight = useStore(state => state.height);
  const flow = useReactFlow();
  const store = useStoreApi();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const clip = useId();
  const boxes = useMemo(() => nodes.filter(node => !node.hidden).map(node => ({ id: node.id, x: node.position.x, y: node.position.y, w: node.width ?? node.measured?.width ?? 1, h: node.height ?? node.measured?.height ?? 1, selected: !!node.selected })), [nodes]);
  const map = useMemo(() => miniMapTransform(boxes), [boxes]);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const state = store.getState();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? paneHeight : 1);
      void flow.zoomTo(Math.max(state.minZoom, Math.min(state.maxZoom, state.transform[2] * Math.exp(-delta * .002))), { duration: 0 });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [flow, store, paneHeight, !!map]);
  if (!map) return null;
  const view = { x: -transform[0]/transform[2], y: -transform[1]/transform[2], w: paneWidth/transform[2], h: paneHeight/transform[2] };
  const position = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX-rect.left)*MINIMAP_SIZE.width/rect.width-map.x)/map.scale, y: ((event.clientY-rect.top)*MINIMAP_SIZE.height/rect.height-map.y)/map.scale };
  };
  const navigate = (event: PointerEvent<SVGSVGElement>) => {
    const target = position(event);
    void flow.setCenter(target.x+(drag.current?.x ?? 0), target.y+(drag.current?.y ?? 0), { zoom: store.getState().transform[2], duration: 0 });
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const offset = { ArrowLeft: [-view.w/8,0], ArrowRight: [view.w/8,0], ArrowUp: [0,-view.h/8], ArrowDown: [0,view.h/8] }[event.key];
    if (!offset) return;
    event.preventDefault(); event.stopPropagation();
    void flow.setCenter(view.x+view.w/2+offset[0]!,view.y+view.h/2+offset[1]!,{ zoom:transform[2], duration:0 });
  };
  return <Panel position="bottom-left" className="sk-minimap sk-board-minimap react-flow__minimap">
    <div className="sk-minimap-heading"><span>Overview</span><span className="sk-minimap-legend" aria-hidden /></div>
    <svg ref={svg} width={MINIMAP_SIZE.width} height={MINIMAP_SIZE.height} viewBox={`0 0 ${MINIMAP_SIZE.width} ${MINIMAP_SIZE.height}`} role="img" aria-label={uiText('Minimapa')} tabIndex={0} onKeyDown={onKey}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); const point = position(event); const inside = point.x >= view.x && point.x <= view.x+view.w && point.y >= view.y && point.y <= view.y+view.h; drag.current = inside ? { x:view.x+view.w/2-point.x,y:view.y+view.h/2-point.y } : {x:0,y:0}; navigate(event); }}
      onPointerMove={event => { if (drag.current) navigate(event); }}
      onPointerUp={event => { drag.current=null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => {drag.current=null;}} onLostPointerCapture={() => {drag.current=null;}}>
      <desc>{uiText('Arraste para navegar, use as setas do teclado para mover a área visível e a rolagem para ajustar o zoom.')}</desc>
      <defs><clipPath id={clip}><rect width={MINIMAP_SIZE.width} height={MINIMAP_SIZE.height} rx={6} /></clipPath></defs>
      <g clipPath={`url(#${clip})`} pointerEvents="none">
        <g transform={`translate(${map.x} ${map.y}) scale(${map.scale})`} data-overview-content>{boxes.map(box => <OverviewNode key={box.id} id={box.id} x={box.x} y={box.y} width={box.w} height={box.h} selected={box.selected} />)}</g>
        <rect className="sk-minimap-viewport" x={view.x*map.scale+map.x} y={view.y*map.scale+map.y} width={view.w*map.scale} height={view.h*map.scale} />
      </g>
    </svg>
  </Panel>;
}
