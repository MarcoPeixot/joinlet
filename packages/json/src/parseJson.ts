import type { Span } from '@strukt/core';

/** A parsed JSON value with the source span of every value and key (for line/column diagnostics). */
export type JsonNode =
  | { kind: 'object'; entries: JsonEntry[]; span: Span }
  | { kind: 'array'; items: JsonNode[]; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'number'; value: number; span: Span }
  | { kind: 'boolean'; value: boolean; span: Span }
  | { kind: 'null'; span: Span };

export interface JsonEntry {
  key: string;
  keySpan: Span;
  value: JsonNode;
}

export interface JsonParseResult {
  node: JsonNode | null;
  error: { message: string; index: number } | null;
  /** Keys repeated inside one object (the last value wins), for a warning. */
  duplicateKeys: { key: string; span: Span }[];
}

export const MAX_JSON_DEPTH = 64;

class JsonError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
  }
}

/** 1-based line/column of a character index. */
export function positionOf(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: Math.max(1, Math.min(index, text.length) - lineStart + 1) };
}

class Scanner {
  private i = 0;
  private readonly duplicates: { key: string; span: Span }[] = [];

  constructor(private readonly text: string) {}

  get index(): number {
    return this.i;
  }

  get duplicateKeys(): { key: string; span: Span }[] {
    return this.duplicates;
  }

  private fail(message: string, index = this.i): never {
    throw new JsonError(message, index);
  }

  private ws(): void {
    while (this.i < this.text.length) {
      const ch = this.text[this.i]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') this.i++;
      else return;
    }
  }

  private value(depth: number): JsonNode {
    this.ws();
    const start = this.i;
    const ch = this.text[this.i];
    if (ch === undefined) this.fail('O JSON termina antes do valor.', this.i);
    if (ch === '{') return this.object(depth);
    if (ch === '[') return this.array(depth);
    if (ch === '"') return { kind: 'string', value: this.string(), span: { from: start, to: this.i } };
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.number();
    if (this.text.startsWith('true', this.i)) {
      this.i += 4;
      return { kind: 'boolean', value: true, span: { from: start, to: this.i } };
    }
    if (this.text.startsWith('false', this.i)) {
      this.i += 5;
      return { kind: 'boolean', value: false, span: { from: start, to: this.i } };
    }
    if (this.text.startsWith('null', this.i)) {
      this.i += 4;
      return { kind: 'null', span: { from: start, to: this.i } };
    }
    this.fail(`Caractere inesperado "${ch}".`, this.i);
  }

  private object(depth: number): JsonNode {
    if (depth > MAX_JSON_DEPTH) this.fail('O JSON está aninhado demais.', this.i);
    const from = this.i;
    this.i++;
    const entries: JsonEntry[] = [];
    const seen = new Map<string, number>();
    this.ws();
    if (this.text[this.i] === '}') {
      this.i++;
      return { kind: 'object', entries, span: { from, to: this.i } };
    }
    for (;;) {
      this.ws();
      if (this.text[this.i] !== '"') this.fail('Esperava uma chave entre aspas.', this.i);
      const keyStart = this.i;
      const key = this.string();
      const keySpan = { from: keyStart, to: this.i };
      this.ws();
      if (this.text[this.i] !== ':') this.fail('Esperava ":" depois da chave.', this.i);
      this.i++;
      const value = this.value(depth + 1);
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, entries.length);
        entries.push({ key, keySpan, value });
      } else {
        // JSON.parse semantics: the last value wins.
        this.duplicates.push({ key, span: keySpan });
        entries[previous] = { key, keySpan, value };
      }
      this.ws();
      const ch = this.text[this.i];
      if (ch === ',') {
        this.i++;
        continue;
      }
      if (ch === '}') {
        this.i++;
        return { kind: 'object', entries, span: { from, to: this.i } };
      }
      this.fail('Esperava "," ou "}".', this.i);
    }
  }

  private array(depth: number): JsonNode {
    if (depth > MAX_JSON_DEPTH) this.fail('O JSON está aninhado demais.', this.i);
    const from = this.i;
    this.i++;
    const items: JsonNode[] = [];
    this.ws();
    if (this.text[this.i] === ']') {
      this.i++;
      return { kind: 'array', items, span: { from, to: this.i } };
    }
    for (;;) {
      items.push(this.value(depth + 1));
      this.ws();
      const ch = this.text[this.i];
      if (ch === ',') {
        this.i++;
        continue;
      }
      if (ch === ']') {
        this.i++;
        return { kind: 'array', items, span: { from, to: this.i } };
      }
      this.fail('Esperava "," ou "]".', this.i);
    }
  }

  private string(): string {
    const from = this.i;
    this.i++;
    let out = '';
    for (;;) {
      const ch = this.text[this.i];
      if (ch === undefined) this.fail('A string não foi fechada.', from);
      if (ch === '"') {
        this.i++;
        return out;
      }
      if (ch === '\\') {
        const esc = this.text[this.i + 1];
        this.i += 2;
        if (esc === '"' || esc === '\\' || esc === '/') out += esc;
        else if (esc === 'b') out += '\b';
        else if (esc === 'f') out += '\f';
        else if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          const hex = this.text.slice(this.i, this.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Escape "\\u" inválido.', this.i - 2);
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
        } else this.fail(`Escape "\\${String(esc)}" inválido.`, this.i - 2);
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) this.fail('Controle inválido dentro da string.', this.i);
      out += ch;
      this.i++;
    }
  }

  private number(): JsonNode {
    const from = this.i;
    if (this.text[this.i] === '-') this.i++;
    if (this.text[this.i] === '0') this.i++;
    else if (this.text[this.i] !== undefined && this.text[this.i]! >= '1' && this.text[this.i]! <= '9') {
      while (this.text[this.i] !== undefined && this.text[this.i]! >= '0' && this.text[this.i]! <= '9') this.i++;
    } else this.fail('Número inválido.', from);
    if (this.text[this.i] === '.') {
      this.i++;
      if (!(this.text[this.i] !== undefined && this.text[this.i]! >= '0' && this.text[this.i]! <= '9')) this.fail('Número inválido.', from);
      while (this.text[this.i] !== undefined && this.text[this.i]! >= '0' && this.text[this.i]! <= '9') this.i++;
    }
    const exp = this.text[this.i];
    if (exp === 'e' || exp === 'E') {
      this.i++;
      const sign = this.text[this.i];
      if (sign === '+' || sign === '-') this.i++;
      if (!(this.text[this.i] !== undefined && this.text[this.i]! >= '0' && this.text[this.i]! <= '9')) this.fail('Número inválido.', from);
      while (this.text[this.i] !== undefined && this.text[this.i]! >= '0' && this.text[this.i]! <= '9') this.i++;
    }
    const value = Number(this.text.slice(from, this.i));
    if (!Number.isFinite(value)) this.fail('Número inválido.', from);
    return { kind: 'number', value, span: { from, to: this.i } };
  }

  parse(): JsonNode {
    const node = this.value(0);
    this.ws();
    if (this.i < this.text.length) this.fail('Conteúdo extra depois do JSON.', this.i);
    return node;
  }
}

/** A JSON document with spans; a syntax error comes back as a message plus the failing index. */
export function parseJsonText(text: string): JsonParseResult {
  const scanner = new Scanner(text);
  try {
    const node = scanner.parse();
    return { node, error: null, duplicateKeys: scanner.duplicateKeys };
  } catch (err) {
    if (err instanceof JsonError) return { node: null, error: { message: err.message, index: err.index }, duplicateKeys: [] };
    throw err;
  }
}
