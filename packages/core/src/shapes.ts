import { drawingShape } from './model';
import type { Shape } from './model';
import { SHAPE_LABEL_INSETS } from './geometry';

export interface ShapeGeometry {
  d: string;
  /** Internal strokes, shared by the canvas, library previews and exports. */
  detail?: string;
}

const n = (v: number) => Math.round(v * 100) / 100;

function roundedRect(w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h / 2);
  return (
    `M ${n(r)} 0 H ${n(w - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)} V ${n(h - r)} ` +
    `A ${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)} H ${n(r)} A ${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)} ` +
    `V ${n(r)} A ${n(r)} ${n(r)} 0 0 1 ${n(r)} 0 Z`
  );
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)} ` +
    `A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`
  );
}

function poly(points: [number, number][]): string {
  return `${points.map(([x, y], i) => `${i ? 'L' : 'M'} ${n(x)} ${n(y)}`).join(' ')} Z`;
}

function starPoints(w: number, h: number): [number, number][] {
  const outer = Math.min(w, h) / 2;
  const inner = outer * 0.45;
  const cx = w / 2;
  const cy = h / 2 + h * 0.04;
  return Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as [number, number];
  });
}

export function shapeGeometry(shape: Shape, w: number, h: number): ShapeGeometry {
  switch (drawingShape(shape)) {
    case 'rectangle':
      return { d: roundedRect(w, h, 10) };
    case 'oval':
      return { d: roundedRect(w, h, h / 2) };
    case 'ellipse':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'circle': {
      const r = Math.min(w, h) / 2;
      return { d: ellipse(w / 2, h / 2, r, r) };
    }
    case 'diamond':
      return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) };
    case 'hexagon': {
      const inset = Math.min(w * 0.2, h / 2);
      return { d: poly([[inset, 0], [w - inset, 0], [w, h / 2], [w - inset, h], [inset, h], [0, h / 2]]) };
    }
    case 'parallelogram': {
      const skew = Math.min(w * 0.2, 24);
      return { d: poly([[skew, 0], [w, 0], [w - skew, h], [0, h]]) };
    }
    case 'trapezoid': {
      const inset = Math.min(w * 0.18, 24);
      return { d: poly([[inset, 0], [w - inset, 0], [w, h], [0, h]]) };
    }
    case 'triangle':
      return { d: poly([[w / 2, 0], [w, h], [0, h]]) };
    case 'star':
      return { d: poly(starPoints(w, h)) };
    case 'document': {
      const wave = Math.min(10, h * 0.15);
      return {
        d: `M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h - wave)} Q ${n(w * 0.75)} ${n(h - wave * 2)} ${n(w / 2)} ${n(h - wave)} T 0 ${n(h - wave)} Z`,
      };
    }
    case 'cylinder': {
      const ry = Math.min(12, h * 0.15);
      const rx = w / 2;
      return {
        d: `M 0 ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)} L ${n(w)} ${n(h - ry)} A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(h - ry)} Z`,
        detail: `M 0 ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry)}`,
      };
    }

  }
}

/** Fractions of [top, right, bottom, left] kept free so labels stay inside non-rectangular shapes. */
export function labelBox(shape: Shape, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const [top, right, bottom, left] = SHAPE_LABEL_INSETS[drawingShape(shape)];
  return { x: w * left, y: h * top, w: w * (1 - left - right), h: h * (1 - top - bottom) };
}
