import { getLocale, uiText } from '../i18n';
import type { Version } from '@strukt/workspace';

/** "23/09/2026 14:05" in the viewer's time zone (`timeZone` pins it, for tests). */
export function formatVersionDate(iso: string, timeZone?: string): string {
  if (getLocale() === 'en') return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  const parts = new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

export function versionTitle(version: Pick<Version, 'message'>): string {
  return version.message.trim() || uiText("Versão sem descrição");
}

/** Message of the version recorded right after a restore. */
export function restoredMessage(version: Pick<Version, 'createdAt'>, timeZone?: string): string {
  return uiText("Restaurado de {0}", [formatVersionDate(version.createdAt, timeZone)]);
}
