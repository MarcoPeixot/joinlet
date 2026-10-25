import type { RepositoryReader, RepositoryAnalyzer } from '@strukt/workspace/repository-contracts';
import { writeBatch } from '@strukt/workspace/repository-transaction';
import { writeGeneratedContext } from '@strukt/workspace/context-storage';
import { own } from '@strukt/core';
import { loadWorkspace, workspaceFiles } from '@strukt/workspace';
import type { StorageAdapter, WorkspaceData } from '@strukt/workspace';
import { openWorkspaceAt, writeWorkspace } from '@strukt/workspace/fs';

/** The open workspace and the storage it came from; every write goes through `save`. */
export interface McpWorkspace {
  root: string;
  archDir: string;
  adapter: StorageAdapter;
  data: WorkspaceData;
  warnings: string[];
  disk: Record<string, string | null>;
  /** Set by the HTTP server (never by stdio): reports events worth a webhook (a version saved by an agent, a PR opened). */
  notify?: (event: McpEvent) => void;
  repositoryReader?: RepositoryReader;
  listRepositoryFiles?: (options?:Parameters<typeof import('@strukt/workspace/repository-source-access').listRepositoryFiles>[1])=>ReturnType<typeof import('@strukt/workspace/repository-source-access').listRepositoryFiles>;
  readRepositorySource?: (path:string,start?:number,count?:number,revision?:string)=>ReturnType<typeof import('@strukt/workspace/repository-source-access').readRepositorySource>;
  inspectRepository?: () => Promise<unknown>;
  repositoryAnalyzer?: RepositoryAnalyzer;
  requestRepositorySync?: () => Promise<unknown>;
  onSaved?: (paths: string[]) => Promise<void>;
}

export type McpEvent =
  | { event: 'version'; diagram: string; message: string; author: 'agent' }
  | { event: 'pr'; title: string; url: string; branch?: string };

async function diskFiles(adapter: StorageAdapter, data: WorkspaceData): Promise<Record<string, string | null>> {
  return Object.fromEntries(await Promise.all(Object.keys(workspaceFiles(data)).map(async (path) => [path, await adapter.read(path)] as const)));
}

export async function openMcpWorkspace(start: string): Promise<McpWorkspace | { error: string }> {
  const opened = await openWorkspaceAt(start);
  if (!opened) return { error: `Nenhum workspace do Joinlet encontrado a partir de "${start}" (procurei .arch/strukt.json).` };
  return { root: opened.root, archDir: opened.archDir, adapter: opened.adapter, data: opened.data, warnings: opened.warnings, disk: await diskFiles(opened.adapter, opened.data) };
}

/** Stdio clients stay alive across editor writes; reload before each operation. */
export async function refresh(ws: McpWorkspace): Promise<void> {
  const loaded = await loadWorkspace(ws.adapter);
  if (!loaded) throw new Error('O workspace não existe mais no disco.');
  ws.data = loaded.data;
  ws.warnings = loaded.warnings;
  ws.disk = await diskFiles(ws.adapter, loaded.data);
}

export async function flush(ws: McpWorkspace): Promise<void> {
  await (ws.adapter as StorageAdapter & { flush?: () => Promise<unknown> }).flush?.();
}

/** Writes the generated context files (changed only) and removes the ones the workspace no longer generates. */
export async function writeContext(ws: McpWorkspace, before: WorkspaceData, commit = true): Promise<string[]> {
  const touched = await writeGeneratedContext(ws.adapter, ws.data);
  if (commit) await flush(ws);
  return touched;
}

/**
 * Saves `before` → `ws.data` the way the app does (only changed files), and refreshes `.arch/context/`
 * when it already existed before the write. Returns the touched paths.
 */
export async function save(ws: McpWorkspace, before: WorkspaceData): Promise<string[]> {
  const previous = workspaceFiles(before);
  const current = workspaceFiles(ws.data);
  const paths = [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(path => previous[path] !== current[path]);
  const hadContext = (await ws.adapter.read('context/ARCHITECTURE.md')) !== null;
  await writeBatch(ws.adapter, paths.map(path => ({path, text:current[path] ?? null, expected:ws.disk[path] ?? null})));
  const touched = [...paths];
  if (hadContext) touched.push(...(await writeContext(ws, before, false)));
  await flush(ws);
  ws.disk = await diskFiles(ws.adapter, ws.data);
  await ws.onSaved?.(touched);
  return touched.sort();
}

/** Replaces one diagram in the workspace data (never mutates the previous object). */
export function withDiagram(ws: McpWorkspace, slug: string, snapshot: WorkspaceData['diagrams'][string]): void {
  ws.data = { ...ws.data, diagrams: { ...ws.data.diagrams, [slug]: snapshot } };
}

/** A short pt-BR summary of a diagram: components, groups, connections and the first ids. */
export function diagramSummary(slug: string, data: WorkspaceData): string {
  const model = own(data.diagrams, slug)?.model;
  if (!model) return `Diagrama "${slug}": vazio.`;
  const components = model.order.filter((id) => model.elements[id]?.kind === 'node').length;
  const groups = model.order.length - components;
  const names = model.order.slice(0, 12).join(', ');
  return `Diagrama "${slug}": ${components} componente(s), ${groups} grupo(s), ${model.edges.length} conexão(ões). Elementos: ${names}${model.order.length > 12 ? ', …' : ''}`;
}

export { workspaceFiles };
