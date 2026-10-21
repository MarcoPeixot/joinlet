import { readdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { emptyModel } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { importArchitecture } from '@strukt/dsl/import';
import type { ImportFormat, ImportResult } from '@strukt/dsl/import';
import { exceedsDriftBytes } from './evidence';
import { expandBraces, globPrefix, matchesInclude } from './sources';
import type { Source, SourceKind } from './sources';
import { unionModels } from './syncMerge';
import { readRepositoryFile } from './health';

/** Folders a source never walks into: VCS data, dependencies, Terraform's cache and the workspace itself. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['.git', 'node_modules', '.arch', '.terraform']);

export interface CollectLimits {
  /** Directory entries looked at while walking. */
  entries: number;
  /** Files one source may match. */
  files: number;
}

export const COLLECT_LIMITS: CollectLimits = { entries: 50_000, files: 500 };
/** Same ceiling as the importers: pasted text and repository files are untrusted. */
const MAX_TOTAL_CHARS = 2_000_000;
const MAX_DIAGNOSTICS = 20;

const within = (root: string, path: string) => path === root || path.startsWith(root + sep);

/**
 * Repository files (posix paths relative to `root`, sorted) that `include` selects. The walk starts at the static
 * prefix of each pattern, never follows symlinks, skips `SKIPPED_DIRECTORIES` and stops with an error past the limits
 * instead of silently truncating.
 */
export async function collectSourceFiles(root: string, include: readonly string[], limits: CollectLimits = COLLECT_LIMITS): Promise<{ files: string[] } | { error: string }> {
  const realRoot = await realpath(root);
  const found = new Set<string>();
  let visited = 0;
  const positives = include.filter((pattern) => !pattern.startsWith('!')).flatMap((pattern) => expandBraces(pattern));

  const walk = async (dir: string, below: string[], prefix: string[], remaining: number, globstar: boolean): Promise<string | null> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++visited > limits.entries) return `O varrimento passou de ${limits.entries.toLocaleString('pt-BR')} entradas; restrinja os padrões de include.`;
      if (entry.isSymbolicLink()) continue;
      const level = below.length + 1;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (!globstar && level >= remaining) continue;
        const error = await walk(join(dir, entry.name), [...below, entry.name], prefix, remaining, globstar);
        if (error) return error;
      } else if (entry.isFile()) {
        if (!globstar && level > remaining) continue;
        const path = [...prefix, ...below, entry.name].join('/');
        if (!matchesInclude(include, path)) continue;
        found.add(path);
        if (found.size > limits.files) return `Mais de ${limits.files} arquivos casam com os padrões; restrinja o include.`;
      }
    }
    return null;
  };

  for (const pattern of positives) {
    const segments = pattern.split('/');
    const prefix = globPrefix(pattern);
    const start = join(realRoot, ...prefix);
    const real = await realpath(start).catch(() => null);
    if (!real || !within(realRoot, real)) continue;
    const error = await walk(real, [], prefix, segments.length - prefix.length, segments.includes('**'));
    if (error) return { error };
  }
  return { files: [...found].sort() };
}

/** Importers read one document; these kinds can be joined (a Terraform module is many files, one Kubernetes stream many manifests). */
const JOINED: Partial<Record<SourceKind, string>> = {
  terraform: '\n', d2: '\n', mermaid: '\n', likec4: '\n', structurizr: '\n', kubernetes: '\n---\n',
};

export interface SourceImport {
  source: Source;
  files: string[];
  model: DiagramModel;
  /** Importer notices, prefixed with `file:line` (capped). */
  warnings: string[];
  /** Blocks the sync of the diagram this source feeds. */
  error?: string;
}

export interface ImportDeps {
  importer?: (text: string, format: ImportFormat) => ImportResult;
  /** Test seam; defaults to the contained reader used by `check --drift`. */
  read?: (root: string, path: string) => Promise<string | null>;
}

const failed = (source: Source, files: string[], error: string, warnings: string[] = []): SourceImport => ({ source, files, model: emptyModel(), warnings, error });

const lineCount = (text: string) => text.split('\n').length;

function capped(warnings: string[]): string[] {
  return warnings.length > MAX_DIAGNOSTICS ? [...warnings.slice(0, MAX_DIAGNOSTICS), `… e mais ${warnings.length - MAX_DIAGNOSTICS} aviso(s) do importador.`] : warnings;
}

/** Reads the files of one source and runs the matching importer; never throws. */
export async function importSource(root: string, source: Source, deps: ImportDeps = {}): Promise<SourceImport> {
  const importer = deps.importer ?? importArchitecture;
  const read = deps.read ?? readRepositoryFile;
  const collected = await collectSourceFiles(root, source.include).catch((error: unknown) => ({ error: `Não consegui varrer o repositório: ${error instanceof Error ? error.message : String(error)}` }));
  if ('error' in collected) return failed(source, [], collected.error);
  const { files } = collected;
  if (!files.length) return failed(source, files, `Nenhum arquivo casa com ${source.include.map((pattern) => `"${pattern}"`).join(', ')}. Confira os padrões ou remova a fonte com "joinlet sources remove ${source.id}".`);
  const texts: string[] = [];
  let total = 0;
  for (const file of files) {
    const text = await read(root, file);
    if (text === null) return failed(source, files, `Não consegui ler "${file}" (ausente, grande demais, link simbólico ou fora do repositório).`);
    if (exceedsDriftBytes(text)) return failed(source, files, `"${file}" é grande demais para importar.`);
    total += text.length;
    if (total > MAX_TOTAL_CHARS) return failed(source, files, `Os arquivos da fonte somam mais de ${MAX_TOTAL_CHARS.toLocaleString('pt-BR')} caracteres; restrinja o include.`);
    texts.push(text);
  }

  const warnings: string[] = [];
  const models: DiagramModel[] = [];
  const separator = JOINED[source.kind];
  try {
    if (separator !== undefined) {
      const starts: { line: number; file: string }[] = [];
      let line = 1;
      files.forEach((file, index) => {
        starts.push({ line, file });
        line += lineCount(texts[index]!) + (separator === '\n' ? 0 : 1);
      });
      const result = importer(texts.join(separator), source.kind);
      for (const diagnostic of result.diagnostics) {
        const at = [...starts].reverse().find((start) => start.line <= diagnostic.line) ?? starts[0]!;
        warnings.push(`${at.file}:${Math.max(1, diagnostic.line - at.line + 1)}: ${diagnostic.message}`);
      }
      models.push(result.model);
      if (!result.model.order.length && result.diagnostics.length) return failed(source, files, `Não importei nada: ${result.diagnostics[0]!.message}`, capped(warnings));
    } else {
      files.forEach((file, index) => {
        const result = importer(texts[index]!, source.kind);
        for (const diagnostic of result.diagnostics) warnings.push(`${file}:${diagnostic.line}: ${diagnostic.message}`);
        if (!result.model.order.length && result.diagnostics.length) warnings.push(`${file}: nada foi importado deste arquivo.`);
        models.push(result.model);
      });
      if (models.every((model) => !model.order.length) && warnings.length) return failed(source, files, `Não importei nada: ${warnings[0]}`, capped(warnings));
    }
  } catch (error) {
    return failed(source, files, `O importador falhou: ${error instanceof Error ? error.message : String(error)}`, capped(warnings));
  }
  return { source, files, model: models.length === 1 ? models[0]! : unionModels(models), warnings: capped(warnings) };
}
