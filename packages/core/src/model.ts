export type ID = string;

export const DIRECTIONS = ['right', 'down', 'left', 'up'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const COLOR_MODES = ['pastel', 'bold', 'outline'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const STYLE_MODES = ['shadow', 'plain', 'watercolor'] as const;
export type StyleMode = (typeof STYLE_MODES)[number];
export const TYPEFACES = ['rough', 'clean', 'mono'] as const;
export type Typeface = (typeof TYPEFACES)[number];
export const BASIC_SHAPES = [
  'rectangle', 'cylinder', 'diamond', 'document', 'ellipse', 'hexagon',
  'oval', 'parallelogram', 'star', 'trapezoid', 'triangle', 'circle',
] as const;
/** Accepted in existing files; new architecture components use icons instead. */
export const LEGACY_SHAPES = [
  'cloud', 'queue', 'bucket', 'actor', 'component', 'server',
  'browser', 'mobile', 'package', 'note', 'process', 'delay',
] as const;
export const SHAPES = [...BASIC_SHAPES, ...LEGACY_SHAPES] as const;
export type Shape = (typeof SHAPES)[number];
export const PRESENTATIONS = ['card', 'icon', 'table', 'participant'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export const CARDINALITIES = ['one', 'many', 'zero-one', 'zero-many'] as const;
export type Cardinality = (typeof CARDINALITIES)[number];
export interface TableField {
  name: string;
  type?: string;
  key?: 'PK' | 'FK';
}

export function validTableFields(value: unknown): value is TableField[] {
  return Array.isArray(value) && value.every(field => typeof field === 'object' && field !== null && !Array.isArray(field)
    && typeof field.name === 'string' && field.name.trim().length > 0
    && (field.type === undefined || typeof field.type === 'string')
    && (field.key === undefined || field.key === 'PK' || field.key === 'FK')
    && Object.keys(field).every(key => ['name', 'type', 'key'].includes(key)));
}

export function sameTableFields(a: TableField[] | undefined, b: TableField[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((field, index) => field.name === b[index]!.name && field.type === b[index]!.type && field.key === b[index]!.key));
}
export const LAYOUT_ROLES = ['entry', 'peer', 'shared'] as const;
export type LayoutRole = (typeof LAYOUT_ROLES)[number];
export const PORTS = ['top', 'right', 'bottom', 'left'] as const;
export type Port = (typeof PORTS)[number];

export function drawingShape(shape: Shape = 'rectangle'): (typeof BASIC_SHAPES)[number] {
  return (BASIC_SHAPES as readonly string[]).includes(shape) ? shape as (typeof BASIC_SHAPES)[number] : 'rectangle';
}
export const CONNECTORS = ['>', '<', '<>', '-', '--', '-->'] as const;
export type Connector = (typeof CONNECTORS)[number];

export interface Span {
  from: number;
  to: number;
}

export interface DiagramStyle {
  direction: Direction;
  colorMode: ColorMode;
  styleMode: StyleMode;
  typeface: Typeface;
}

export const DEFAULT_STYLE: DiagramStyle = {
  direction: 'right',
  colorMode: 'pastel',
  styleMode: 'shadow',
  typeface: 'clean',
};

export interface ElementProps {
  fields?: TableField[];
  presentation?: Presentation;
  layoutRole?: LayoutRole;
  label?: string;
  icon?: string;
  color?: string;
  link?: string;
  tech?: string;
  description?: string;
  colorMode?: ColorMode;
  styleMode?: StyleMode;
  typeface?: Typeface;
}

export interface NodeEl extends ElementProps {
  kind: 'node';
  id: ID;
  parentId?: ID;
  shape?: Shape;
  span?: Span;
}

export interface GroupEl extends ElementProps {
  /** A named, independently arranged diagram area inside the canvas. */
  canvasFrame?: boolean;
  kind: 'group';
  id: ID;
  parentId?: ID;
  span?: Span;
}

export type DiagramElement = NodeEl | GroupEl;

export interface EdgeEl {
  fromCardinality?: Cardinality;
  toCardinality?: Cardinality;
  fromPort?: Port;
  toPort?: Port;
  id: ID;
  from: ID;
  to: ID;
  connector: Connector;
  label?: string;
  color?: string;
  span?: Span;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  span?: Span;
}

export interface DiagramModel {
  style: DiagramStyle;
  elements: Record<ID, DiagramElement>;
  order: ID[];
  edges: EdgeEl[];
  diagnostics: Diagnostic[];
}

export interface NodeBox {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** Cached router output; `key` identifies the endpoint rects it was computed for. */
export interface EdgeRoute {
  points: [number, number][];
  key?: string;
  /** Center of the edge's label, placed clear of other labels, nodes and group borders. */
  label?: [number, number];
}

export interface LayoutState {
  nodes: Record<ID, NodeBox>;
  edges: Record<ID, EdgeRoute>;
}

export type UpdatableProps = ElementProps & { shape?: Shape; canvasFrame?: boolean };
export type PropPatch = { [K in keyof UpdatableProps]?: UpdatableProps[K] | null };

/**
 * Canonical key lists for `UpdatableProps`/`DiagramStyle`, shared by `diff.ts` and `compare.ts` so they
 * cannot silently disagree. The `satisfies` check below fails to compile if either type gains or loses
 * a key without this list being updated to match.
 */
const UPDATABLE_PROP_KEY_SET = {
  presentation: true, layoutRole: true, fields: true, canvasFrame: true,
  label: true, shape: true, icon: true, color: true, link: true, tech: true, description: true,
  colorMode: true, styleMode: true, typeface: true,
} satisfies Record<keyof UpdatableProps, true>;
export const UPDATABLE_PROP_KEYS: readonly (keyof UpdatableProps)[] = Object.keys(UPDATABLE_PROP_KEY_SET) as (keyof UpdatableProps)[];

const STYLE_KEY_SET = { direction: true, colorMode: true, styleMode: true, typeface: true } satisfies Record<keyof DiagramStyle, true>;
export const STYLE_KEYS: readonly (keyof DiagramStyle)[] = Object.keys(STYLE_KEY_SET) as (keyof DiagramStyle)[];

export type DiagramOp =
  | { op: 'add_node'; id: ID; description?: string; label?: string; parentId?: ID; shape?: Shape; icon?: string; color?: string; tech?: string; presentation?: Presentation; layoutRole?: LayoutRole; fields?: TableField[] }
  | { op: 'add_group'; id: ID; canvasFrame?: boolean; description?: string; label?: string; parentId?: ID; icon?: string; color?: string }
  | { op: 'connect'; from: ID; to: ID; connector?: Connector; label?: string; color?: string; fromPort?: Port; toPort?: Port; fromCardinality?: Cardinality; toCardinality?: Cardinality }
  | { op: 'insert_between'; from: ID; to: ID; node: { id: ID; description?: string; label?: string; icon?: string; tech?: string } }
  | { op: 'update'; id: ID; set: PropPatch }
  | { op: 'update_edge'; edgeId: ID; set: { label?: string | null; color?: string | null; connector?: Connector; fromPort?: Port | null; toPort?: Port | null; fromCardinality?: Cardinality | null; toCardinality?: Cardinality | null } }
  | { op: 'rename'; id: ID; to: ID }
  | { op: 'move_to_group'; id: ID; parentId: ID | null }
  | { op: 'remove'; id: ID }
  | { op: 'remove_edge'; edgeId: ID }
  | { op: 'set_style'; set: Partial<DiagramStyle> }
  /** `order`: every element id once, in the new declaration order; `edges[i]`: current index of the edge that goes to position i. */
  | { op: 'reorder'; order?: ID[]; edges?: number[] };

export function emptyModel(): DiagramModel {
  return { style: { ...DEFAULT_STYLE }, elements: {}, order: [], edges: [], diagnostics: [] };
}

export function emptyLayout(): LayoutState {
  return { nodes: {}, edges: {} };
}
