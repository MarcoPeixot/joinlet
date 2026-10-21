import { CARDINALITIES, validTableFields, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, DIRECTIONS, RESERVED_NAME, SHAPES, STYLE_MODES, TYPEFACES, edgeId, emptyModel, isAncestor, own, suggest } from '@strukt/core';
import type { Connector, DiagramElement, DiagramModel, DiagramStyle, Diagnostic, EdgeEl, ID, Span } from '@strukt/core';
import { Scanner, locate, spanOf } from './scanner';

export interface DslDiagnostic extends Diagnostic {
  span: Span;
  line: number;
  column: number;
}

export interface ParseResult {
  model: DiagramModel;
  diagnostics: DslDiagnostic[];
}

/** Element properties in canonical (printer) order: Eraser first, Joinlet extensions last. */
export const ELEMENT_KEYS = [
  'presentation', 'layoutRole', 'fields', 'shape', 'icon', 'color', 'label', 'link', 'colorMode', 'styleMode', 'typeface', 'tech', 'description',
] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];
export const STYLE_KEYWORDS = ['direction', 'colorMode', 'styleMode', 'typeface'] as const;

const ENUMS: Partial<Record<ElementKey, readonly string[]>> = {
  presentation: PRESENTATIONS, layoutRole: LAYOUT_ROLES, shape: SHAPES, colorMode: COLOR_MODES, styleMode: STYLE_MODES, typeface: TYPEFACES,
};
const STYLE_VALUES: Record<keyof DiagramStyle, readonly string[]> = {
  direction: DIRECTIONS, colorMode: COLOR_MODES, styleMode: STYLE_MODES, typeface: TYPEFACES,
};
const STYLE_LINE = /^(direction|colorMode|styleMode|typeface)[ \t]+([A-Za-z]+)[ \t\r]*(?:\/\/.*)?$/;

interface Prop {
  key: string;
  value: string;
  keySpan: Span;
  valueSpan: Span;
}

interface Mention {
  name: ID;
  span: Span;
  props: Prop[];
  /** Already declared as a group (it had a `{ ... }` body). */
  declared: boolean;
}

class ParseError extends Error {
  constructor(readonly span: Span, message: string) {
    super(message);
  }
}

const hint = (value: string, candidates: readonly string[]) => {
  const [best] = suggest(value, candidates);
  return best ? ` Você quis dizer "${best}"?` : '';
};

class Parser {
  private readonly s: Scanner;
  private readonly model = emptyModel();
  private readonly diagnostics: DslDiagnostic[] = [];
  private readonly edgeIds = new Set<ID>();

  constructor(text: string) {
    this.s = new Scanner(text);
  }

  run(): ParseResult {
    this.body(undefined, spanOf(0, 0));
    this.model.diagnostics = this.diagnostics;
    return { model: this.model, diagnostics: this.diagnostics };
  }

  private report(severity: Diagnostic['severity'], span: Span, message: string): void {
    this.diagnostics.push({ severity, message, span, ...locate(this.s.text, span.from) });
  }

  private fail(span: Span, message: string): ParseError {
    return new ParseError(span, message);
  }

  /** Statements until EOF (top level) or the `}` that closes `parent`. */
  private body(parent: ID | undefined, open: Span): void {
    const s = this.s;
    for (;;) {
      if (s.atLineEnd() && s.eof) {
        if (parent !== undefined) this.report('error', open, `Falta fechar "}" do grupo "${parent}".`);
        return;
      }
      const ch = s.peek();
      if (ch === '\n' || ch === ',') {
        s.pos++;
        continue;
      }
      if (ch === '}') {
        s.pos++;
        if (parent !== undefined) return;
        this.report('error', spanOf(s.pos - 1, s.pos), 'Chave "}" sem grupo aberto.');
        continue;
      }
      try {
        this.statement(parent);
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        this.report('error', err.span, err.message);
        s.skipStatement();
      }
    }
  }

  private statement(parent: ID | undefined): void {
    const s = this.s;
    const start = s.pos;
    if (this.styleStatement()) return;
    const lists: Mention[][] = [this.list(parent)];
    const connectors: Connector[] = [];
    for (;;) {
      s.skipSpaces();
      const connector = this.connector();
      if (!connector) break;
      connectors.push(connector);
      lists.push(this.list(parent));
    }
    s.skipSpaces();
    let label = '';
    let edgeProps: Prop[] = [];
    if (s.peek() === ':') {
      if (!connectors.length) throw this.fail(spanOf(s.pos, s.pos + 1), 'Rótulo com ":" só é permitido em conexões.');
      s.pos++;
      label = this.label();
      s.skipSpaces();
      if (s.peek() === '[') edgeProps = this.props();
    }
    if (!s.atLineEnd() && s.peek() !== '}') {
      throw this.fail(spanOf(s.pos, s.pos + 1), `Texto inesperado: "${s.restOfLine().trim()}".`);
    }
    const span = spanOf(start, s.pos);
    for (const mention of lists.flat()) if (!mention.declared) this.declare(mention, parent, connectors.length ? 'mention' : 'declare');
    const color = this.edgeColor(edgeProps);
    const ports: Partial<Pick<EdgeEl, 'fromPort' | 'toPort' | 'fromCardinality' | 'toCardinality'>> = {};
    for (const prop of edgeProps) {
      if (prop.key === 'fromPort' || prop.key === 'toPort') {
        if ((PORTS as readonly string[]).includes(prop.value)) ports[prop.key] = prop.value as typeof PORTS[number];
        else this.report('warning', prop.valueSpan, `Porta inválida: "${prop.value}".`);
      } else if (prop.key === 'fromCardinality' || prop.key === 'toCardinality') {
        if ((CARDINALITIES as readonly string[]).includes(prop.value)) ports[prop.key] = prop.value as typeof CARDINALITIES[number];
        else this.report('warning', prop.valueSpan, `Cardinalidade inválida: "${prop.value}".`);
      }
    }
    connectors.forEach((connector, i) => {
      for (const from of lists[i]!) for (const to of lists[i + 1]!) this.connect(from.name, to.name, connector, label, color, span, ports);
    });
  }

  private styleStatement(): boolean {
    const match = STYLE_LINE.exec(this.s.restOfLine());
    if (!match) return false;
    const key = match[1] as keyof DiagramStyle;
    const value = match[2]!;
    const valueFrom = this.s.pos + match[0].indexOf(value, key.length);
    const allowed = STYLE_VALUES[key];
    if (allowed.includes(value)) Object.assign(this.model.style, { [key]: value });
    else this.report('warning', spanOf(valueFrom, valueFrom + value.length), `Valor inválido para ${key}: "${value}".${hint(value, allowed)}`);
    this.s.pos = valueFrom + value.length;
    return true;
  }

  private list(parent: ID | undefined): Mention[] {
    const s = this.s;
    const items = [this.item(parent)];
    for (;;) {
      s.skipSpaces();
      if (s.peek() !== ',') return items;
      s.pos++;
      if (s.atLineEnd() || s.peek() === '}') return items;
      items.push(this.item(parent));
    }
  }

  private item(parent: ID | undefined): Mention {
    const s = this.s;
    s.skipSpaces();
    const start = s.pos;
    const name = this.name();
    const span = spanOf(start, s.pos);
    s.skipSpaces();
    const props = s.peek() === '[' ? this.props() : [];
    s.skipSpaces();
    if (s.peek() !== '{') return { name, span, props, declared: false };
    const open = spanOf(s.pos, s.pos + 1);
    s.pos++;
    this.declare({ name, span, props, declared: false }, parent, 'group');
    this.body(name, open);
    return { name, span, props: [], declared: true };
  }

  private name(): ID {
    const s = this.s;
    const start = s.pos;
    let value: string;
    if (s.peek() === '"') {
      value = this.quoted();
    } else {
      while (!s.eof) {
        const c = s.peek();
        if ('[]{}<>,:"\n'.includes(c) || s.startsWith('//') || (c === '-' && this.hyphenBreaks(start))) break;
        s.pos++;
      }
      while (s.pos > start && /\s/.test(s.text[s.pos - 1]!)) s.pos--;
      value = s.text.slice(start, s.pos);
    }
    if (!value.trim()) throw this.fail(spanOf(start, s.pos + 1), 'Esperava um nome.');
    if (value.includes('\n')) throw this.fail(spanOf(start, s.pos), 'O nome não pode ter quebra de linha.');
    if (value === RESERVED_NAME) throw this.fail(spanOf(start, s.pos), `O nome "${value}" é reservado.`);
    return value;
  }

  /** `-` is part of a name (`k8s-api`) unless it starts `--`/`-->`/`->` or touches whitespace (`A - B`). */
  private hyphenBreaks(nameStart: number): boolean {
    const s = this.s;
    const next = s.peek(1);
    if (next === '-' || next === '>') return true;
    const prev = s.pos > nameStart ? s.text[s.pos - 1]! : ' ';
    return /\s/.test(prev) || next === '' || /\s/.test(next);
  }

  private quoted(): string {
    const s = this.s;
    const start = s.pos;
    s.pos++;
    let out = '';
    while (!s.eof && s.peek() !== '\n') {
      const c = s.peek();
      if (c === '"') {
        s.pos++;
        return out;
      }
      const next = s.peek(1);
      if (c === '\\' && (next === '"' || next === '\\' || next === 'n')) {
        out += next === 'n' ? '\n' : next;
        s.pos += 2;
        continue;
      }
      out += c;
      s.pos++;
    }
    throw this.fail(spanOf(start, s.pos), 'Aspas sem fechar.');
  }

  private connector(): Connector | null {
    const s = this.s;
    const take = (connector: Connector) => {
      s.pos += connector.length;
      return connector;
    };
    if (s.startsWith('<>')) return take('<>');
    if (s.startsWith('-->')) return take('-->');
    if (s.startsWith('->')) throw this.fail(spanOf(s.pos, s.pos + 2), 'Conector inválido "->". Use ">" ou "-->".');
    if (s.startsWith('--')) return take('--');
    if (s.peek() === '-') return take('-');
    if (s.peek() === '>') return take('>');
    if (s.peek() === '<') return take('<');
    return null;
  }

  private label(): string {
    const s = this.s;
    s.skipSpaces();
    if (s.peek() === '"') return this.quoted();
    const start = s.pos;
    while (!s.eof && !'\n[}'.includes(s.peek()) && !s.startsWith('//')) s.pos++;
    return s.text.slice(start, s.pos).trim();
  }

  private props(): Prop[] {
    const s = this.s;
    const open = spanOf(s.pos, s.pos + 1);
    s.pos++;
    const props: Prop[] = [];
    for (;;) {
      s.skipSpaces();
      if (s.peek() === ']') {
        s.pos++;
        return props;
      }
      if (s.eof || s.peek() === '\n') throw this.fail(open, 'Falta fechar "]".');
      if (s.peek() === ',') {
        s.pos++;
        continue;
      }
      const keyFrom = s.pos;
      while (!s.eof && /[A-Za-z0-9_-]/.test(s.peek())) s.pos++;
      const key = s.text.slice(keyFrom, s.pos);
      if (!key) throw this.fail(spanOf(s.pos, s.pos + 1), 'Esperava o nome de uma propriedade.');
      s.skipSpaces();
      if (s.peek() !== ':') throw this.fail(spanOf(keyFrom, s.pos), `Esperava ":" depois de "${key}".`);
      s.pos++;
      s.skipSpaces();
      const valueFrom = s.pos;
      let value: string;
      if (s.peek() === '"') {
        value = this.quoted();
      } else {
        while (!s.eof && !',]\n'.includes(s.peek())) s.pos++;
        value = s.text.slice(valueFrom, s.pos).trim();
      }
      props.push({ key, value, keySpan: spanOf(keyFrom, keyFrom + key.length), valueSpan: spanOf(valueFrom, s.pos) });
      s.skipSpaces();
      if (!s.eof && !',]\n'.includes(s.peek())) throw this.fail(spanOf(s.pos, s.pos + 1), 'Esperava "," ou "]".');
    }
  }

  /**
   * First mention creates the element (inside the enclosing group); later mentions merge props.
   * A declaration inside a group moves an existing element there (Eraser lists members after connections).
   */
  private declare(m: Mention, parent: ID | undefined, mode: 'group' | 'declare' | 'mention'): void {
    let el: DiagramElement | undefined = own(this.model.elements, m.name);
    if (!el) {
      el = mode === 'group' ? { kind: 'group', id: m.name, span: m.span } : { kind: 'node', id: m.name, span: m.span };
      if (parent !== undefined) el.parentId = parent;
      this.model.elements[m.name] = el;
      this.model.order.push(m.name);
    } else {
      if (mode === 'group' && el.kind === 'node') {
        const { shape, kind: _kind, ...rest } = el;
        if (shape) this.report('warning', m.span, `"${m.name}" virou grupo; a forma "${shape}" foi ignorada.`);
        el = { ...rest, kind: 'group' };
        this.model.elements[m.name] = el;
      }
      if (mode !== 'mention' && parent !== undefined && el.parentId !== parent) {
        if (parent === m.name || isAncestor(this.model, m.name, parent)) {
          this.report('error', m.span, `"${m.name}" não pode ficar dentro de si mesmo.`);
        } else {
          if (el.parentId) this.report('warning', m.span, `"${m.name}" estava em "${el.parentId}" e agora fica em "${parent}".`);
          el.parentId = parent;
        }
      }
    }
    this.applyProps(el, m.props);
  }

  private applyProps(el: DiagramElement, props: readonly Prop[]): void {
    const target = el as unknown as Record<string, unknown>;
    for (const prop of props) {
      if (!(ELEMENT_KEYS as readonly string[]).includes(prop.key)) {
        this.report('warning', prop.keySpan, `Propriedade desconhecida "${prop.key}".${hint(prop.key, ELEMENT_KEYS)}`);
        continue;
      }
      const key = prop.key as ElementKey;
      if (key === 'fields') {
        try {
          const fields: unknown = JSON.parse(prop.value);
          if (el.kind !== 'node' || !validTableFields(fields)) throw new Error('invalid');
          el.fields = fields;
        } catch { this.report('error', prop.valueSpan, 'Campos inválidos. Use uma lista JSON com name, type opcional e key PK/FK opcional.'); }
        continue;
      }
      if (key === 'shape' && el.kind === 'group') {
        this.report('warning', prop.keySpan, 'Grupos não têm forma; "shape" foi ignorado.');
        continue;
      }
      const allowed = ENUMS[key];
      if (allowed && !allowed.includes(prop.value)) {
        this.report('warning', prop.valueSpan, `Valor inválido para ${key}: "${prop.value}".${hint(prop.value, allowed)}`);
        continue;
      }
      if (prop.value === '') delete target[key];
      else target[key] = prop.value;
    }
  }

  private edgeColor(props: readonly Prop[]): string {
    let color = '';
    for (const prop of props) {
      if (prop.key === 'color') color = prop.value;
      else if (!['fromPort', 'toPort', 'fromCardinality', 'toCardinality'].includes(prop.key)) this.report('warning', prop.keySpan, `Propriedade desconhecida em conexão "${prop.key}".${hint(prop.key, ['color'])}`);
    }
    return color;
  }

  private connect(from: ID, to: ID, connector: Connector, label: string, color: string, span: Span, ports: Partial<Pick<EdgeEl, 'fromPort' | 'toPort' | 'fromCardinality' | 'toCardinality'>> = {}): void {
    if (from === to) {
      this.report('error', span, 'Uma conexão precisa ligar dois elementos diferentes.');
      return;
    }
    const id = edgeId(from, to, this.edgeIds);
    this.edgeIds.add(id);
    const edge: EdgeEl = { id, from, to, connector, span };
    if (label) edge.label = label;
    if (color) edge.color = color;
    Object.assign(edge, ports);
    this.model.edges.push(edge);
  }
}

/** Parses Eraser-compatible DSL. Always returns a model; `diagnostics` say whether it can be trusted. */
export function parseDsl(text: string): ParseResult {
  return new Parser(text).run();
}
