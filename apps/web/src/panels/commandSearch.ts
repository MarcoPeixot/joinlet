import { uiText } from '../i18n';
/** Strips diacritics, lowercases, and turns punctuation into spaces so tokens split cleanly. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

/**
 * Command palette filter: every query token must prefix-match some token in the title, in any
 * order, so "cores forte" finds "Cores: Forte" and "exp svg" finds "Exportar SVG". An empty
 * query matches everything.
 */
export function matchesQuery(title: string, query: string): boolean {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return true;
  const titleTokens = tokenize(title);
  return queryTokens.every((queryToken) => titleTokens.some((titleToken) => titleToken.startsWith(queryToken)));
}

const MAX_QUERY = 64;
const SECTION_ORDER = [uiText("Recentes"), uiText("Ações"), uiText("Ir para"), uiText("Aparência"), uiText("IA")];

/** Score of matching `chars` in order with the first char at `start` (greedy after that); null when they do not fit. */
function scoreFrom(text: string, chars: string, start: number): number | null {
  let score = 0;
  let previous = -2;
  let at = start;
  for (const char of chars) {
    const found = text.indexOf(char, at);
    if (found < 0) return null;
    score += found === previous + 1 ? 10 : -Math.min(found - previous - 1, 5);
    if (found === 0 || text[found - 1] === ' ') score += 8;
    previous = found;
    at = found + 1;
  }
  return score - start * 0.1;
}

/**
 * Fuzzy subsequence match: the query letters must appear in the title in order (case, accents and
 * punctuation ignored). Returns null when they do not, otherwise a score where higher is better
 * (contiguous runs and word starts win). An empty query scores 0 for everything. Plain string ops only.
 */
export function fuzzyScore(title: string, query: string): number | null {
  const chars = normalize(query).replace(/ /g, '').slice(0, MAX_QUERY);
  if (!chars) return 0;
  const text = normalize(title);
  let best: number | null = null;
  for (let start = text.indexOf(chars[0]!); start >= 0; start = text.indexOf(chars[0]!, start + 1)) {
    const score = scoreFrom(text, chars, start);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

export interface PaletteGroup<T> {
  label: string;
  items: T[];
}

/**
 * The rows the palette shows. No query: "Recentes" (known ids, in order) followed by every section in its
 * canonical order. With a query: only matching commands, ranked inside their section (stable on ties).
 */
export function paletteGroups<T extends { id: string; title: string; section: string }>(commands: T[], query: string, recentIds: string[]): PaletteGroup<T>[] {
  const searching = normalize(query) !== '';
  const groups: PaletteGroup<T>[] = [];
  if (!searching) {
    const byId = new Map(commands.map((command) => [command.id, command] as const));
    const recent = recentIds.flatMap((id) => byId.get(id) ?? []);
    if (recent.length) groups.push({ label: uiText("Recentes"), items: recent });
  }
  const ranked = commands
    .map((command, index) => ({ command, index, score: fuzzyScore(command.title, query) }))
    .filter((row): row is { command: T; index: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const sections = [...new Set(commands.map((command) => command.section))].sort(
    (a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99),
  );
  for (const label of sections) {
    const items = ranked.filter((row) => row.command.section === label).map((row) => row.command);
    if (items.length) groups.push({ label, items });
  }
  return groups;
}
