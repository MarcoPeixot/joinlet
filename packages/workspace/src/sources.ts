import { stableStringify } from './json';

/** `.arch/sources.json`: which repository files feed which diagram (`joinlet sync`). */
export const SOURCES_PATH = 'sources.json';
export const SOURCES_VERSION = 1;

export const SOURCE_KINDS = ['terraform', 'kubernetes', 'openapi', 'd2', 'mermaid', 'likec4', 'structurizr'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
/** `merge`: three-way merge that keeps what people changed; `replace`: the diagram mirrors the sources. */
export const SOURCE_MODES = ['replace', 'merge'] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

export interface Source {
  id: string;
  kind: SourceKind;
  /** Globs relative to the repository root; a leading `!` excludes. */
  include: string[];
  /** Slug of the target diagram. */
  diagram: string;
  mode: SourceMode;
}

/** `path` locates the problem in the file (`sources[1].include[0]`); the message is pt-BR. */
export interface SourceDiagnostic {
  path: string;
  message: string;
}

export const MAX_SOURCES = 100;
export const MAX_INCLUDES = 50;
const MAX_GLOB_LENGTH = 300;
const MAX_GLOB_SEGMENTS = 20;
const MAX_GLOB_SEGMENT = 100;
const MAX_GLOBSTARS = 4;
const MAX_EXPANSIONS = 64;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const KEYS = ['id', 'kind', 'include', 'diagram', 'mode'];

/** Brace alternatives (`{a,b}`, one level) multiplied out; `null` when braces are unbalanced or nested. */
function tryExpand(pattern: string): string[] | null {
  const open = pattern.indexOf('{');
  const close = pattern.indexOf('}');
  if (open < 0 && close < 0) return [pattern];
  if (open < 0 || close < open) return null;
  if (pattern.indexOf('{', open + 1) >= 0 && pattern.indexOf('{', open + 1) < close) return null;
  const alternatives = pattern.slice(open + 1, close).split(',');
  const rest = tryExpand(pattern.slice(close + 1));
  if (!rest) return null;
  const out: string[] = [];
  for (const alt of alternatives) for (const tail of rest) {
    out.push(`${pattern.slice(0, open)}${alt}${tail}`);
    if (out.length > MAX_EXPANSIONS) return out;
  }
  return out;
}

export function expandBraces(pattern: string): string[] {
  return tryExpand(pattern) ?? [pattern];
}

/** A pt-BR reason when `pattern` (with its optional leading `!`) is not an accepted glob; `null` when it is fine. */
export function globProblem(pattern: string): string | null {
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;
  if (!body) return 'Padrão vazio.';
  if (body.length > MAX_GLOB_LENGTH) return `Padrão longo demais (máximo ${MAX_GLOB_LENGTH} caracteres).`;
  if (body.includes('\0') || body.includes('\\')) return 'Use "/" como separador, sem "\\" nem caracteres de controle.';
  if (body.startsWith('/') || /^[A-Za-z]:/.test(body)) return 'O padrão precisa ser relativo à raiz do repositório.';
  if (body.includes('[') || body.includes(']')) return 'Colchetes não são suportados; use *, **, ? e {a,b}.';
  const expansions = tryExpand(body);
  if (!expansions) return 'Chaves {a,b} desbalanceadas ou aninhadas.';
  if (expansions.length > MAX_EXPANSIONS) return `Chaves {a,b} geram alternativas demais (máximo ${MAX_EXPANSIONS}).`;
  for (const expansion of expansions) {
    const segments = expansion.split('/');
    if (segments.length > MAX_GLOB_SEGMENTS) return `Profundidade demais (máximo ${MAX_GLOB_SEGMENTS} pastas).`;
    if (segments.some((segment) => segment === '')) return 'O padrão tem um segmento vazio ("//" ou "/" no fim).';
    if (segments.some((segment) => segment === '.' || segment === '..')) return 'O padrão não pode conter "." nem ".." (nada fora do repositório).';
    if (segments.some((segment) => segment.length > MAX_GLOB_SEGMENT)) return `Segmento longo demais (máximo ${MAX_GLOB_SEGMENT} caracteres).`;
    if (segments.filter((segment) => segment === '**').length > MAX_GLOBSTARS) return `"**" demais no padrão (máximo ${MAX_GLOBSTARS}).`;
  }
  return null;
}

/** `*` and `?` inside one path segment (iterative: no backtracking blow-up, no regular expression built from user text). */
function matchSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** `**` spans any number of directories (memoized, so it is polynomial in the path depth). */
function matchSegments(pattern: readonly string[], path: readonly string[]): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * (path.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (i === pattern.length) result = j === path.length;
    else if (pattern[i] === '**') result = go(i + 1, j) || (j < path.length && go(i, j + 1));
    else result = j < path.length && matchSegment(pattern[i]!, path[j]!) && go(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** Does the repository-relative posix `path` match `pattern`? (No `!` handling here.) */
export function matchGlob(pattern: string, path: string): boolean {
  const segments = path.split('/');
  return expandBraces(pattern).some((expansion) => matchSegments(expansion.split('/'), segments));
}

/** A path is included when some positive pattern matches and no `!` pattern does. */
export function matchesInclude(include: readonly string[], path: string): boolean {
  let positive = false;
  for (const pattern of include) {
    if (pattern.startsWith('!')) {
      if (matchGlob(pattern.slice(1), path)) return false;
    } else if (!positive && matchGlob(pattern, path)) positive = true;
  }
  return positive;
}

/** The leading directories of a (brace-free) pattern that contain no wildcard: where a directory walk can start. */
export function globPrefix(pattern: string): string[] {
  const segments = pattern.split('/');
  const prefix: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    if (/[*?{}]/.test(segment)) break;
    prefix.push(segment);
  }
  return prefix;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (record: Record<string, unknown>, key: string) => (Object.hasOwn(record, key) ? record[key] : undefined);
const list = (items: readonly string[]) => items.join(', ') || 'nenhum';

function parseSource(raw: unknown, index: number, diagnostics: SourceDiagnostic[]): Source | null {
  const base = `sources[${index}]`;
  if (!isRecord(raw)) {
    diagnostics.push({ path: base, message: 'Cada fonte precisa ser um objeto.' });
    return null;
  }
  const before = diagnostics.length;
  const problem = (field: string, message: string) => diagnostics.push({ path: field ? `${base}.${field}` : base, message });
  for (const key of Object.keys(raw)) if (!KEYS.includes(key)) problem('', `Chave desconhecida "${key}" (use ${KEYS.join(', ')}).`);
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !ID.test(id)) problem('id', 'O id precisa ter 1 a 64 caracteres: letras, números, "-" e "_", começando por letra ou número.');
  const kind = own(raw, 'kind');
  if (typeof kind !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(kind)) problem('kind', `O tipo precisa ser um destes: ${SOURCE_KINDS.join(', ')}.`);
  const diagram = own(raw, 'diagram');
  if (typeof diagram !== 'string' || !SLUG.test(diagram)) problem('diagram', 'O diagrama precisa ser o slug de um diagrama do workspace (letras, números, "-" e "_").');
  const modeRaw = own(raw, 'mode');
  if (modeRaw !== undefined && (typeof modeRaw !== 'string' || !(SOURCE_MODES as readonly string[]).includes(modeRaw))) problem('mode', `O modo precisa ser ${SOURCE_MODES.join(' ou ')}.`);
  const include = own(raw, 'include');
  if (!Array.isArray(include) || include.length === 0) problem('include', 'Informe ao menos um padrão em include (ex.: "infra/**/*.tf").');
  else if (include.length > MAX_INCLUDES) problem('include', `Use no máximo ${MAX_INCLUDES} padrões em include.`);
  else {
    include.forEach((pattern, i) => {
      const reason = typeof pattern === 'string' ? globProblem(pattern) : 'O padrão precisa ser um texto.';
      if (reason) problem(`include[${i}]`, reason);
    });
    if (include.every((pattern) => typeof pattern === 'string' && pattern.startsWith('!'))) problem('include', 'Inclua ao menos um padrão positivo (sem "!").');
  }
  if (diagnostics.length > before) return null;
  return { id: id as string, kind: kind as SourceKind, include: include as string[], diagram: diagram as string, mode: (modeRaw as SourceMode | undefined) ?? 'merge' };
}

/** Lenient: invalid entries are dropped and reported; callers treat any diagnostic as an error. A missing file (`null`) means no sources. */
export function parseSources(text: string | null): { sources: Source[]; diagnostics: SourceDiagnostic[] } {
  if (text === null) return { sources: [], diagnostics: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { sources: [], diagnostics: [{ path: '', message: `JSON inválido: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  if (!isRecord(raw)) return { sources: [], diagnostics: [{ path: '', message: 'O arquivo precisa ser um objeto com "version" e "sources".' }] };
  const diagnostics: SourceDiagnostic[] = [];
  for (const key of Object.keys(raw)) if (key !== 'version' && key !== 'sources' && key !== '$schema') diagnostics.push({ path: '', message: `Chave desconhecida "${key}" (use version e sources).` });
  if (raw.version !== SOURCES_VERSION) return { sources: [], diagnostics: [...diagnostics, { path: 'version', message: `Versão não suportada: use "version": ${SOURCES_VERSION}.` }] };
  const entries = own(raw, 'sources');
  if (!Array.isArray(entries)) return { sources: [], diagnostics: [...diagnostics, { path: 'sources', message: 'Faltou a lista "sources".' }] };
  if (entries.length > MAX_SOURCES) return { sources: [], diagnostics: [...diagnostics, { path: 'sources', message: `Use no máximo ${MAX_SOURCES} fontes.` }] };
  const sources: Source[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const source = parseSource(entry, index, diagnostics);
    if (!source) return;
    if (seen.has(source.id)) {
      diagnostics.push({ path: `sources[${index}].id`, message: `O id "${source.id}" já existe; cada fonte precisa de um id único.` });
      return;
    }
    seen.add(source.id);
    sources.push(source);
  });
  return { sources, diagnostics };
}

/** Canonical text (sorted keys, 2 spaces, final newline). */
export function printSources(sources: readonly Source[]): string {
  return stableStringify({
    version: SOURCES_VERSION,
    sources: sources.map(({ id, kind, include, diagram, mode }) => ({ id, kind, include, diagram, mode })),
  });
}

/** Checks the sources against the workspace: the target diagram must exist and one diagram has one mode. */
export function validateSourceTargets(sources: readonly Source[], diagrams: readonly string[]): SourceDiagnostic[] {
  const problems: SourceDiagnostic[] = [];
  const modes = new Map<string, SourceMode>();
  sources.forEach((source, index) => {
    if (!diagrams.includes(source.diagram)) {
      problems.push({ path: `sources[${index}].diagram`, message: `O diagrama "${source.diagram}" não existe no workspace (existentes: ${list(diagrams)}).` });
      return;
    }
    const mode = modes.get(source.diagram);
    if (mode === undefined) modes.set(source.diagram, source.mode);
    else if (mode !== source.mode) problems.push({ path: `sources[${index}].mode`, message: `O diagrama "${source.diagram}" já usa o modo ${mode} em outra fonte; misturar replace e merge no mesmo diagrama não é permitido.` });
  });
  return problems;
}

export const describeProblem = (problem: SourceDiagnostic): string => `${SOURCES_PATH}${problem.path ? `: ${problem.path}` : ''}: ${problem.message}`;
