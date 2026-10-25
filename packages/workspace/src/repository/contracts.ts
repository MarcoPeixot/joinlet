/** Browser-safe repository protocol. No filesystem, credentials or absolute paths in persisted metadata. */
export type RepositoryPhase = 'queued' | 'folder' | 'git' | 'files' | 'architecture' | 'sync' | 'ready' | 'review' | 'conflict' | 'paused' | 'disconnected' | 'error';
export interface RepositoryEntry { path: string; revision: string; bytes?: number }
export interface RepositoryReader {
  policy?: string;
  revision(): Promise<string>;
  list(): Promise<RepositoryEntry[]>;
  read(path: string): Promise<string | null>;
}
export interface SourceRef { path: string; line: number; contains: string }
export interface RepositoryTechnology { id: string; refs: SourceRef[] }
export interface RepositoryDependency { target: string; ref: SourceRef; usage?: 'value' | 'type' | 'include' | 'unknown'; scope?: 'production' | 'development' }
export interface RepositoryFact { limitations?: string[]; unresolved?: { name:string; ref:SourceRef; usage?:string; scope?:string }[]; id: string; label: string; tech?: string; kind?: 'module' | 'dependency'; path?: string; technologies?: RepositoryTechnology[]; primaryTechnology?: string; refs: SourceRef[]; dependencies: RepositoryDependency[] }
export interface RepositoryProposal { revision?:string; id: string; summary: string; refs: SourceRef[]; ops: unknown[]; reason: string }
export interface RepositoryAnalysis { facts: RepositoryFact[]; proposals: RepositoryProposal[] }
export interface RepositoryAnalyzer {
  identity?: string;
  analyze(input: { files: { path: string; text: string }[]; facts: RepositoryFact[]; revision: string; signal?: AbortSignal }): Promise<RepositoryAnalysis>;
}
export class RepositoryProviderNotConfigured extends Error {
  constructor() { super('AI provider is not configured; semantic code analysis is pending.'); this.name = 'RepositoryProviderNotConfigured'; }
}
export type RepositoryLocale = 'pt-BR' | 'en';
export function repositoryLocale(value: unknown): RepositoryLocale { return typeof value === 'string' && /^pt(?:-|$)/i.test(value) ? 'pt-BR' : 'en'; }
export type RepositoryView = 'auto' | 'modules' | 'dependencies';
export interface RepositoryConfig { version: 1; locale?: RepositoryLocale; view?: RepositoryView; diagram: string; include: string[]; exclude: string[]; ai: boolean; maxFiles: number; maxBytes: number; maxAiCalls: number }
export interface RepositoryStatus {
  id: string; phase: RepositoryPhase; completed: number; total: number;
  analyzedRevision: string | null; persistedRevision: string | null;
  coverage: 'none' | 'partial'; pending: string[]; proposals: RepositoryProposal[];
  metrics: { architectureReads?:number; files: number; reads: number; aiCalls: number; written: number };
  git?: { available: boolean; version: string; repository: boolean; branch: string | null; upstream: string | null; ahead: number | null; behind: number | null; remoteFresh: boolean; dirty: boolean };
  error?: string; initialized?: boolean; root?: string;
  knowledge?: {documents:number;connections:number};
}
export interface RepositoryJob extends RepositoryStatus { created: number; updated: number }
export const REPOSITORY_CONFIG = 'repository.json';
export const REPOSITORY_STATE = 'repository-state.json';
export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = { version: 1, diagram: 'repository', include: ['**/*'], exclude: [], ai: true, maxFiles: 20_000, maxBytes: 20_000_000, maxAiCalls: 20 };

export type ImportUsage = 'value' | 'type' | 'include' | 'unknown';
export interface SyntaxImport { name:string; line:number; contains:string; usage:ImportUsage; local?:boolean }
export interface SyntaxResult { imports:SyntaxImport[]; declarations:string[]; limitations:string[] }
