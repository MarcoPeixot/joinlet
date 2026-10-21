import { uiText } from '../i18n';
import { routeKey } from '@strukt/layout';
import type { DiagramModel, LayoutState } from '@strukt/core';
import { loadDiagramIcons, renderDiagramSvg } from '../export/svg';
import type { IconDef } from '../diagram/icons/registry';
import { diagramStore } from '../state/appStore';
import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import type { ReactFlowState } from '@xyflow/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { shallow } from 'zustand/shallow';
import type { ElementData, EdgeData } from '../diagram/toFlow';
import { boundsFitViewport } from './fitView';
import type { Box } from './fitView';
import { MINIMAP_SIZE, miniMapTransform } from './minimap';

interface MapNode extends Box { id: string; group: boolean; selected: boolean; data: ElementData }
const mapNodes = (state: ReactFlowState): MapNode[] => [...state.nodeLookup.values()].flatMap((node) => {
  const w = node.measured.width ?? node.width ?? 0;
  const h = node.measured.height ?? node.height ?? 0;
  return node.hidden || !w || !h ? [] : [{ id: node.id, ...node.internals.positionAbsolute, w, h, group: node.type === 'sgroup', selected: !!node.selected, data: node.data as ElementData }];
});
const equalNodes = (a: MapNode[], b: MapNode[]) => a.length === b.length && a.every((node, index) => shallow(node, b[index]));

/** The same SVG renderer as export: actual shapes, icons, labels, colors and live canvas geometry. */
export function DiagramMiniMap() {
  const nodes = useStore(mapNodes, equalNodes);
  const edges = useStore((state) => state.edges);
  const transform = useStore((state) => state.transform);
  const pane = useStore((state) => ({ width: state.width, height: state.height }), shallow);
  const flow = useReactFlow();
  const store = useStoreApi();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const clipId = useId();
  const helpId = useId();
  const map = useMemo(() => miniMapTransform(nodes), [nodes]);
  const model = useMemo<DiagramModel>(() => ({
    ...diagramStore.getState().model,
    order: nodes.map((node) => node.id),
    elements: Object.fromEntries(nodes.map((node) => [node.id, { ...node.data.el, colorMode: node.data.colorMode, styleMode: node.data.styleMode, typeface: node.data.typeface }])),
    edges: edges.filter((edge) => !edge.hidden && edge.data).map((edge) => (edge.data as EdgeData).edge),
  }), [nodes, edges]);
  const [icons, setIcons] = useState<Record<string, IconDef | null>>({});
  useEffect(() => {
    let live = true;
    void loadDiagramIcons(model).then((loaded) => { if (live) setIcons(loaded); });
    return () => { live = false; };
  }, [model]);
  const miniature = useMemo(() => {
    if (!nodes.length) return null;
    const rects = Object.fromEntries(nodes.map(({ id, x, y, w, h }) => [id, { x, y, w, h }]));
    const layout: LayoutState = { nodes: {}, edges: {} };
    for (const edge of edges) {
      const data = edge.data as EdgeData | undefined;
      if (data?.points && rects[edge.source] && rects[edge.target]) layout.edges[edge.id] = { key: routeKey(rects[edge.source]!, rects[edge.target]!), points: data.points, ...(data.labelAt ? { label: data.labelAt } : {}) } as LayoutState['edges'][string];
    }
    const markup = renderDiagramSvg(model, layout, { theme: nodes[0]!.data.theme, rects, icons, background: false, padding: 0 });
    const bounds = /viewBox="([^"]+)"/.exec(markup)![1]!.split(' ').map(Number);
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, x: bounds[0]!, y: bounds[1]!, w: bounds[2]!, h: bounds[3]! };
  }, [nodes, edges, model, icons]);
  const visible = !!map && !boundsFitViewport(map.bounds, transform, pane.width, pane.height);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const state = store.getState();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.height : 1);
      void flow.zoomTo(Math.max(state.minZoom, Math.min(state.maxZoom, state.transform[2] * Math.exp(-delta * 0.002))), { duration: 0 });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [flow, store, visible, pane.height]);

  if (!visible || !map) return null;
  const point = (x: number, y: number) => ({ x: x * map.scale + map.x, y: y * map.scale + map.y });
  const view = { x: -transform[0] / transform[2], y: -transform[1] / transform[2], w: pane.width / transform[2], h: pane.height / transform[2] };
  const viewport = { ...point(view.x, view.y), width: view.w * map.scale, height: view.h * map.scale };
  const position = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) * MINIMAP_SIZE.width / box.width - map.x) / map.scale, y: ((event.clientY - box.top) * MINIMAP_SIZE.height / box.height - map.y) / map.scale };
  };
  const navigate = (event: PointerEvent<SVGSVGElement>) => {
    const target = position(event);
    void flow.setCenter(target.x + (drag.current?.x ?? 0), target.y + (drag.current?.y ?? 0), { zoom: store.getState().transform[2], duration: 0 });
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const offset = { ArrowLeft: [-view.w / 8, 0], ArrowRight: [view.w / 8, 0], ArrowUp: [0, -view.h / 8], ArrowDown: [0, view.h / 8] }[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    void flow.setCenter(view.x + view.w / 2 + offset[0]!, view.y + view.h / 2 + offset[1]!, { zoom: transform[2], duration: 0 });
  };
  return (
    <Panel position="bottom-left" className="sk-minimap react-flow__minimap">
      <div className="sk-minimap-heading"><span>{uiText("Minimapa")}</span><span className="sk-minimap-legend" title={uiText("Área visível no canvas")} aria-hidden /></div>
      <svg ref={svg} width={MINIMAP_SIZE.width} height={MINIMAP_SIZE.height} viewBox={`0 0 ${MINIMAP_SIZE.width} ${MINIMAP_SIZE.height}`} role="img" aria-label={uiText("Minimapa")} aria-describedby={helpId} tabIndex={0} onKeyDown={onKey}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          const target = position(event);
          const inside = target.x >= view.x && target.x <= view.x + view.w && target.y >= view.y && target.y <= view.y + view.h;
          drag.current = inside ? { x: view.x + view.w / 2 - target.x, y: view.y + view.h / 2 - target.y } : { x: 0, y: 0 };
          navigate(event);
        }}
        onPointerMove={(event) => { if (drag.current) { event.stopPropagation(); navigate(event); } }}
        onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      >
        <desc id={helpId}>{uiText("Arraste para navegar, use as setas do teclado para mover a área visível e a rolagem para ajustar o zoom.")}</desc>
        <defs><clipPath id={clipId}><rect width={MINIMAP_SIZE.width} height={MINIMAP_SIZE.height} rx="6" /></clipPath></defs>
        <g clipPath={`url(#${clipId})`} pointerEvents="none" shapeRendering="geometricPrecision">
          {miniature && <image data-diagram-preview href={miniature.src} x={point(miniature.x, miniature.y).x} y={point(miniature.x, miniature.y).y} width={miniature.w * map.scale} height={miniature.h * map.scale} />}
          <rect {...viewport} className="sk-minimap-viewport" />
        </g>
      </svg>
    </Panel>
  );
}
