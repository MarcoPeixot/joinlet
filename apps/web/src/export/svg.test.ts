import { applyOps, computeRects, emptyModel } from '@strukt/core';
import { routeKey } from '@strukt/layout';
import { describe, expect, it, vi } from 'vitest';
import { groupColors, nodeColors } from '../diagram/palette';
import { CANVAS } from '../ui/theme';
import { renderDiagramSvg } from './svg';

describe('renderDiagramSvg', () => {
  it('exports table rows, typed keys and crow’s foot endpoints in light and dark themes', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'Users', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'team_id', type: 'uuid', key: 'FK' }] }, { op: 'add_node', id: 'Teams', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }] }, { op: 'connect', from: 'Teams', to: 'Users', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' }]);
    if (!result.ok) throw new Error(result.error.message);
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderDiagramSvg(result.model, { nodes: { Teams: { x: 0, y: 0 }, Users: { x: 500, y: 0 } }, edges: {} }, { theme });
      expect(svg).toContain('>PK</text>'); expect(svg).toContain('>FK</text>'); expect(svg).toContain('>team_id</text>'); expect(svg).toContain('>uuid</text>');
      expect(svg).toContain('r="4.5"'); expect(svg).not.toMatch(/undefined|NaN/);
    }
  });

  it('exports horizontal ordered sequence messages and dashed returns on extended lifelines', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'Client', presentation: 'participant' }, { op: 'add_node', id: 'API', presentation: 'participant' }, { op: 'connect', from: 'Client', to: 'API', label: 'Request' }, { op: 'connect', from: 'API', to: 'Client', label: 'Response', connector: '-->' }]);
    if (!result.ok) throw new Error(result.error.message);
    const svg = renderDiagramSvg(result.model, { nodes: { Client: { x: 0, y: 0 }, API: { x: 360, y: 0 } }, edges: {} }, { theme: 'light' });
    expect(svg).toContain('>1. Request</text>'); expect(svg).toContain('>2. Response</text>');
    expect(svg).toContain('d="M 90 112'); expect(svg).toContain('d="M 450 176');
    expect(svg.match(/stroke-dasharray="6 5"/g)).toHaveLength(3);
    expect(svg).not.toMatch(/undefined|NaN/);
  });
  it('exports scene cards with internal titles, technology and shared sizing', () => {
    const result=applyOps(emptyModel(),[{op:'add_node',id:'API',presentation:'card',layoutRole:'entry',tech:'NestJS'},{op:'add_node',id:'Infra',presentation:'card',layoutRole:'shared'}]);
    if(!result.ok)throw new Error(result.error.message);
    const svg=renderDiagramSvg(result.model,{nodes:{API:{x:0,y:0,w:236,h:84},Infra:{x:0,y:240,w:900,h:84}},edges:{}},{theme:'light'});
    expect(svg).toContain('width="900"');expect(svg).toContain('font-size="18"');expect(svg).toContain('NestJS');expect(svg).not.toContain('undefined');
  });
  it('exports a legacy component as an icon with separate title and technology', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'API', shape: 'component', icon: 'nestjs', tech: 'NestJS · Node.js' }]);
    if (!result.ok) throw new Error(result.error.message);
    const svg = renderDiagramSvg(result.model, { nodes: {}, edges: {} }, { theme: 'light' });
    expect(svg).toContain('font-size="15"');
    expect(svg).toContain('font-size="12"');
    expect(svg).toContain('NestJS · Node.js');
    expect(svg).toContain('>API</text>');
  });
  it('keeps a legacy actor legible as a card in bold color mode', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'Usuário', shape: 'actor', color: 'blue' }, { op: 'set_style', set: { colorMode: 'bold' } }]);
    if (!result.ok) throw new Error(result.error.message);
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderDiagramSvg(result.model, { nodes: {}, edges: {} }, { theme });
      expect(svg).toContain(`fill="${nodeColors('blue', 'bold', theme).text}">Usuário</text>`);
    }
  });
  it('wraps long captions and reserves enough room in the exported drawing', () => {
    const model = applyOps(emptyModel(), [{ op: 'add_node', id: 'Fila de resultados e processamento assíncrono dos workers', icon: 'layers' }]);
    if (!model.ok) throw new Error(model.error.message);
    const output = renderDiagramSvg(model.model, { nodes: {}, edges: {} }, { theme: 'light' });
    expect(output.match(/<tspan /g)!.length).toBeGreaterThan(2);
    expect(output).toContain('assíncrono');
    expect(output).not.toMatch(/NaN|undefined/);
  });
  const result = applyOps(emptyModel(), [
    { op: 'add_group', id: 'Core', color: 'blue' },
    { op: 'add_node', id: 'API', parentId: 'Core', shape: 'rectangle', icon: 'server' },
    { op: 'add_node', id: 'Cache', parentId: 'Core', icon: 'redis' },
    { op: 'connect', from: 'API', to: 'Cache', label: 'R&D <cache>' },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  const layout = { nodes: { API: { x: 0, y: 0 }, Cache: { x: 300, y: 4 } }, edges: {} };
  const icons = {
    redis: { viewBox: '0 0 24 24', body: '<path d="M1 1"/>', mode: 'fill' as const, color: '#FF4438' },
    server: { viewBox: '0 0 24 24', body: '<rect width="2" height="2"/>', mode: 'stroke' as const },
  };
  const svg = renderDiagramSvg(result.model, layout, { theme: 'light', icons, fontCss: '@font-face{}' });

  it('is a standalone svg sized to the content', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/viewBox="-?\d/);
    expect(svg).toContain('<style>@font-face{}</style>');
    expect(svg).not.toMatch(/undefined|NaN/);
  });

  it('draws groups, nodes, icons and escaped labels', () => {
    expect(svg).toContain('>Core</text>');
    expect(svg).toContain('>API</text>');
    expect(svg).toContain('fill="#FF4438"');
    expect(svg).toContain('R&amp;D &lt;cache&gt;');
  });

  it('paints the soft shadow the canvas paints: a blurred shade under nodes and groups', () => {
    expect(svg).toContain('<filter id="strukt-shadow"');
    expect(svg).toContain('fill="rgba(24, 28, 40, 0.06)" filter="url(#strukt-shadow)"');
  });

  it('draws edge labels as pills and groups with the rounder corners', () => {
    expect(svg).toMatch(/<rect [^>]*rx="10"[^>]*stroke-opacity="0.22"/);
    expect(svg).toMatch(/<rect x="-?[\d.]+" y="-?[\d.]+" width="[\d.]+" height="[\d.]+" rx="14" fill=/);
  });

  it('draws an edge label where the canvas does: its placed position from the routes', () => {
    const rects = computeRects(result.model, layout);
    const placed = { ...layout, edges: { 'API→Cache': { points: [[0, 500], [400, 500]] as [number, number][], key: routeKey(rects.API!, rects.Cache!), label: [320, 500] as [number, number] } } };
    const out = renderDiagramSvg(result.model, placed, { theme: 'light', icons });
    expect(out).toContain('<text x="320" y="500" text-anchor="middle"');
  });

  it('draws the cached routes when they are fresh, like the canvas, and routes only a stale cache', () => {
    const rects = computeRects(result.model, layout);
    const route = vi.fn(() => ({ 'API→Cache': [[0, 700], [400, 700]] as [number, number][] }));
    const router = { route };
    const cached = { ...layout, edges: { 'API→Cache': { points: [[0, 500], [400, 500]] as [number, number][], key: routeKey(rects.API!, rects.Cache!) } } };
    const fresh = renderDiagramSvg(result.model, cached, { theme: 'light', icons, router });
    expect(route).not.toHaveBeenCalled();
    expect(fresh).toContain('d="M 0 500');

    const stale = { ...layout, edges: { 'API→Cache': { ...cached.edges['API→Cache'], key: 'moved' } } };
    const rerouted = renderDiagramSvg(result.model, stale, { theme: 'light', icons, router });
    expect(route).toHaveBeenCalledTimes(1);
    expect(rerouted).toContain('d="M 0 700');
    expect(rerouted).not.toContain('d="M 0 500');
  });

  it('keeps a dark single-color brand mark legible in a dark export (group chip, shape node and icon node)', () => {
    const marks = applyOps(emptyModel(), [
      { op: 'add_group', id: 'Repo', icon: 'github' },
      { op: 'add_node', id: 'CI', parentId: 'Repo', shape: 'rectangle', icon: 'github' },
      { op: 'add_node', id: 'GitHub', icon: 'github' },
    ]);
    if (!marks.ok) throw new Error(marks.error.message);
    const github = { github: { viewBox: '0 0 24 24', body: '<path d="M9 9"/>', mode: 'fill' as const, color: '#181717' } };
    const boxes = { nodes: { CI: { x: 0, y: 0 }, GitHub: { x: 400, y: 0 } }, edges: {} };
    const fills = (theme: 'light' | 'dark') =>
      [...renderDiagramSvg(marks.model, boxes, { theme, icons: github }).matchAll(/fill="([^"]+)"><path d="M9 9"\/>/g)].map((m) => m[1]).sort();

    const mode = marks.model.style.colorMode;
    expect(fills('dark')).toEqual([groupColors(undefined, mode, 'dark').stroke, nodeColors(undefined, mode, 'dark').icon, CANVAS.dark.ink].sort());
    expect(fills('dark')).not.toContain('#181717');
    expect(fills('light')).toEqual(['#181717', '#181717', '#181717']);
  });
});
