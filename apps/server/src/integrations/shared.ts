import { IntegrationError } from './hosts';

/** What the publishers share: input limits, the outcome shape, and error text that never carries a secret. */

export interface PublishInput {
  title: string;
  markdown: string;
  /** The diagram as SVG, rendered by the browser (see svgCheck.ts). */
  svg?: string;
  svgName?: string;
}

export type PublishOutcome = { ok: true; url?: string; warnings: string[] } | { ok: false; status: number; error: string };

export const MAX_MARKDOWN = 400_000;
export const MAX_TITLE = 200;
const DEFAULT_SVG_NAME = 'diagrama.svg';

/** A page title: one line, bounded, never empty. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const title = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return title ? title.slice(0, MAX_TITLE) : null;
}

/** An attachment name: letters, digits, spaces, dots, dashes, ending in .svg; anything else gets the default. */
export function svgFileName(raw: unknown): string {
  return typeof raw === 'string' && /^[\w][\w .-]{0,76}\.svg$/i.test(raw.trim()) && !raw.includes('..') ? raw.trim() : DEFAULT_SVG_NAME;
}

/** Hides every secret a service might echo back in an error message, and bounds the text. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join('…');
  return out.length > 240 ? `${out.slice(0, 239)}…` : out;
}

/** The `message`/`errorMessages` a service put in an error body (JSON or text), flattened and bounded. */
export async function errorText(res: Response, secrets: readonly string[]): Promise<string> {
  const raw = await res.text().catch(() => '');
  let text = raw;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof body.message === 'string') parts.push(body.message);
    if (Array.isArray(body.errorMessages)) parts.push(...body.errorMessages.filter((m): m is string => typeof m === 'string'));
    if (body.errors && typeof body.errors === 'object') parts.push(...Object.values(body.errors).filter((m): m is string => typeof m === 'string'));
    text = parts.join(' ');
  } catch {
    // not JSON: keep the raw text, bounded below
  }
  // eslint-disable-next-line no-control-regex
  return redact(text.replace(/[\u0000-\u001f]+/g, ' ').trim(), secrets);
}

export const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** Runs a publisher body, turning an IntegrationError into a failed outcome. */
export async function guard(run: () => Promise<PublishOutcome>): Promise<PublishOutcome> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof IntegrationError) return fail(error.status === 400 ? 400 : 502, error.message);
    console.error(error);
    return fail(500, 'Erro interno ao publicar.');
  }
}
