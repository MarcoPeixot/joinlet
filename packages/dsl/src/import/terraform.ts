import { ModelBuilder, tooBigResult } from './common';
import type { ImportResult } from './common';

const MAX_STRING_DEPTH = 200;

const ICONS: [RegExp, string][] = [
  [/^aws_(instance|launch_|autoscaling_)/, 'aws-ec2'],
  [/^aws_(db_instance|rds_)/, 'aws-rds'],
  [/^aws_s3_bucket/, 'aws-s3'],
  [/^aws_lambda_function/, 'aws-lambda'],
  [/^aws_dynamodb_table/, 'aws-dynamodb'],
  [/^aws_sqs_queue/, 'aws-sqs'],
  [/^aws_sns_topic/, 'aws-sns'],
  [/^aws_(api_gateway_|apigatewayv2_)/, 'aws-api-gateway'],
  [/^aws_/, 'aws'],
  [/^google_/, 'gcp'],
  [/^azurerm_/, 'microsoft-azure'],
  [/^kubernetes_/, 'kubernetes'],
  [/^docker_/, 'docker'],
];
const STORE = /(db_instance|rds_|_bucket|dynamodb_table|sql_|storage_account|redis|elasticache|_database)/;

/**
 * Blanks comments, string literals and heredoc bodies (same length, newlines kept) so brace counting and
 * reference scanning see code only. `${...}` interpolations stay: they are real references.
 */
function scrub(text: string, b: ModelBuilder): string {
  const out = text.split('');
  const n = text.length;
  const stack: number[] = []; // 0 = string, k > 0 = interpolation at brace depth k
  const blank = (from: number, to: number) => { for (let k = from; k < to && k < n; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  const line = (index: number) => text.slice(0, index).split('\n').length;
  for (let i = 0; i < n; i += 1) {
    const c = text[i]!;
    const top = stack.length ? stack[stack.length - 1]! : -1;
    if (top === 0) {
      if (c === '\\') { blank(i, i + 2); i += 1; }
      else if (c === '"') stack.pop();
      else if ((c === '$' || c === '%') && text[i + 1] === '{') { stack.push(1); i += 1; }
      else if (c === '\n') stack.pop();
      else out[i] = ' ';
      continue;
    }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop - 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) b.warn(line(i), 'Comentário /* não terminado.');
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop - 1;
    } else if (c === '"') {
      if (stack.length >= MAX_STRING_DEPTH) {
        b.warn(line(i), 'Interpolações aninhadas demais: o restante do arquivo foi ignorado.');
        blank(i, n);
        break;
      }
      stack.push(0);
    } else if (c === '<' && text[i + 1] === '<') {
      const head = /<<-?([A-Za-z_]\w*)[ \t]*\r?\n/y;
      head.lastIndex = i;
      const match = head.exec(text);
      if (!match) continue;
      let pos = i + match[0].length;
      let end = -1;
      while (pos <= n) {
        const eol = text.indexOf('\n', pos);
        const stop = eol < 0 ? n : eol;
        if (text.slice(pos, stop).trim() === match[1]) { end = stop; break; }
        if (eol < 0) break;
        pos = eol + 1;
      }
      if (end < 0) b.warn(line(i), `Heredoc "${match[1]}" não terminado.`);
      blank(i, end < 0 ? n : end);
      i = (end < 0 ? n : end) - 1;
    } else if (top > 0) {
      if (c === '{') stack[stack.length - 1] = top + 1;
      else if (c === '}') { if (top === 1) stack.pop(); else stack[stack.length - 1] = top - 1; }
    }
  }
  return out.join('');
}

/** For every `{` its matching `}` (or the end of text when it never closes). */
function matchBraces(code: string, b: ModelBuilder, lineOf: (i: number) => number): Map<number, number> {
  const close = new Map<number, number>();
  const open: number[] = [];
  let stray = false;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '{') open.push(i);
    else if (c === '}') {
      const start = open.pop();
      if (start === undefined) { if (!stray) { stray = true; b.warn(lineOf(i), 'Chave "}" sem abertura correspondente.'); } }
      else close.set(start, i);
    }
  }
  for (const start of open) { close.set(start, code.length); b.warnOnce('unbalanced', lineOf(start), 'Chaves desbalanceadas: um bloco não foi fechado.'); }
  return close;
}

export function providerIcon(type: string): string | undefined {
  return ICONS.find(([pattern]) => pattern.test(type))?.[1];
}

export function importTerraform(text: string): ImportResult {
  const big = tooBigResult(text);
  if (big) return big;
  const b = new ModelBuilder();
  try {
    run(text, b);
  } catch {
    b.warn(1, 'Não foi possível ler o arquivo Terraform por completo.');
  }
  return b.build();
}

function run(text: string, b: ModelBuilder): void {
  const newlines: number[] = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) newlines.push(i);
  const lineOf = (index: number): number => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (newlines[mid]! < index) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
  const code = scrub(text, b);
  const close = matchBraces(code, b, lineOf);
  const n = code.length;
  const resources: { id: string; body: string; original: string; start: number; line: number }[] = [];

  const skipLine = (from: number): number => {
    const eol = code.indexOf('\n', from);
    const stop = eol < 0 ? n : eol;
    let brace = -1; // searched on this line only: an unbounded indexOf rescans the rest of the file for every line
    for (let k = from; k < stop; k += 1) if (code[k] === '{') { brace = k; break; }
    return brace >= 0 ? Math.min((close.get(brace) ?? n) + 1, n) : stop + 1;
  };

  let i = 0;
  while (i < n) {
    const c = code[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i += 1; continue; }
    if (c === '{') { i = Math.min((close.get(i) ?? n) + 1, n); continue; }
    const ident = /[A-Za-z_][\w-]*/y;
    ident.lastIndex = i;
    const head = ident.exec(code);
    if (!head) { i = skipLine(i); continue; }
    const keyword = head[0];
    let j = i + keyword.length;
    const labels: string[] = [];
    for (;;) {
      while (code[j] === ' ' || code[j] === '\t') j += 1;
      if (code[j] === '"') {
        const end = code.indexOf('"', j + 1);
        if (end < 0 || code.slice(j, end).includes('\n')) break;
        labels.push(text.slice(j + 1, end));
        j = end + 1;
      } else break;
    }
    if (code[j] !== '{') { i = skipLine(j); continue; }
    const closeAt = close.get(j) ?? n;
    const line = lineOf(i);
    if (keyword === 'resource') {
      if (labels.length < 2) b.warnOnce('resource-labels', line, 'Bloco "resource" sem tipo e nome foi ignorado.');
      else if (labels[0] === '__proto__' || labels[1] === '__proto__') b.warnOnce('reserved', line, 'O nome "__proto__" é reservado e foi ignorado.');
      else {
        const id = `${labels[0]}.${labels[1]}`;
        if (b.has(id)) b.warn(line, `Recurso "${id}" duplicado: o segundo foi ignorado.`);
        else resources.push({ id, body: code.slice(j + 1, closeAt), original: text.slice(j + 1, closeAt), start: j + 1, line });
      }
    } else if (keyword === 'module' || keyword === 'data') {
      b.warnOnce(`block:${keyword}`, line, `Bloco Terraform "${keyword}" ignorado.`);
    }
    i = Math.min(closeAt + 1, n);
  }

  for (const resource of resources) {
    const [type] = resource.id.split('.', 1) as [string];
    const tagged = nameTag(resource, close);
    const icon = providerIcon(type);
    b.add(resource.id, {
      label: tagged ?? resource.id, tech: type, ...(icon ? { icon } : {}), ...(STORE.test(type) ? { shape: 'cylinder' as const } : {}),
    }, resource.line);
    if (/^[ \t]*count[ \t]*=/m.test(resource.body)) b.warnOnce('count', resource.line, 'Meta-argumento "count" ignorado: o recurso aparece uma vez.');
    if (/^[ \t]*for_each[ \t]*=/m.test(resource.body)) b.warnOnce('for_each', resource.line, 'Meta-argumento "for_each" ignorado: o recurso aparece uma vez.');
    if (/^[ \t]*dynamic[ \t]+"/m.test(resource.body)) b.warnOnce('dynamic', resource.line, 'Bloco "dynamic" ignorado.');
  }

  const reference = /(?<![\w.-])([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)/g;
  for (const resource of resources) {
    if (!b.has(resource.id)) continue;
    for (const match of resource.body.matchAll(reference)) {
      const target = `${match[1]}.${match[2]}`;
      if (target !== resource.id && b.has(target)) b.connect(resource.id, target, '>', undefined, resource.line);
    }
  }
}

/** The `Name = "..."` entry of the resource's own top-level `tags` block, when it is a plain literal. */
function nameTag(resource: { body: string; original: string; start: number }, close: Map<number, number>): string | undefined {
  const { body, original } = resource;
  const tags = /\btags\b[ \t]*=?[ \t]*\{/g;
  let depth = 0;
  let pos = 0;
  for (let match = tags.exec(body); match; match = tags.exec(body)) {
    for (; pos < match.index; pos += 1) { const c = body[pos]; if (c === '{') depth += 1; else if (c === '}') depth -= 1; }
    if (depth !== 0) continue;
    const open = match.index + match[0].length - 1;
    const end = (close.get(resource.start + open) ?? resource.start + body.length) - resource.start;
    const inner = body.slice(open + 1, end);
    const name = /\bName[ \t]*=[ \t]*"/.exec(inner);
    if (!name) return undefined;
    const from = open + 1 + name.index + name[0].length;
    const stop = body.indexOf('"', from);
    if (stop < 0 || stop > end) return undefined;
    const value = original.slice(from, stop).trim();
    return value && value.length <= 80 && !value.includes('${') ? value : undefined;
  }
  return undefined;
}
