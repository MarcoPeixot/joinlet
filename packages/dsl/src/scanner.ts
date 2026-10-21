import type { Span } from '@strukt/core';

/** Character cursor over the DSL source; the parser decides what each run of text means. */
export class Scanner {
  pos = 0;

  constructor(readonly text: string) {}

  get eof(): boolean {
    return this.pos >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text[this.pos + offset] ?? '';
  }

  startsWith(fragment: string): boolean {
    return this.text.startsWith(fragment, this.pos);
  }

  /** Spaces, tabs, carriage returns and non-breaking spaces; never newlines (they end statements). */
  skipSpaces(): void {
    while (!this.eof && ' \t\r\f\v '.includes(this.peek())) this.pos++;
  }

  /** Skips spaces and a `//` comment; true when the line (or the file) ends here. */
  atLineEnd(): boolean {
    this.skipSpaces();
    if (this.startsWith('//')) while (!this.eof && this.peek() !== '\n') this.pos++;
    return this.eof || this.peek() === '\n';
  }

  /** Error recovery: drop the rest of the statement, stopping before a `}` that may close a group. */
  skipStatement(): void {
    while (!this.eof && this.peek() !== '\n' && this.peek() !== '}') this.pos++;
  }

  /** Rest of the current line (without the newline). */
  restOfLine(): string {
    const end = this.text.indexOf('\n', this.pos);
    return this.text.slice(this.pos, end < 0 ? this.text.length : end);
  }
}

/** 1-based line and column of `offset`. */
export function locate(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

export const spanOf = (from: number, to: number): Span => ({ from, to: Math.max(from, to) });
