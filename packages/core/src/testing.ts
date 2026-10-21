import fc from 'fast-check';
import { edgeId } from './ids';
import { COLOR_MODES, CONNECTORS, DEFAULT_STYLE, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from './model';
import type { Connector, DiagramElement, DiagramModel, EdgeEl, ID, LayoutState, UpdatableProps } from './model';

/** Characters that stress the DSL: reserved symbols, quotes, escapes, accents. */
const CHARS = [...'aZ09 _-./:>,<[]{}"\\#çã'];

export const textArb = fc.string({ unit: fc.constantFrom(...CHARS), minLength: 1, maxLength: 10 });
export const nameArb = fc.oneof(
  { weight: 6, arbitrary: textArb.filter((s) => s.trim().length > 0) },
  { weight: 1, arbitrary: fc.constantFrom('direction down', 'typeface', 'API Gateway', 'k8s-api', 'Pub/Sub', 'a // b') },
);
const valueArb = fc.oneof({ weight: 4, arbitrary: textArb }, { weight: 1, arbitrary: fc.constant('linha 1\nlinha 2') });

const propsArb: fc.Arbitrary<UpdatableProps> = fc.record(
  {
    label: valueArb,
    shape: fc.constantFrom(...SHAPES),
    icon: fc.constantFrom('aws-ec2', 'redis', 'server'),
    color: fc.constantFrom('blue', 'green', '#30a050'),
    link: fc.constant('https://example.com/docs?a=1'),
    tech: valueArb,
    description: valueArb,
    colorMode: fc.constantFrom(...COLOR_MODES),
    styleMode: fc.constantFrom(...STYLE_MODES),
    typeface: fc.constantFrom(...TYPEFACES),
  },
  { requiredKeys: [] },
);

interface ItemSpec {
  id: ID;
  kind: 'node' | 'group';
  rank: number;
  parentPick: number;
  props: UpdatableProps;
}

interface EdgeSpec {
  from: number;
  to: number;
  connector: Connector;
  label?: string;
  color?: string;
}

function build(style: DiagramModel['style'], items: ItemSpec[], specs: EdgeSpec[]): DiagramModel {
  const elements: Record<ID, DiagramElement> = {};
  // Parents come from groups with a lower rank, so containment is acyclic while `order` may list children first.
  const below = (a: number, b: number) => items[a]!.rank < items[b]!.rank || (items[a]!.rank === items[b]!.rank && a < b);
  items.forEach((item, index) => {
    const candidates = items.flatMap((other, j) => (other.kind === 'group' && below(j, index) ? [other.id] : []));
    const pick = item.parentPick % (candidates.length + 1);
    const { shape, ...props } = item.props;
    const el: DiagramElement = item.kind === 'group' ? { kind: 'group', id: item.id, ...props } : { kind: 'node', id: item.id, ...props, ...(shape ? { shape } : {}) };
    if (pick > 0) el.parentId = candidates[pick - 1];
    elements[item.id] = el;
  });
  const taken = new Set<ID>();
  const edges: EdgeEl[] = [];
  for (const spec of specs) {
    if (items.length < 2) break;
    const from = items[spec.from % items.length]!.id;
    const to = items[spec.to % items.length]!.id;
    if (from === to) continue;
    const id = edgeId(from, to, taken);
    taken.add(id);
    edges.push({ id, from, to, connector: spec.connector, ...(spec.label ? { label: spec.label } : {}), ...(spec.color ? { color: spec.color } : {}) });
  }
  return { style, elements, order: items.map((item) => item.id), edges, diagnostics: [] };
}

/** Random valid diagrams (unique names, acyclic groups, no self-edges) for property tests. */
export function modelArb(options: { names?: fc.Arbitrary<string>; maxElements?: number; maxEdges?: number } = {}): fc.Arbitrary<DiagramModel> {
  const item = fc.record({
    id: options.names ?? nameArb,
    kind: fc.constantFrom('node' as const, 'group' as const),
    rank: fc.nat({ max: 4 }),
    parentPick: fc.nat(),
    props: propsArb,
  });
  const edge = fc.record(
    {
      from: fc.nat(),
      to: fc.nat(),
      connector: fc.constantFrom(...CONNECTORS),
      label: valueArb,
      color: fc.constantFrom('red', '#123456'),
    },
    { requiredKeys: ['from', 'to', 'connector'] },
  );
  const style = fc.record({
    direction: fc.constantFrom(...DIRECTIONS),
    colorMode: fc.constantFrom(...COLOR_MODES),
    styleMode: fc.constantFrom(...STYLE_MODES),
    typeface: fc.constantFrom(...TYPEFACES),
  });
  return fc
    .tuple(style, fc.uniqueArray(item, { selector: (i) => i.id, maxLength: options.maxElements ?? 8 }), fc.array(edge, { maxLength: options.maxEdges ?? 8 }))
    .map(([s, items, edges]) => build(s, items, edges));
}

/** Deterministic synthetic models (no randomness) for characterization tests of the O(N) group maps. */
export function syntheticModels(): Record<'flat300' | 'nested5' | 'mixed500', { model: DiagramModel; layout: LayoutState }> {
  const build = (elements: DiagramElement[], links: [ID, ID][]) => {
    const model: DiagramModel = { elements: {}, order: [], edges: [], style: { ...DEFAULT_STYLE }, diagnostics: [] };
    const layout: LayoutState = { nodes: {}, edges: {} };
    for (const el of elements) {
      Object.defineProperty(model.elements, el.id, { value: el, enumerable: true, writable: true, configurable: true });
      model.order.push(el.id);
    }
    const seen = new Set<string>();
    for (const [from, to] of links) {
      let id = `${from}→${to}`;
      for (let i = 2; seen.has(id); i++) id = `${from}→${to}#${i}`;
      seen.add(id);
      model.edges.push({ id, from, to, connector: '>' });
    }
    elements.forEach((el, i) => {
      if (el.kind === 'node') layout.nodes[el.id] = { x: (i % 20) * 200, y: Math.floor(i / 20) * 110 };
    });
    return { model, layout };
  };
  const node = (id: ID, parentId?: ID): DiagramElement => ({ kind: 'node', id, parentId, label: `N ${id}` });
  const group = (id: ID, parentId?: ID): DiagramElement => ({ kind: 'group', id, parentId, label: `G ${id}` });
  const hostile = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];

  const flat: DiagramElement[] = hostile.map((id) => node(id));
  for (let i = 0; i < 296; i++) flat.push(node(`n${i}`));

  // Groups are declared after some children on purpose (order is not parent-first).
  const nested: DiagramElement[] = [node('leaf0', 'g4'), node('leaf1', 'g2')];
  for (let d = 0; d < 5; d++) nested.push(group(`g${d}`, d ? `g${d - 1}` : undefined));
  for (let i = 0; i < 40; i++) nested.push(node(`m${i}`, `g${i % 5}`));
  nested.push(group('toString', 'g1'), node('constructor', 'toString'));

  const mixed: DiagramElement[] = [];
  for (let g = 0; g < 20; g++) mixed.push(group(`grp${g}`, g >= 15 ? `grp${g - 15}` : undefined));
  mixed.push(group('empty'));
  for (let i = 0; i < 480; i++) mixed.push(node(`s${i}`, i % 7 === 0 ? undefined : `grp${i % 20}`));

  const links = (els: DiagramElement[]): [ID, ID][] => {
    const nodes = els.filter((e) => e.kind === 'node').map((e) => e.id);
    return nodes.slice(1).map((id, i) => [id, nodes[(i * 7) % (i + 1)]!] as [ID, ID]).filter(([a, b]) => a !== b);
  };
  return {
    flat300: build(flat, links(flat)),
    nested5: build(nested, links(nested)),
    mixed500: build(mixed, links(mixed)),
  };
}

/** Dependency-free 53-bit hash (cyrb53) of a string, for compact characterization snapshots. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${text.length}`;
}
