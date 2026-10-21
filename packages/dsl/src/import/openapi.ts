import { ModelBuilder, asArray, asString, cleanText, failure, isRecord, pick, tooBigResult } from './common';
import type { ImportResult } from './common';
import { loadDocuments } from './yaml';

const MAX_OPERATIONS = 200;
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const SCAN_BUDGET = 200_000;
const SCAN_DEPTH = 60;

/** True when the document has a `$ref` that is not a local `#/...` pointer. Bounded walk, no recursion. */
function hasExternalRef(root: unknown): boolean {
  const stack: [unknown, number][] = [[root, 0]];
  let seen = 0;
  while (stack.length && seen < SCAN_BUDGET) {
    const [value, depth] = stack.pop()!;
    seen += 1;
    if (depth > SCAN_DEPTH || typeof value !== 'object' || value === null) continue;
    if (isRecord(value)) {
      const ref = pick(value, '$ref');
      if (typeof ref === 'string' && !ref.startsWith('#')) return true;
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
    } else if (Array.isArray(value)) for (const child of value) stack.push([child, depth + 1]);
  }
  return false;
}

/** First non-parameter path segment: `/pedidos/{id}` -> `pedidos`. */
function prefixOf(path: string): string {
  return path.split('/').find((segment) => segment && !segment.startsWith('{')) ?? 'raiz';
}

export function importOpenApi(text: string): ImportResult {
  const big = tooBigResult(text);
  if (big) return big;
  const b = new ModelBuilder();
  try {
    const doc = loadDocuments(text, b)[0];
    if (!isRecord(doc) || (pick(doc, 'openapi') === undefined && pick(doc, 'swagger') === undefined) || !isRecord(pick(doc, 'paths'))) {
      if (!b.diagnostics.length) return failure('O texto não parece um documento OpenAPI (faltam "openapi" e "paths").');
      return { model: b.build().model, diagnostics: b.diagnostics };
    }
    run(doc, b);
  } catch {
    b.warn(1, 'Não foi possível ler o documento OpenAPI por completo.');
  }
  return b.build();
}

function run(doc: Record<string, unknown>, b: ModelBuilder): void {
  const title = asString(pick(pick(doc, 'info'), 'title'));
  const service = b.addUnique(title ?? 'API', { label: title ? cleanText(title) : 'API' }) ?? b.addUnique('API', { label: 'API' });
  if (service) b.setGroup(service);
  if (pick(doc, 'servers') !== undefined || pick(doc, 'host') !== undefined) b.warn(1, 'Bloco "servers" ignorado: o diagrama não guarda endereços.');
  if (hasExternalRef(doc)) b.warn(1, 'Referência externa ($ref) ignorada: nenhum acesso à rede é feito.');

  const paths = pick(doc, 'paths') as Record<string, unknown>;
  const groups = new Map<string, string | null>();
  let count = 0;
  let skipped = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith('/')) { b.warnOnce('path', 1, `Caminho "${cleanText(path, 40)}" ignorado: deve começar com "/".`); continue; }
    if (!isRecord(item)) continue;
    for (const method of METHODS) {
      const operation = pick(item, method);
      if (operation === undefined) continue;
      if (count >= MAX_OPERATIONS) { skipped += 1; continue; }
      const tag = asArray(pick(operation, 'tags'), 5).map(asString).find(Boolean) ?? prefixOf(path);
      let group = groups.get(tag);
      if (group === undefined) {
        group = b.addUnique(tag, { label: cleanText(tag), ...(service ? { parentId: service } : {}) });
        if (group) b.setGroup(group);
        groups.set(tag, group);
      }
      const summary = asString(pick(operation, 'summary'));
      const id = b.addUnique(`${method.toUpperCase()} ${path}`, {
        label: `${method.toUpperCase()} ${path}`, ...(summary ? { tech: summary.slice(0, 80) } : {}), ...(group ?? service ? { parentId: (group ?? service)! } : {}),
      });
      if (id) count += 1;
    }
  }
  if (skipped) b.warn(1, `Limite de ${MAX_OPERATIONS} operações atingido: ${skipped} operações foram ignoradas.`);
}
