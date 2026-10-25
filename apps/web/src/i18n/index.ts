import english from './en.json';

export type Locale = 'pt-BR' | 'en';
export const LOCALE_KEY = 'joinlet:locale';
const catalog: Record<string, string> = { ...english };
/** Feature catalogs can register when their interface is loaded. */
export function registerTranslations(messages: Readonly<Record<string, string>>): void {
  Object.assign(catalog, messages);
  errorPatterns = undefined;
}
function readLocale(): Locale {
  try {
    const query = new URLSearchParams(location.search).get('lang');
    if (query === 'en' || query === 'pt-BR') return query;
    return localStorage.getItem(LOCALE_KEY) === 'pt-BR' ? 'pt-BR' : 'en';
  } catch { return 'en'; }
}
const locale = readLocale();
export function getLocale(): Locale { return locale; }

/** Translate application-owned copy only. Never pass user documents, names, or AI output. */
export function uiText(source: string, values?: readonly unknown[]): string {
  const message = locale === 'en' ? catalog[source] ?? source : source;
  return values ? message.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)]) : token) : message;
}

let prepareChange: (() => Promise<void>) | undefined;
export function beforeLocaleChange(prepare: () => Promise<void>): void { prepareChange = prepare; }
/** Reload also refreshes module-level menus and third-party editors; flush workspace writes first. */
export async function changeLocale(next: Locale): Promise<void> {
  if (next === locale) return;
  await prepareChange?.();
  try { localStorage.setItem(LOCALE_KEY, next); } catch { /* URL preserves the choice when storage is blocked. */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  location.assign(url.href);
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
  document.title = locale === 'en'
    ? document.title.replace('conecte ideias, construa sistemas', 'connect ideas, build systems')
    : document.title.replace('connect ideas, build systems', 'conecte ideias, construa sistemas');
}

let errorPatterns: { pattern: RegExp; translated: string }[] | undefined;
/** Local server/core errors may arrive already interpolated. Match only catalogued application messages. */
export function systemMessage(source: string): string {
  if (locale !== 'en') return source;
  if (catalog[source]) return catalog[source];
  errorPatterns ??= Object.entries(catalog).filter(([key]) => /\{\d+\}/.test(key) && /[a-zÀ-ÿ]{3}/i.test(key)).map(([key, translated]) => ({
    pattern: new RegExp('^' + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$'), translated,
  }));
  if (source.length <= 10_000) for (const entry of errorPatterns) {
    const match = entry.pattern.exec(source);
    if (match) return entry.translated.replace(/\{(\d+)\}/g, (_, index: string) => match[Number(index) + 1] ?? '');
  }
  return source;
}
