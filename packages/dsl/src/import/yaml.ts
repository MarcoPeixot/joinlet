import { parseAllDocuments } from 'yaml';
import type { ModelBuilder } from './common';

const MAX_DOCUMENTS = 2000;
const MAX_ALIASES = 100;
/** The YAML parser costs ~1-3 us per character (more on malformed input, which yields one error per character), so it only reads this much. */
const MAX_YAML = 250_000;
/** A document-boundary cut must keep at least this much; otherwise the line cut is used. */
const MIN_DOCUMENT_CUT = MAX_YAML / 4;

/**
 * Parses (multi-document) YAML or JSON in a safe mode: core schema only, no merge keys, alias expansion
 * capped, every failure turned into a diagnostic. Never throws.
 */
export function loadDocuments(text: string, b: ModelBuilder): unknown[] {
  const values: unknown[] = [];
  const json = parseJson(text);
  if (json !== undefined) return json === null ? values : [json];
  if (text.length > MAX_YAML) {
    const cut = cutPoint(text);
    text = text.slice(0, cut.at);
    b.warn(1, `Entrada YAML longa: só os primeiros ${MAX_YAML.toLocaleString('pt-BR')} caracteres foram lidos (corte no ${cut.byDocument ? 'último documento inteiro' : 'fim de linha'}).`);
  }
  try {
    const docs = parseAllDocuments(text, { schema: 'core', merge: false, uniqueKeys: false, prettyErrors: false, logLevel: 'silent', maxAliasCount: MAX_ALIASES } as Parameters<typeof parseAllDocuments>[1]);
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.length > MAX_DOCUMENTS) b.warn(1, `Documentos demais: só os primeiros ${MAX_DOCUMENTS} foram lidos.`);
    for (const doc of list.slice(0, MAX_DOCUMENTS)) {
      if (doc.errors.length) {
        const error = doc.errors[0]!;
        b.warn(error.linePos?.[0]?.line ?? 1, `YAML inválido ignorado: ${error.code === 'ALIAS_PROPS' || /alias/i.test(error.message) ? 'aliases em excesso ou inválidos' : 'erro de sintaxe'}.`);
        continue;
      }
      try {
        const value = doc.toJS({ maxAliasCount: MAX_ALIASES });
        if (value !== null && value !== undefined) values.push(value);
      } catch {
        b.warn(1, 'Documento YAML ignorado: aliases em excesso ou estrutura profunda demais.');
      }
    }
  } catch {
    b.warn(1, 'Não foi possível ler o YAML: estrutura inválida ou profunda demais.');
  }
  return values;
}

/**
 * Where to cut over-long YAML: the last `---` document marker within `MAX_YAML` when it keeps at least a quarter of the
 * limit (so an early marker cannot discard most of one huge document), else the last line boundary.
 */
function cutPoint(text: string): { at: number; byDocument: boolean } {
  for (let at = text.lastIndexOf('\n---', MAX_YAML); at >= MIN_DOCUMENT_CUT; at = text.lastIndexOf('\n---', at - 1)) {
    const after = text[at + 4];
    if (after === undefined || after === '\n' || after === '\r' || after === ' ' || after === '\t') return { at, byDocument: true };
  }
  const line = text.lastIndexOf('\n', MAX_YAML);
  return { at: line > 0 ? line : MAX_YAML, byDocument: false };
}

/** Native fast path for a document that is valid JSON of any size (the YAML parser is far slower); `undefined` when it is not. */
function parseJson(text: string): unknown {
  if (text.length <= MAX_YAML) return undefined;
  const head = text.trimStart()[0];
  if (head !== '{' && head !== '[') return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}
