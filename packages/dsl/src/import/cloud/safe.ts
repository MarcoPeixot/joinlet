import { cleanText } from '../common';
import type { CloudAttrs } from './types';

/**
 * Second line of defence. Attribute values only enter a resource through per-kind allowlists, but whatever passes
 * them still never carries credentials: names that smell like secrets are dropped, and so are values shaped like keys.
 */
const SECRET_KEY = /(secret|passw|token|credential|private|api[_-]?key|access[_-]?key|user[_-]?data|userdata|environment|policy|certificate|connection[_-]?string|signature)/i;
const SECRET_VALUE: RegExp[] = [
  /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]{0,24}KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /(?:password|passwd|secret|token|api[_-]?key)[ \t]*[=:]/i,
  /[A-Za-z0-9+/]{48,}={0,2}/,
];
const MAX_VALUE = 160;

export function looksSecret(text: string): boolean {
  const head = text.length > 400 ? text.slice(0, 400) : text;
  return SECRET_VALUE.some((pattern) => pattern.test(head));
}

export function secretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** A scalar safe to show and store, or `undefined`. Long strings are refused rather than cut: a cut secret is still half a secret. */
export function safeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = cleanText(value, MAX_VALUE + 1);
  if (!text || text.length > MAX_VALUE || looksSecret(text)) return undefined;
  return text;
}

/** Sets `attrs[key]` when the key and the value are both safe. `__proto__` never becomes a key. */
export function setAttr(attrs: CloudAttrs, key: string, value: unknown): void {
  if (key === '__proto__' || secretKey(key)) return;
  const safe = safeValue(value);
  if (safe !== undefined) attrs[key] = safe;
}

/** A display name, or `undefined` when it is empty or looks like a credential. */
export function safeName(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = cleanText(value, max);
  return text && !looksSecret(text) ? text : undefined;
}

/** Every attribute of every resource, as one string: tests and the sidecar writer use it to prove nothing sensitive leaked. */
export function attrText(attrs: CloudAttrs): string {
  return Object.entries(attrs).map(([key, value]) => `${key}=${String(value)}`).join(' ');
}
