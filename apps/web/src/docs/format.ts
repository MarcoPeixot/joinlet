import { uiText } from '../i18n';
export type FormatKind = 'bold' | 'italic' | 'list' | 'link' | 'code' | 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'quote';

export interface FormatResult {
  text: string;
  selStart: number;
  selEnd: number;
  /** The single splice that turns the input into `text` (what the editor dispatches). */
  change: { from: number; to: number; insert: string };
}

const WRAP: Record<'bold' | 'italic' | 'code', { mark: string; placeholder: string }> = {
  bold: { mark: '**', placeholder: uiText("texto") },
  italic: { mark: '_', placeholder: uiText("texto") },
  code: { mark: '`', placeholder: uiText("código") },
};

function splice(text: string, from: number, to: number, insert: string, selStart: number, selEnd: number): FormatResult {
  return { text: text.slice(0, from) + insert + text.slice(to), selStart, selEnd, change: { from, to, insert } };
}

function wrap(text: string, from: number, to: number, kind: 'bold' | 'italic' | 'code'): FormatResult {
  const { mark, placeholder } = WRAP[kind];
  const n = mark.length;
  const selected = text.slice(from, to);
  // Markers just outside the selection: unwrap them.
  if (from >= n && text.slice(from - n, from) === mark && text.slice(to, to + n) === mark) {
    return splice(text, from - n, to + n, selected, from - n, from - n + selected.length);
  }
  // Markers inside the selection: unwrap them.
  if (selected.length >= n * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(n, selected.length - n);
    return splice(text, from, to, inner, from, from + inner.length);
  }
  const body = selected || placeholder;
  return splice(text, from, to, `${mark}${body}${mark}`, from + n, from + n + body.length);
}

function list(text: string, from: number, to: number): FormatResult {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const newline = text.indexOf("\n", to);
  const end = newline < 0 ? text.length : newline;
  const block = text.slice(start, end);
  if (block === '') return splice(text, start, end, '- item', start + 2, start + 6);
  const lines = block.split("\n");
  const listed = lines.every((line) => line.startsWith('- '));
  const next = lines.map((line) => (listed ? line.slice(2) : `- ${line}`)).join("\n");
  return splice(text, start, end, next, start, start + next.length);
}

function link(text: string, from: number, to: number): FormatResult {
  const label = text.slice(from, to) || uiText("texto");
  const insert = `[${label}](https://)`;
  const urlStart = from + label.length + 3;
  return splice(text, from, to, insert, urlStart, urlStart + 'https://'.length);
}

/** Inserts or toggles Markdown for `kind` around the selection [selStart, selEnd) (any order, clamped to `text`). */
export function applyFormat(text: string, selStart: number, selEnd: number, kind: FormatKind): FormatResult {
  const clamp = (n: number) => Math.min(Math.max(0, n), text.length);
  const from = Math.min(clamp(selStart), clamp(selEnd));
  const to = Math.max(clamp(selStart), clamp(selEnd));
  if (kind === 'paragraph' || kind === 'quote' || kind.startsWith('heading')) {
    const start = text.lastIndexOf("\n", from - 1) + 1;
    const newline = text.indexOf("\n", to);
    const end = newline < 0 ? text.length : newline;
    const prefix = kind === 'quote' ? '> ' : kind === 'paragraph' ? '' : '#'.repeat(Number(kind.at(-1))) + ' ';
    const body = text.slice(start, end).replace(/^(?:#{1,6} |> )/gm, '');
    const next = body.split("\n").map((line) => prefix + line).join("\n");
    return splice(text, start, end, next, start + prefix.length, start + next.length);
  }
  if (kind === 'list') return list(text, from, to);
  if (kind === 'link') return link(text, from, to);
  return wrap(text, from, to, kind as 'bold' | 'italic' | 'code');
}
