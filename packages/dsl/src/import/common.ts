import { applyOps, emptyModel } from '@strukt/core';
import type { Connector, DiagramModel, DiagramOp, Direction, Shape } from '@strukt/core';

export interface ImportDiagnostic { line: number; message: string }
export interface ImportResult { model: DiagramModel; diagnostics: ImportDiagnostic[] }

/** Input longer than this is refused outright (pasted text and repo files are untrusted). */
export const MAX_IMPORT = 2_000_000;
export const MAX_ELEMENTS = 2000;
export const MAX_EDGES = 5000;
const MAX_DIAGNOSTICS = 100;
const RESERVED = '__proto__';

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');

/** Drops control characters and caps the length; the model never stores line breaks in names. */
export function cleanText(text: string, max = 200): string {
  const clean = text.replace(CONTROL, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property read: `constructor`, `toString` and friends are ordinary keys in untrusted documents. */
export function pick(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

export function pickPath(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) current = pick(current, key);
  return current;
}

export function asArray(value: unknown, limit = 1000): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function tooBigResult(text: string): ImportResult | null {
  if (text.length <= MAX_IMPORT) return null;
  return { model: emptyModel(), diagnostics: [{ line: 1, message: `Entrada grande demais (limite de ${MAX_IMPORT.toLocaleString('pt-BR')} caracteres).` }] };
}

export function failure(message: string): ImportResult {
  return { model: emptyModel(), diagnostics: [{ line: 1, message }] };
}

export interface NodeProps { label?: string; shape?: Shape; icon?: string; tech?: string; color?: string; parentId?: string }
interface Item extends NodeProps { id: string; group: boolean }
export interface EdgeItem { from: string; to: string; connector: Connector; label?: string }

/** Collects elements and connections from an importer, then validates them through `applyOps` once. */
export class ModelBuilder {
  readonly diagnostics: ImportDiagnostic[] = [];
  direction: Direction | undefined;
  private readonly items = new Map<string, Item>();
  private readonly edges: EdgeItem[] = [];
  private readonly edgeKeys = new Set<string>();
  private readonly once = new Set<string>();
  private overflowed = false;
  private edgeCapHit = false;
  private silenced = false;

  warn(line: number, message: string): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) {
      if (!this.silenced) { this.silenced = true; this.diagnostics.push({ line, message: 'Muitos avisos: os demais foram omitidos.' }); }
      return;
    }
    this.diagnostics.push({ line, message });
  }

  /** One diagnostic per construct kind, with the line of its first occurrence. */
  warnOnce(kind: string, line: number, message: string): void {
    if (this.once.has(kind)) return;
    this.once.add(kind);
    this.warn(line, message);
  }

  /** True once the connection cap has refused an edge (and warned): callers may stop looking for more. */
  get edgesFull(): boolean { return this.edgeCapHit; }

  /** Names are canonical inside the builder (`cleanText`): every lookup accepts a raw name and cleans it the same way `add` does. */
  has(id: string): boolean { return this.items.has(cleanText(id)); }
  get size(): number { return this.items.size; }

  /** Creates the element, or merges missing props into the existing one. `null`: refused (empty/reserved name, or the element cap). */
  add(rawId: string, props: NodeProps = {}, line = 1): string | null {
    const id = cleanText(rawId);
    if (!id) return null;
    if (props.parentId !== undefined) props = { ...props, parentId: cleanText(props.parentId) === id ? undefined : cleanText(props.parentId) };
    if (id === RESERVED) { this.warnOnce('reserved', line, `O nome "${RESERVED}" é reservado e foi ignorado.`); return null; }
    const existing = this.items.get(id);
    if (existing) {
      for (const [key, value] of Object.entries(compactProps(props))) if (value && !existing[key as keyof NodeProps]) (existing as unknown as Record<string, unknown>)[key] = value;
      return id;
    }
    if (this.items.size >= MAX_ELEMENTS) {
      if (!this.overflowed) { this.overflowed = true; this.warn(line, `Limite de ${MAX_ELEMENTS} elementos atingido: o restante foi ignorado.`); }
      return null;
    }
    this.items.set(id, { id, group: false, ...compactProps(props) });
    return id;
  }

  /** Like `add`, but a taken id gets a numeric suffix (kept inside the length cap) instead of merging. */
  addUnique(rawId: string, props: NodeProps = {}, line = 1): string | null {
    let id = cleanText(rawId);
    if (!id) return null;
    for (let n = 2; this.items.has(id) && n < MAX_ELEMENTS + 3; n += 1) {
      const suffix = ` (${n})`;
      id = `${cleanText(rawId, 200 - suffix.length)}${suffix}`;
    }
    return this.items.has(id) ? null : this.add(id, props, line);
  }

  update(id: string, props: NodeProps): void {
    const item = this.items.get(cleanText(id));
    if (item) Object.assign(item, compactProps(props));
  }

  setGroup(id: string): void {
    const item = this.items.get(cleanText(id));
    if (item) item.group = true;
  }

  isGroup(id: string): boolean { return this.items.get(cleanText(id))?.group ?? false; }

  connect(rawFrom: string, rawTo: string, connector: Connector = '>', label?: string, line = 1): EdgeItem | null {
    const from = cleanText(rawFrom);
    const to = cleanText(rawTo);
    if (from === to) { this.warnOnce('self-edge', line, 'Conexão de um elemento para ele mesmo foi ignorada.'); return null; }
    if (!this.items.has(from) || !this.items.has(to)) return null;
    const key = `${from}\u0000${to}\u0000${connector}\u0000${label ?? ''}`;
    if (this.edgeKeys.has(key)) return null;
    if (this.edges.length >= MAX_EDGES) { this.edgeCapHit = true; this.warnOnce('edge-cap', line, `Limite de ${MAX_EDGES} conexões atingido: o restante foi ignorado.`); return null; }
    this.edgeKeys.add(key);
    const edge: EdgeItem = { from, to, connector, ...(label ? { label: cleanText(label) } : {}) };
    this.edges.push(edge);
    return edge;
  }

  build(): ImportResult {
    const ops: DiagramOp[] = [];
    if (this.direction) ops.push({ op: 'set_style', set: { direction: this.direction } });
    for (const item of this.items.values()) {
      if (item.parentId && !this.items.has(item.parentId)) delete item.parentId;
      ops.push(item.group
        ? { op: 'add_group', id: item.id, label: item.label, parentId: item.parentId, icon: item.icon, color: item.color }
        : { op: 'add_node', id: item.id, label: item.label, parentId: item.parentId, shape: item.shape, icon: item.icon, color: item.color, tech: item.tech });
    }
    for (const edge of this.edges) ops.push({ op: 'connect', ...edge });
    return { model: this.apply(ops), diagnostics: this.diagnostics };
  }

  private apply(ops: DiagramOp[]): DiagramModel {
    let pending = ops;
    for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
      replayStats.attempts += 1;
      try {
        const applied = applyOps(emptyModel(), pending);
        if (applied.ok) return applied.model;
        // One bad op must not lose the rest: drop it and retry (bounded, each retry re-validates the whole batch).
        const index = applied.error.opIndex;
        if (attempt === MAX_REPAIRS) {
          // Ops before the failing one are known valid: keep that prefix as the partial result.
          this.warn(1, 'Importação parcial: muitos itens inválidos.');
          const prefix = applyOps(emptyModel(), pending.slice(0, index));
          return prefix.ok ? prefix.model : emptyModel();
        }
        this.warn(1, `Item ignorado: ${applied.error.message}`);
        pending = pending.filter((_, i) => i !== index);
      } catch {
        this.warn(1, 'Item ignorado: operação inválida.');
        break;
      }
    }
    return emptyModel();
  }
}

/** Test-only: how many whole-batch `applyOps` attempts the builders ran (a single attempt when everything is valid). */
export const replayStats = { attempts: 0 };

const MAX_REPAIRS = 50;

function compactProps(props: NodeProps): NodeProps {
  const out: NodeProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === '') continue;
    (out as Record<string, unknown>)[key] = key === 'label' || key === 'tech' ? cleanText(String(value)) : value;
  }
  return out;
}
