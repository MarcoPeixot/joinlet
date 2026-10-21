import { describe, expect, it } from 'vitest';
import { CANVAS_MIN, DOCK_WIDTH, PANEL_WIDTH, canvasWidth, sidebarShouldYield } from './room';

describe('canvas room', () => {
  it('gives every right-slot panel one width with room for floating gutters', () => {
    expect(PANEL_WIDTH).toBe(360);
    expect(DOCK_WIDTH).toBe(384);
  });

  it('is what is left of the window after the docked chrome', () => {
    expect(canvasWidth(1280, { sidebar: false, code: null, dock: false })).toBe(1280);
    expect(canvasWidth(1280, { sidebar: true, code: null, dock: false })).toBe(1020);
    expect(canvasWidth(1280, { sidebar: true, code: null, dock: true })).toBe(636);
    expect(canvasWidth(1280, { sidebar: true, code: 400, dock: true })).toBe(236);
  });
});

describe('sidebarShouldYield', () => {
  it('leaves the sidebar alone while the canvas keeps its room', () => {
    expect(sidebarShouldYield(1280, { sidebar: true, code: null, dock: true })).toBe(false);
    expect(sidebarShouldYield(1680, { sidebar: true, code: 400, dock: true })).toBe(false);
  });
  it('steps aside on a narrow window, and when the code panel is open beside the panel', () => {
    expect(sidebarShouldYield(820, { sidebar: true, code: null, dock: true })).toBe(true);
    expect(sidebarShouldYield(1280, { sidebar: true, code: 400, dock: true })).toBe(true);
  });
  it('never acts without a panel or without a sidebar', () => {
    expect(sidebarShouldYield(820, { sidebar: true, code: null, dock: false })).toBe(false);
    expect(sidebarShouldYield(900, { sidebar: true, code: 400, dock: false })).toBe(true);
    expect(sidebarShouldYield(820, { sidebar: false, code: null, dock: true })).toBe(false);
  });
  it('keeps the threshold visible', () => {
    expect(CANVAS_MIN).toBeGreaterThan(300);
  });
});

// Both editors stay mounted; small windows move Code above the bottom of the canvas.
describe('compact code panel',()=>{
 it('floats only when code and the reserved dock would leave too little canvas',async()=>{
  const {codeShouldFloat}=await import('./room');
  expect(codeShouldFloat(900,400,384)).toBe(true);
  expect(codeShouldFloat(1280,400,384)).toBe(false);
  expect(codeShouldFloat(700,400,0)).toBe(true);
  expect(codeShouldFloat(900,400,0)).toBe(false);
 });
});
