import { uiText } from '../i18n';
import type { DiagramModel, EdgeEl, ID } from '@strukt/core';
import { Bell, Layers, MonitorSmartphone, Database, Server, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { legibleBrandColor } from '../diagram/palette';
import { BRAND_ICONS } from './brandIcons';

type Pt = [number, number];
type Box = { x: number; y: number; w: number; h: number };
interface Route { points: Pt[]; label?: Pt }
interface Scene { w: number; h: number; groups: Record<ID, Box>; nodes: Record<ID, Pt>; routes: Record<string, Route> }

const key = (from: ID, to: ID) => `${from}>${to}`;

/** Left-to-right, the way the editor lays the example out. */
const WIDE: Scene = {
  w: 1000,
  h: 500,
  groups: { Frontend: { x: 24, y: 40, w: 180, h: 310 }, Serviços: { x: 500, y: 40, w: 180, h: 310 }, Dados: { x: 800, y: 40, w: 176, h: 310 } },
  nodes: { 'Web App': [114, 140], Mobile: [114, 270], 'API Gateway': [350, 205], Pedidos: [590, 140], Pagamentos: [590, 270], Redis: [888, 140], PostgreSQL: [888, 270], Kafka: [590, 440], Notificações: [888, 440] },
  routes: {
    [key('Web App', 'API Gateway')]: { points: [[142, 134], [250, 134], [250, 195], [322, 195]], label: [250, 165] },
    [key('Mobile', 'API Gateway')]: { points: [[142, 276], [250, 276], [250, 215], [322, 215]], label: [250, 246] },
    [key('API Gateway', 'Pedidos')]: { points: [[378, 205], [440, 205], [440, 140], [562, 140]] },
    [key('Pedidos', 'Redis')]: { points: [[618, 130], [860, 130]], label: [740, 130] },
    [key('Pedidos', 'PostgreSQL')]: { points: [[618, 156], [724, 156], [724, 262], [860, 262]], label: [724, 209] },
    [key('Pedidos', 'Kafka')]: { points: [[562, 158], [530, 158], [530, 440], [562, 440]], label: [530, 392] },
    [key('Kafka', 'Pagamentos')]: { points: [[590, 412], [590, 330]] },
    [key('Kafka', 'Notificações')]: { points: [[618, 440], [860, 440]], label: [739, 440] },
  },
};

/** Top-down, for phones: same model, a canvas that fills a narrow column instead of shrinking. */
const TALL: Scene = {
  w: 460,
  h: 970,
  groups: { Frontend: { x: 16, y: 16, w: 428, h: 148 }, Serviços: { x: 16, y: 312, w: 428, h: 190 }, Dados: { x: 16, y: 792, w: 428, h: 162 } },
  nodes: { 'Web App': [150, 90], Mobile: [330, 90], 'API Gateway': [240, 226], Pedidos: [170, 412], Pagamentos: [340, 412], Kafka: [272, 560], Notificações: [272, 690], Redis: [150, 886], PostgreSQL: [340, 886] },
  routes: {
    [key('Web App', 'API Gateway')]: { points: [[150, 148], [150, 180], [224, 180], [224, 198]], label: [187, 180] },
    [key('Mobile', 'API Gateway')]: { points: [[330, 148], [330, 180], [256, 180], [256, 198]], label: [293, 180] },
    [key('API Gateway', 'Pedidos')]: { points: [[240, 278], [240, 296], [170, 296], [170, 384]] },
    [key('Pedidos', 'Redis')]: { points: [[128, 470], [128, 856]], label: [128, 640] },
    [key('Pedidos', 'PostgreSQL')]: { points: [[170, 470], [170, 764], [320, 764], [320, 856]], label: [245, 764] },
    [key('Pedidos', 'Kafka')]: { points: [[212, 470], [212, 560], [244, 560]], label: [212, 516] },
    [key('Kafka', 'Pagamentos')]: { points: [[300, 560], [340, 560], [340, 478]] },
    [key('Kafka', 'Notificações')]: { points: [[272, 612], [272, 660]], label: [272, 636] },
  },
};

const LUCIDE: Record<string, LucideIcon> = { smartphone: Smartphone, server: Server, bell: Bell, layers: Layers, database: Database, 'monitor-smartphone': MonitorSmartphone };
const INK = { light: '#343b45', dark: '#d3d9e2' };
const EDGE = { light: '#9ca3af', dark: '#59616e' };
const PAD = 8;
const STICKER = 72;
const ADDED = '#2f9a4e';
const ICON = 40;

function roundedPath(points: Pt[], radius = 9): string {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const r = Math.min(radius, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const a: Pt = [cx + Math.sign(px - cx) * r, cy + Math.sign(py - cy) * r];
    const b: Pt = [cx + Math.sign(nx - cx) * r, cy + Math.sign(ny - cy) * r];
    d += ` L${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last[0]} ${last[1]}`;
}

const lengthOf = (points: Pt[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]), 0);

/** Pulls both ends of a route back along its first and last segments, so the stroke meets the sticker's border. */
function trim(points: Pt[], start: number, end: number): Pt[] {
  if (points.length < 2) return points;
  const out = points.map((point) => [point[0], point[1]] as Pt);
  const pull = (from: number, toward: number, by: number) => {
    const a = out[from]!; const b = out[toward]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= by * 2) return;
    out[from] = [a[0] + ((b[0] - a[0]) / length) * by, a[1] + ((b[1] - a[1]) / length) * by];
  };
  pull(0, 1, start);
  pull(out.length - 1, out.length - 2, end);
  return out;
}

/** Shortens the last segment so the stroke does not poke through the arrow head; returns the head polygon. */
function withArrow(points: Pt[], size = 10): { line: Pt[]; head: string } {
  const tip = points[points.length - 1]!;
  const from = points[points.length - 2]!;
  const dx = Math.sign(tip[0] - from[0]);
  const dy = Math.sign(tip[1] - from[1]);
  const base: Pt = [tip[0] - dx * (size - 1), tip[1] - dy * (size - 1)];
  const nx = -dy;
  const ny = dx;
  const half = size * 0.45;
  return { line: [...points.slice(0, -1), base], head: `${tip[0]},${tip[1]} ${base[0] + nx * half},${base[1] + ny * half} ${base[0] - nx * half},${base[1] - ny * half}` };
}

function Glyph({ icon, cx, cy, active, dark }: { icon: string; cx: number; cy: number; active: boolean; dark: boolean }) {
  const brand = Object.hasOwn(BRAND_ICONS, icon) ? BRAND_ICONS[icon]! : null;
  const x = cx - ICON / 2;
  const y = cy - ICON / 2;
  const fill = brand ? legibleBrandColor(brand.color, dark ? 'dark' : 'light') ?? INK[dark ? 'dark' : 'light'] : INK.light;
  if (brand) return <svg x={x} y={y} width={ICON} height={ICON} viewBox="0 0 24 24" aria-hidden><path d={brand.path} fill={fill} /></svg>;
  const Lucide = LUCIDE[icon];
  return Lucide ? <Lucide x={x} y={y} width={ICON} height={ICON} strokeWidth={1.25} color={active ? (dark ? '#82afff' : '#2264e5') : INK[dark ? 'dark' : 'light']} aria-hidden /> : null;
}

export function useWide(): boolean {
  const query = '(min-width: 760px)';
  const [wide, setWide] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : true));
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setWide(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return wide;
}

export interface DiagramProps {
  model: DiagramModel;
  /** Ids drawn as additions in a draft the visitor has not accepted. */
  draftAdded?: ReadonlySet<string>;
  /** Ids that came with the proposal: they animate in when they mount. */
  entering?: ReadonlySet<string>;
  active: ID | null;
  onActive: (id: ID | null) => void;
  onPin: (id: ID) => void;
  wide: boolean;
  /** Draws with the dark palette (the page theme). */
  dark?: boolean;
  /** "Animar fluxo": pulses travel along the connections, as in the editor. */
  flow?: boolean;
}

export function Diagram({ model, draftAdded, active, onActive, onPin, wide, dark = false, flow = false, entering }: DiagramProps) {
  const theme = dark ? 'dark' : 'light';
  const scene = wide ? WIDE : TALL;
  const edges: EdgeEl[] = model.edges.filter((edge) => Object.hasOwn(scene.routes, key(edge.from, edge.to)));
  const groups = model.order.filter((id) => model.elements[id]?.kind === 'group' && Object.hasOwn(scene.groups, id));
  const nodes = model.order.filter((id) => model.elements[id]?.kind !== 'group' && Object.hasOwn(scene.nodes, id));
  const draft = (id: string) => draftAdded?.has(id) ?? false;
  const enter = (id: string) => entering?.has(id) ?? false;
  return (
    <svg className="diagram" viewBox={`0 0 ${scene.w} ${scene.h}`} role="group" aria-label={uiText("Diagrama de arquitetura do exemplo")} data-layout={wide ? 'wide' : 'tall'}>
      {groups.map((id) => {
        const box = scene.groups[id]!;
        const element = model.elements[id]!;
        const Lucide = element.icon ? LUCIDE[element.icon] : undefined;
        const label = uiText(element.label ?? element.id);
        return (
          <g key={id} className="group">
            <rect className="group-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={18} />
            <rect className="group-chip" x={box.x + 10} y={box.y + 10} width={label.length * 8.6 + 46} height={26} rx={13} />
            {Lucide && <Lucide x={box.x + 19} y={box.y + 16} width={14} height={14} strokeWidth={2} color={INK[theme]} aria-hidden />}
            <text className="group-title" x={box.x + 40} y={box.y + 28}>{label}</text>
          </g>
        );
      })}
      {edges.map((edge) => {
        const route = scene.routes[key(edge.from, edge.to)]!;
        const dashed = edge.connector === '-->';
        const added = draft(`${edge.from}→${edge.to}`);
        const color = added ? ADDED : EDGE[theme];
        const { line, head } = withArrow(trim(route.points, PAD, PAD));
        const d = roundedPath(line);
        const seconds = Math.max(1.6, lengthOf(route.points) / 110);
        return (
          <g key={`${edge.from}>${edge.to}`} className="edge" data-diff={added ? 'added' : undefined} data-enter={enter(`${edge.from}→${edge.to}`) || undefined}>
            <path d={d} fill="none" stroke={color} strokeWidth={added ? 2 : 1.5} strokeDasharray={dashed ? '6 5' : undefined} />
            <polygon points={head} fill={color} />
            {flow && !added && [0, 0.5].map((phase) => (
              <circle key={phase} className="pulse" r={3.2} cx={0} cy={0} opacity={0}>
                <animateMotion dur={`${seconds}s`} begin={`${(phase * seconds).toFixed(2)}s`} repeatCount="indefinite" path={d} />
                <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.1;0.88;1" dur={`${seconds}s`} begin={`${(phase * seconds).toFixed(2)}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        );
      })}
      {edges.map((edge) => {
        const route = scene.routes[key(edge.from, edge.to)]!;
        if (!edge.label || !route.label) return null;
        const added = draft(`${edge.from}→${edge.to}`);
        const width = edge.label.length * 7.4 + 18;
        const [x, y] = route.label;
        return (
          <g key={`label-${edge.from}>${edge.to}`} className="edge-label" style={{ color: added ? ADDED : EDGE[theme] }}>
            <rect x={x - width / 2} y={y - 10} width={width} height={20} rx={10} />
            <text x={x} y={y + 4.5} textAnchor="middle">{uiText(edge.label)}</text>
          </g>
        );
      })}
      {nodes.map((id, index) => {
        const [cx, cy] = scene.nodes[id]!;
        const element = model.elements[id]!;
        const isActive = active === id;
        const added = draft(id);
        const halo = Math.max(96, (element.label ?? id).length * 9.5 + 20);
        return (
          <g key={id} className="node" style={{ '--i': index } as React.CSSProperties} data-enter={enter(id) || undefined} data-active={isActive || undefined} data-diff={added ? 'added' : undefined} tabIndex={0} role="button" aria-pressed={isActive} aria-label={uiText("{0}: mostrar no código", [uiText(element.label ?? id)])}
            onMouseEnter={() => onActive(id)} onMouseLeave={() => onActive(null)} onFocus={() => onActive(id)} onBlur={() => onActive(null)} onClick={() => onPin(id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPin(id); } }}>
            <rect className="node-halo" x={cx - halo / 2} y={cy - 44} width={halo} height={112} rx={16} />
            <rect className="sticker-shadow" x={cx - STICKER / 2 + 3} y={cy - STICKER / 2 + 3} width={STICKER} height={STICKER} rx={18} />
            <rect className="sticker" x={cx - STICKER / 2} y={cy - STICKER / 2} width={STICKER} height={STICKER} rx={18} />
            {element.icon && <Glyph icon={element.icon} cx={cx} cy={cy} active={isActive} dark={dark} />}
            <text className="node-label" x={cx} y={cy + STICKER / 2 + 17} textAnchor="middle">{uiText(element.label ?? id)}</text>
          </g>
        );
      })}
    </svg>
  );
}
