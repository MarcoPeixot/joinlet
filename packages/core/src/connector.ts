import type { Cardinality, Connector } from './model';

export interface ConnectorStyle {
  dashed: boolean;
  startArrow: boolean;
  endArrow: boolean;
}

export function connectorStyle(connector: Connector): ConnectorStyle {
  switch (connector) {
    case '>':
      return { dashed: false, startArrow: false, endArrow: true };
    case '<':
      return { dashed: false, startArrow: true, endArrow: false };
    case '<>':
      return { dashed: false, startArrow: true, endArrow: true };
    case '-':
      return { dashed: false, startArrow: false, endArrow: false };
    case '--':
      return { dashed: true, startArrow: false, endArrow: false };
    case '-->':
      return { dashed: true, startArrow: false, endArrow: true };
  }
}

/** Crow's foot notation, oriented from the endpoint into the connection. */
export function cardinalityGlyph(cardinality: Cardinality, at: [number, number], toward: [number, number]): { path: string; circle?: [number, number] } {
  const length = Math.hypot(toward[0] - at[0], toward[1] - at[1]) || 1;
  const dx = (toward[0] - at[0]) / length, dy = (toward[1] - at[1]) / length;
  const point = (along: number, across: number): [number, number] => [at[0] + dx * along - dy * across, at[1] + dy * along + dx * across];
  const segment = (a: [number, number], b: [number, number]) => `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
  const many = cardinality === 'many' || cardinality === 'zero-many';
  const zero = cardinality === 'zero-one' || cardinality === 'zero-many';
  const path = many
    ? [-7, 0, 7].map(offset => segment(point(2, offset), point(16, 0))).join(' ')
    : segment(point(10, -7), point(10, 7));
  return { path: `${path}${zero ? '' : ` ${segment(point(23, -7), point(23, 7))}`}`, ...(zero ? { circle: point(24, 0) } : {}) };
}
