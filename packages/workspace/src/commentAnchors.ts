import { COMMENT_LIMITS } from './comments';
import type { CommentAnchor } from './comments';

export type TextAnchor = Extract<CommentAnchor, { type: 'text' }>;

/** Where an anchor points in the doc now. `exact`: the quoted text is there as it was (else it was found by tolerance). */
export interface ResolvedText { from: number; to: number; exact: boolean }

/** The anchor for the passage `[from, to)` of `doc` (either order; clamped): the quote, a little context, the offset. */
export function textAnchor(doc: string, from: number, to: number): TextAnchor {
  const start = Math.max(0, Math.min(from, to, doc.length));
  const end = Math.min(doc.length, Math.max(from, to), start + COMMENT_LIMITS.quote);
  return {
    type: 'text',
    quote: doc.slice(start, end),
    prefix: doc.slice(Math.max(0, start - COMMENT_LIMITS.context), start),
    suffix: doc.slice(end, end + COMMENT_LIMITS.context),
    from: start,
  };
}

/** Occurrences scanned on each side of the hint: a quote repeated more often than this is matched by its context. */
const SIDE = 100;

/** Up to `SIDE` occurrences of `needle` from `hint` onwards and up to `SIDE` before it: the ones nearest to the hint. */
function occurrences(text: string, needle: string, hint: number): number[] {
  const found = new Set<number>();
  const at = Math.max(0, Math.min(hint, text.length));
  for (let i = text.indexOf(needle, at), n = 0; i !== -1 && n < SIDE; i = text.indexOf(needle, i + 1), n++) found.add(i);
  for (let i = at > 0 ? text.lastIndexOf(needle, at - 1) : -1, n = 0; i !== -1 && n < SIDE; i = i > 0 ? text.lastIndexOf(needle, i - 1) : -1, n++) found.add(i);
  return [...found];
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** The best of `starts` for `anchor`: the one whose surroundings match the recorded context most, then the nearest to the hint. */
function bestStart(text: string, anchor: TextAnchor, starts: number[], length: (start: number) => number): number {
  let best = starts[0]!;
  let bestScore = -1;
  let bestDistance = Infinity;
  for (const start of starts) {
    const end = start + length(start);
    const score = commonSuffix(text.slice(Math.max(0, start - anchor.prefix.length), start), anchor.prefix) + commonPrefix(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    const distance = Math.abs(start - anchor.from);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = start;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
}

/** `text` with every run of whitespace as one space, and for each character of the result where it came from. */
function collapse(text: string): { flat: string; origin: Int32Array } {
  const origin = new Int32Array(text.length + 1);
  let flat = '';
  let length = 0;
  let space = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) {
      if (space) continue;
      space = true;
      flat += ' ';
    } else {
      space = false;
      flat += text[i];
    }
    origin[length++] = i;
  }
  origin[length] = text.length;
  return { flat, origin };
}

/** Where the whitespace-collapsed `needle` is in `text`, tolerating re-flowed lines. */
function resolveFlattened(text: string, anchor: TextAnchor): ResolvedText | null {
  const needle = collapse(anchor.quote).flat.trim();
  if (!needle) return null;
  const { flat, origin } = collapse(text);
  const hint = origin.findIndex((value, index) => index < flat.length && value >= anchor.from);
  const starts = occurrences(flat, needle, hint < 0 ? flat.length : hint);
  if (!starts.length) return null;
  const start = bestStart(flat, { ...anchor, from: hint < 0 ? flat.length : hint }, starts, () => needle.length);
  return { from: origin[start]!, to: origin[start + needle.length - 1]! + 1, exact: false };
}

/** Smallest edit distance of `quote` against any substring of `region`, with where that substring starts and ends. */
function approximate(quote: string, region: string): { distance: number; from: number; to: number } {
  let previous = Array.from({ length: region.length + 1 }, (_, j) => ({ cost: 0, start: j }));
  for (let i = 1; i <= quote.length; i++) {
    const row = [{ cost: i, start: 0 }];
    for (let j = 1; j <= region.length; j++) {
      const substitute = previous[j - 1]!;
      const skipQuote = previous[j]!;
      const skipRegion = row[j - 1]!;
      const match = { cost: substitute.cost + (quote[i - 1] === region[j - 1] ? 0 : 1), start: substitute.start };
      const del = { cost: skipQuote.cost + 1, start: skipQuote.start };
      const ins = { cost: skipRegion.cost + 1, start: skipRegion.start };
      row.push([match, del, ins].reduce((best, option) => (option.cost < best.cost ? option : best)));
    }
    previous = row;
  }
  let best = { cost: Infinity, start: 0, end: 0 };
  previous.forEach((cell, j) => { if (cell.cost < best.cost) best = { cost: cell.cost, start: cell.start, end: j }; });
  return { distance: best.cost, from: best.start, to: best.end };
}

const FUZZY_CANDIDATES = 24;

/** A passage that was edited a little: found by pieces of the quote, then aligned with a bounded edit distance. */
function resolveApproximate(text: string, anchor: TextAnchor): ResolvedText | null {
  const quote = anchor.quote;
  if (quote.length < 12) return null;
  const size = Math.max(6, Math.min(16, Math.floor(quote.length / 4)));
  const offsets = [0, Math.floor((quote.length - size) / 2), quote.length - size];
  const starts = new Set<number>();
  for (const offset of offsets) {
    for (const found of occurrences(text, quote.slice(offset, offset + size), anchor.from + offset).slice(0, FUZZY_CANDIDATES)) starts.add(found - offset);
  }
  const slack = Math.max(20, Math.floor(quote.length * 0.3));
  const allowed = Math.floor(quote.length * 0.3);
  let best: (ResolvedText & { distance: number; context: number }) | null = null;
  for (const start of [...starts].slice(0, FUZZY_CANDIDATES)) {
    const base = Math.max(0, start - slack);
    const region = text.slice(base, start + quote.length + slack);
    const { distance, from, to } = approximate(quote, region);
    if (distance > allowed || to <= from) continue;
    const found = { from: base + from, to: base + to, exact: false, distance, context: 0 };
    found.context = commonSuffix(text.slice(Math.max(0, found.from - anchor.prefix.length), found.from), anchor.prefix) + commonPrefix(text.slice(found.to, found.to + anchor.suffix.length), anchor.suffix);
    if (!best || found.distance < best.distance || (found.distance === best.distance && found.context > best.context) || (found.distance === best.distance && found.context === best.context && Math.abs(found.from - anchor.from) < Math.abs(best.from - anchor.from))) best = found;
  }
  return best ? { from: best.from, to: best.to, exact: false } : null;
}

/**
 * Where a comment's passage is in the doc as it is now, tolerant to editing: the quote itself (the occurrence whose
 * surroundings match the recorded context best, then the nearest to where it was); else the quote with its whitespace
 * re-flowed; else the quote edited by up to ~30% of its characters. `null` when the passage is gone.
 */
export function resolveTextAnchor(doc: string, anchor: TextAnchor): ResolvedText | null {
  if (!anchor.quote) return null;
  const direct = occurrences(doc, anchor.quote, anchor.from);
  if (direct.length) {
    const start = bestStart(doc, anchor, direct, () => anchor.quote.length);
    return { from: start, to: start + anchor.quote.length, exact: true };
  }
  return resolveFlattened(doc, anchor) ?? resolveApproximate(doc, anchor);
}
