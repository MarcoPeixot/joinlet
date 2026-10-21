import { getLocale, uiText } from '../i18n';
/** "Nenhuma pendência" / "1 pendência" / "3 pendências": the count with the noun in the right number and gender. */
export function pluralize(count: number, singular: string, plural: string, gender: 'm' | 'f' = 'm'): string {
  if (getLocale() === 'en' && count === 0) return `No ${plural}`;
  if (count === 0) return `${gender === 'f' ? uiText("Nenhuma") : uiText("Nenhum")} ${singular}`;
  return `${count} ${count === 1 ? singular : plural}`;
}
