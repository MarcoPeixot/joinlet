import { uiText } from '../i18n';
/** `15/03/2027` for `2027-03-15`: a day written as it is, never converted through a time zone. */
export function goalDate(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

const days = (n: number) => `${n} ${n === 1 ? uiText("dia") : uiText("dias")}`;

/** "faltam 12 dias" / "é amanhã" / "venceu há 3 dias" / "sem meta": the count a planned point shows. */
export function goalLabel(daysLeft: number | null): string {
  if (daysLeft === null) return uiText("sem meta");
  if (daysLeft === 0) return uiText("é hoje");
  if (daysLeft === 1) return uiText("é amanhã");
  if (daysLeft > 1) return uiText("faltam {0}", [days(daysLeft)]);
  return daysLeft === -1 ? uiText("venceu ontem") : uiText("venceu há {0}", [days(-daysLeft)]);
}

/** "há 13 dias" / "ontem" / "hoje": when a saved state was made. */
export function pastLabel(daysAgo: number): string {
  if (daysAgo >= 0) return uiText("hoje");
  return daysAgo === -1 ? uiText("ontem") : uiText("há {0}", [days(-daysAgo)]);
}
