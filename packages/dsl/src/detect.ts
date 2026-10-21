// Format sniffing, kept apart from the importers so the app can offer a conversion without loading them (or `yaml`).
export type ImportFormat = 'mermaid' | 'likec4' | 'structurizr' | 'd2' | 'terraform' | 'openapi' | 'kubernetes';

const EXTENSIONS: Record<string, ImportFormat> = { d2: 'd2', tf: 'terraform' };

/** The sniffer runs on every keystroke: it only ever looks at this much of the text. */
const SNIFF_HEAD = 20_000;

/**
 * Sniffs the format from the content; `fileName` breaks ties that content cannot (`.d2`, `.tf`). Only the head (plus the tail, for OpenAPI/Kubernetes) is inspected.
 * Line-anchored patterns use `[ \t]*`, never `\s*`: a whitespace quantifier that can span newlines is re-scanned from every
 * line start, which is quadratic on blank-line floods.
 */
export function detectImportFormat(text: string, fileName?: string): ImportFormat | null {
  const byExtension = fileName ? EXTENSIONS[fileName.split('.').pop()?.toLowerCase() ?? ''] : undefined;
  if (byExtension) return byExtension;
  const tailStart = Math.max(SNIFF_HEAD, text.length - SNIFF_HEAD);
  const tail = text.length > SNIFF_HEAD ? text.slice(text.indexOf('\n', tailStart) + 1 || tailStart) : '';
  if (text.length > SNIFF_HEAD) text = text.slice(0, SNIFF_HEAD);
  if (/^[ \t]*(?:flowchart|graph)[ \t]+(?:TB|TD|BT|LR|RL)\b/m.test(text)) return 'mermaid';
  if (/\bworkspace\s*\{/.test(text) && /\bsoftwareSystem\b|\bperson\b/.test(text)) return 'structurizr';
  if (/\bspecification\s*\{|\bviews\s*\{/.test(text) || likeC4Model(text)) return 'likec4';
  if (/^[ \t]*resource[ \t]+"[^"\n]+"[ \t]+"[^"\n]+"[ \t]*\{/m.test(text) || /^[ \t]*(?:provider|terraform)[ \t]+(?:"[^"\n]*"[ \t]*)?\{/m.test(text)) return 'terraform';
  const structured = structuredFormat(text);
  if (structured) return structured;
  if (/^[ \t]*[\w."'][^\n:]*?(?<![-=<>])(?:<->|->)(?![->])[ \t]*[\w."']/m.test(text)) return 'd2';
  return tail ? structuredFormat(tail) : null;
}

/** OpenAPI / Kubernetes markers; also looked up in the tail, since big manifests often carry `openapi:`/`kind:` last. */
function structuredFormat(text: string): ImportFormat | null {
  if (/(?:^|[{,])[ \t]*["']?(?:openapi|swagger)["']?[ \t]*:/m.test(text)) return 'openapi';
  if (/(?:^|[{,])[ \t]*["']?apiVersion["']?[ \t]*:/m.test(text) && /(?:^|[{,])[ \t]*["']?kind["']?[ \t]*:/m.test(text)) return 'kubernetes';
  return null;
}

/** `model { ... x = actor` — looks only past the first `model {`, since any later one would see a subset of the same text. */
function likeC4Model(text: string): boolean {
  const open = /\bmodel\s*\{/.exec(text);
  return open !== null && /=\s*(?:actor|system|service|component|app)\b/.test(text.slice(open.index + open[0].length));
}
