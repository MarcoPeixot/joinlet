import { uiText } from '../i18n';
import { applyOps, own, sharedParent, suggest, topLevel } from '@strukt/core';
import type { DiagramModel, DiagramOp, EdgeEl, ID, Shape } from '@strukt/core';

export type OfflineResult = { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string };

export const OFFLINE_HELP =
  uiText("No modo offline eu entendo: \"adicione X [entre A e B]\", \"conecte A a B\", \"remova X\", \"renomeie A para B\" e \"agrupe A, B em G\".");

/** Words in a new element's name → icon the registry resolves (checked in offline.test.ts). */
export const ICON_GUESSES: Record<string, string> = {
  redis: 'redis', kafka: 'kafka', postgres: 'postgresql', postgresql: 'postgresql', mysql: 'mysql', mongo: 'mongodb',
  mongodb: 'mongodb', rabbitmq: 'rabbitmq', nginx: 'nginx', elasticsearch: 'elasticsearch', docker: 'docker',
  kubernetes: 'kubernetes', k8s: 'kubernetes', react: 'react', stripe: 'stripe', graphql: 'graphql',
  s3: 'aws-s3', sqs: 'aws-sqs', lambda: 'aws-lambda',
};

type Clause = { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string };

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const unquote = (text: string) => text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
const quoted = (id: ID) => `"${id}"`;
const LEADING = /^(?:(?:o|a|os|as|um|uma|ao|à|no|na|the|an)\s+)?(?:(?:nó|no|serviço|servico|componente|elemento|node|service|component|element)\s+)?(.+)$/iu;

/** Name for a new element: drops a leading article/noun ("um nó Cache" → "Cache"). */
function newName(raw: string): string {
  const text = unquote(raw);
  return unquote(LEADING.exec(text)?.[1] ?? text);
}

/** Existing element by id, case/accent-insensitive id, or label; tolerates a leading article. */
function resolve(model: DiagramModel, raw: string): ID | undefined {
  for (const candidate of new Set([unquote(raw), newName(raw)])) {
    if (!candidate) continue;
    if (Object.hasOwn(model.elements, candidate)) return candidate;
    const key = fold(candidate);
    const hit = model.order.find((id) => fold(id) === key) ?? model.order.find((id) => fold(model.elements[id]?.label ?? '') === key);
    if (hit) return hit;
  }
  return undefined;
}

function notFound(model: DiagramModel, raw: string): Clause {
  const name = newName(raw);
  const [hint] = suggest(name, model.order);
  return { ok: false, error: uiText("Não encontrei {0} no diagrama.{1}", [quoted(name), hint ? uiText(" Você quis dizer {0}?", [quoted(hint)]) : '']) };
}

/** Splits "A <sep> B" at the first separator where both sides are existing elements (names may contain the separator). */
function pair(model: DiagramModel, text: string, separator: RegExp): [ID, ID] | Clause {
  const matches = [...text.matchAll(separator)];
  for (const match of matches) {
    const a = resolve(model, text.slice(0, match.index));
    const b = resolve(model, text.slice(match.index + match[0].length));
    if (a && b) return [a, b];
  }
  const first = matches[0];
  if (!first) return { ok: false, error: uiText("Diga os dois elementos, como em \"A e B\". {0}", [OFFLINE_HELP]) };
  const left = text.slice(0, first.index);
  return notFound(model, resolve(model, left) ? text.slice(first.index + first[0].length) : left);
}

/** Members list "A, B e C": every item must exist. */
function members(model: DiagramModel, text: string): ID[] | Clause {
  const ids: ID[] = [];
  for (const part of text.split(/\s*,\s*|\s+(?:e|and)\s+/iu).filter((p) => p.trim())) {
    const id = resolve(model, part);
    if (!id) return notFound(model, part);
    ids.push(id);
  }
  return ids;
}

const edgeBetween = (model: DiagramModel, a: ID, b: ID): EdgeEl | undefined => model.edges.find((e) => e.from === a && e.to === b);

function guessIcon(name: string): string | undefined {
  for (const word of fold(name).split(/[^a-z0-9]+/)) {
    const icon = own(ICON_GUESSES, word);
    if (icon) return icon;
  }
  return undefined;
}

function guessShape(name: string): Shape | undefined {
  return /\b(banco|db|database|bd)\b/.test(fold(name)) ? 'cylinder' : undefined;
}

function add(model: DiagramModel, rest: string): Clause {
  const between = /^(.+?)\s+(?:entre|between)\s+(.+)$/iu.exec(rest);
  const name = newName(between ? between[1]! : rest);
  if (!name) return { ok: false, error: uiText("Diga o nome do elemento. {0}", [OFFLINE_HELP]) };
  const existing = resolve(model, name);
  const icon = guessIcon(name);
  if (!between) {
    if (existing) return { ok: false, error: uiText("{0} já existe no diagrama.", [quoted(existing)]) };
    return { ok: true, ops: [{ op: 'add_node', id: name, icon, shape: guessShape(name) }], summary: uiText("Adicionei {0}.", [quoted(name)]) };
  }
  const ends = pair(model, between[2]!, /\s+(?:e|and)\s+/giu);
  if (!Array.isArray(ends)) return ends;
  const [a, b] = ends;
  const summary = uiText("Adicionei {0} entre {1} e {2}.", [quoted(existing ?? name), quoted(a), quoted(b)]);
  const direct = edgeBetween(model, a, b);
  const reverse = edgeBetween(model, b, a);
  if (existing) {
    // Reuse the element that is already there: route the connection through it.
    const edge = direct ?? reverse;
    const [from, to] = edge === reverse && reverse ? [b, a] : [a, b];
    const ops: DiagramOp[] = edge ? [{ op: 'remove_edge', edgeId: edge.id }] : [];
    ops.push(
      { op: 'connect', from, to: existing, connector: edge?.connector, label: edge?.label, color: edge?.color },
      { op: 'connect', from: existing, to, connector: edge?.connector, color: edge?.color },
    );
    return { ok: true, ops, summary };
  }
  if (direct) return { ok: true, ops: [{ op: 'insert_between', from: a, to: b, node: { id: name, icon } }], summary };
  if (reverse) return { ok: true, ops: [{ op: 'insert_between', from: b, to: a, node: { id: name, icon } }], summary };
  return {
    ok: true,
    ops: [
      { op: 'add_node', id: name, icon, shape: guessShape(name), parentId: sharedParent(model, [a, b]) },
      { op: 'connect', from: a, to: name },
      { op: 'connect', from: name, to: b },
    ],
    summary,
  };
}

function connect(model: DiagramModel, rest: string): Clause {
  const ends = pair(model, rest, /\s+(?:a|ao|à|com|para|até|e|to|with|and)\s+/giu);
  if (!Array.isArray(ends)) return ends;
  const [a, b] = ends;
  if (a === b) return { ok: false, error: uiText("Uma conexão precisa ligar dois elementos diferentes.") };
  if (edgeBetween(model, a, b)) return { ok: false, error: uiText("{0} já está conectado a {1}.", [quoted(a), quoted(b)]) };
  return { ok: true, ops: [{ op: 'connect', from: a, to: b }], summary: uiText("Conectei {0} a {1}.", [quoted(a), quoted(b)]) };
}

function remove(model: DiagramModel, rest: string): Clause {
  const link = /^(?:a\s+)?(?:conex[aã]o|liga[cç][aã]o|seta)\s+(?:entre|de|do|da)\s+(.+)$/iu.exec(rest);
  if (link) {
    const ends = pair(model, link[1]!, /\s+(?:e|para|a|ao|até|com|and|to|with)\s+/giu);
    if (!Array.isArray(ends)) return ends;
    const [a, b] = ends;
    const edge = edgeBetween(model, a, b) ?? edgeBetween(model, b, a);
    if (!edge) return { ok: false, error: uiText("Não há conexão entre {0} e {1}.", [quoted(a), quoted(b)]) };
    return { ok: true, ops: [{ op: 'remove_edge', edgeId: edge.id }], summary: uiText("Removi a conexão de {0} para {1}.", [quoted(edge.from), quoted(edge.to)]) };
  }
  const single = resolve(model, rest);
  const ids = single ? [single] : members(model, rest);
  if (!Array.isArray(ids)) return ids;
  const targets = topLevel(model, ids);
  return {
    ok: true,
    ops: targets.map((id) => ({ op: 'remove', id })),
    summary: uiText("Removi {0}.", [targets.map(quoted).join(', ').replace(/, ([^,]*)$/, ' e $1')]),
  };
}

type Options = {
  /** A shared (collaboration) session: ids are the room's merge key, so "renomeie" writes the label. */
  keepIds?: boolean;
};

function rename(model: DiagramModel, rest: string, options: Options): Clause {
  for (const match of rest.matchAll(/\s+(?:para|como|to|as)\s+/giu)) {
    const id = resolve(model, rest.slice(0, match.index));
    if (!id) continue;
    const to = unquote(rest.slice(match.index + match[0].length));
    if (!to) break;
    if (Object.hasOwn(model.elements, to) && to !== id) return { ok: false, error: uiText("Já existe um elemento chamado {0}.", [quoted(to)]) };
    const op: DiagramOp = options.keepIds ? { op: 'update', id, set: { label: to === id ? null : to } } : { op: 'rename', id, to };
    return { ok: true, ops: [op], summary: uiText("Renomeei {0} para {1}.", [quoted(id), quoted(to)]) };
  }
  return notFound(model, rest.split(/\s+(?:para|como|to|as)\s+/iu)[0] ?? rest);
}

function group(model: DiagramModel, rest: string): Clause {
  const splits = [...rest.matchAll(/\s+(?:em|no|na|dentro\s+de|in|into)\s+(?:(?:um|o)\s+)?(?:(?:grupo|group)\s+)?/giu)].reverse();
  for (const match of splits) {
    const ids = members(model, rest.slice(0, match.index));
    if (!Array.isArray(ids)) continue;
    const name = newName(rest.slice(match.index + match[0].length));
    if (!name) break;
    const existing = resolve(model, name);
    if (existing && model.elements[existing]?.kind !== 'group') return { ok: false, error: uiText("{0} não é um grupo.", [quoted(existing)]) };
    const target = existing ?? name;
    const moving = topLevel(model, ids).filter((id) => id !== target && model.elements[id]?.parentId !== target);
    const ops: DiagramOp[] = existing ? [] : [{ op: 'add_group', id: name, parentId: sharedParent(model, moving) }];
    for (const id of moving) ops.push({ op: 'move_to_group', id, parentId: target });
    return { ok: true, ops, summary: uiText("Agrupei {0} em {1}.", [moving.map(quoted).join(', ').replace(/, ([^,]*)$/, ' e $1'), quoted(target)]) };
  }
  const list = members(model, rest.replace(/\s+(?:em|no|na|dentro\s+de|in|into)\s+.*$/iu, ''));
  return Array.isArray(list) ? { ok: false, error: uiText("Diga o grupo, como em \"agrupe A, B em G\". {0}", [OFFLINE_HELP]) } : list;
}

const VERBS: [RegExp, (model: DiagramModel, rest: string, options: Options) => Clause][] = [
  [/^(?:adicion(?:e|ar|a)|acrescent(?:e|ar|a)|inclu(?:a|ir|i)|cri(?:e|ar|a)|coloqu(?:e)|colocar|add|create|insert)\s+(.+)$/iu, add],
  [/^(?:conect(?:e|ar|a)|lig(?:ue|ar|a)|connect|link)\s+(.+)$/iu, connect],
  [/^(?:remov(?:a|er|e)|apag(?:ue|ar|a)|exclu(?:a|ir|i)|delet(?:e|ar|a)|tir(?:e|ar|a)|remove|delete)\s+(.+)$/iu, remove],
  [/^(?:renome(?:ie|ar|ia)|rename)\s+(.+)$/iu, rename],
  [/^(?:agrup(?:e|ar|a)|group)\s+(.+)$/iu, group],
];

/**
 * Rule-based pt-BR fallback for when the AI server is off or has no key (spec §10). Same output as the
 * AI (DiagramOp[] + summary), so the preview/apply path is identical. Clauses split on ";" or new lines.
 */
export function interpretOffline(instruction: string, model: DiagramModel, options: Options = {}): OfflineResult {
  const clauses = instruction.split(/[;\n]+/).map((c) => c.trim().replace(/^(?:por favor|please),?\s*/iu, '').replace(/[.!]+$/, '').trim()).filter(Boolean);
  if (!clauses.length) return { ok: false, error: uiText("Descreva a mudança. {0}", [OFFLINE_HELP]) };
  let current = model;
  const ops: DiagramOp[] = [];
  const summary: string[] = [];
  for (const clause of clauses) {
    const rule = VERBS.find(([pattern]) => pattern.test(clause));
    if (!rule) return { ok: false, error: uiText("Não entendi \"{0}\". {1}", [clause, OFFLINE_HELP]) };
    const [pattern, handle] = rule;
    const result = handle(current, pattern.exec(clause)![1]!, options);
    if (!result.ok) return result;
    const applied = applyOps(current, result.ops);
    if (!applied.ok) return { ok: false, error: applied.error.message };
    current = applied.model;
    ops.push(...result.ops);
    summary.push(result.summary);
  }
  // Each clause was checked on its own result; edge ids can differ inside one combined batch, so check it whole.
  const whole = applyOps(model, ops);
  if (!whole.ok) return { ok: false, error: uiText("Não consegui juntar as instruções num lote só ({0}). Envie uma de cada vez.", [whole.error.message]) };
  return { ok: true, ops, summary: summary.join(' ') };
}
