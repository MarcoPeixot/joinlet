import { applyOps, diffModels, emptyModel, STRUKT_FORMAT_VERSION } from '@strukt/core';
import type { ComponentPreset, DiagramModel, DiagramOp, NodeBox } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { stableStringify } from './json';
import type { DiagramTemplate } from './templates';

export const LIBRARY_PATH = 'library.json';

export interface WorkspaceLibrary {
  components: ComponentPreset[];
  templates: DiagramTemplate[];
}

export const emptyLibrary = (): WorkspaceLibrary => ({ components: [], templates: [] });

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A biblioteca contém um objeto inválido.');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 2000) throw new Error(`Biblioteca: ${field} inválido.`);
  return value.trim();
}

function dimension(value: unknown, max = 4000): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 32 || value > max) throw new Error('Biblioteca: tamanho inválido.');
  return value;
}

function checkedModel(model: DiagramModel): DiagramModel {
  const parsed = parseDiagramJson(printDiagramJson(model));
  const error = parsed.diagnostics.find((item) => item.severity === 'error');
  if (error) throw new Error(`Biblioteca: ${error.message}`);
  return parsed.model;
}

function component(value: unknown): ComponentPreset {
  const raw = record(value);
  if (raw.kind !== undefined && raw.kind !== 'node' && raw.kind !== 'group') throw new Error('Biblioteca: tipo de componente inválido.');
  const id = text(raw.id, 'id')!;
  const label = text(raw.label, 'nome')!;
  const category = text(raw.category, 'categoria')!;
  const description = text(raw.description, 'descrição', true) ?? '';
  const color = text(raw.color, 'cor', true) ?? 'gray';
  const props: Record<string, unknown> = { id: 'componente', label, color };
  for (const key of ['icon', 'shape', 'tech', 'presentation', 'layoutRole', 'fields']) if (raw[key] !== undefined) props[key] = raw[key];
  const parsed = parseDiagramJson(JSON.stringify({ version: STRUKT_FORMAT_VERSION, nodes: [props] }));
  if (parsed.diagnostics.length) throw new Error(`Biblioteca: componente ${label}: ${parsed.diagnostics[0]!.message}`);
  const node = parsed.model.elements.componente;
  if (!node || node.kind !== 'node') throw new Error('Biblioteca: componente inválido.');
  const width = dimension(raw.width), height = dimension(raw.height);
  return { id, label, category, description, color, ...(raw.kind ? { kind: raw.kind as 'node' | 'group' } : {}), ...(node.icon ? { icon: node.icon } : {}), ...(node.shape ? { shape: node.shape } : {}), ...(node.tech ? { tech: node.tech } : {}), ...(node.presentation ? { presentation: node.presentation } : {}), ...(node.layoutRole ? { layoutRole: node.layoutRole } : {}), ...(node.fields ? { fields: node.fields } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

function positions(value: unknown, model: DiagramModel): Record<string, NodeBox> | undefined {
  if (value === undefined) return undefined;
  const result: Record<string, NodeBox> = {};
  for (const [id, entry] of Object.entries(record(value))) {
    if (!Object.hasOwn(model.elements, id)) throw new Error(`Biblioteca: posição de elemento inexistente: ${id}.`);
    const raw = record(entry);
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || Math.abs(raw.x) > 1_000_000 || Math.abs(raw.y) > 1_000_000) throw new Error('Biblioteca: posição inválida.');
    const w = dimension(raw.w, 100_000), h = dimension(raw.h, 100_000);
    Object.defineProperty(result, id, { value: { x: raw.x, y: raw.y, ...(w ? { w } : {}), ...(h ? { h } : {}) }, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function template(value: unknown): DiagramTemplate {
  const raw = record(value);
  const id = text(raw.id, 'id')!, title = text(raw.title, 'título')!;
  const description = text(raw.description, 'descrição', true) ?? '';
  const category = text(raw.category, 'categoria', true) ?? 'Meu workspace';
  if (!Array.isArray(raw.ops) || !raw.ops.length || raw.ops.length > 2000) throw new Error(`Biblioteca: operações inválidas em ${title}.`);
  const applied = applyOps(emptyModel(), raw.ops as DiagramOp[]);
  if (!applied.ok) throw new Error(`Biblioteca: ${applied.error.message}`);
  const model = checkedModel(applied.model);
  if (!model.order.length) throw new Error('Um template precisa de pelo menos um elemento.');
  const layout = positions(raw.positions, model);
  return { id, title, description, category, ops: diffModels(emptyModel(), model), ...(layout ? { positions: layout } : {}) };
}

export function parseLibrary(source: string): WorkspaceLibrary {
  try {
    if (source.length > 2_000_000) throw new Error('A biblioteca excede 2 MB.');
    const raw = record(JSON.parse(source));
    if (raw.version !== 1) throw new Error('Versão de biblioteca não suportada.');
    const parseEntries = <T extends { id: string }>(value: unknown, parse: (entry: unknown) => T): T[] => {
      if (!Array.isArray(value) || value.length > 500) throw new Error('A biblioteca precisa de listas com até 500 entradas.');
      const entries = value.map(parse);
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('A biblioteca contém ids repetidos.');
      return entries;
    };
    return { components: parseEntries(raw.components, component), templates: parseEntries(raw.templates, template) };
  } catch (error) {
    throw new Error(`library.json: ${error instanceof Error ? error.message : 'conteúdo inválido'}`);
  }
}

export function printLibrary(library: WorkspaceLibrary): string {
  return stableStringify({ version: 1, ...library });
}

export function templateFromDiagram(id: string, title: string, description: string, model: DiagramModel, nodes: Record<string, NodeBox>): DiagramTemplate {
  return template({ id, title, description, category: 'Meu workspace', ops: diffModels(emptyModel(), model), positions: nodes });
}
