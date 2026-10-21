/** Where a saved state sits on the architecture's time axis. A version without a stage is `atual`. */
export const VERSION_STAGES = ['atual', 'transição', 'planejado'] as const;
export type VersionStage = (typeof VERSION_STAGES)[number];

export const STAGE_LABELS: Record<VersionStage, string> = { atual: 'Atual', 'transição': 'Transição', planejado: 'Planejado' };

/** The stage and goal date a version file carries; both are absent on a plain (current) version. */
export interface StageMeta {
  stage?: VersionStage;
  /** `YYYY-MM-DD`: the date the state is meant to be reached (transition and planned versions only). */
  target?: string;
}

const MAX_INPUT = 64;

/** `transicao`, `TRANSIÇÃO` and ` planejado ` are all fine; anything else (hostile values included) is `null`. */
export function parseStage(value: unknown): VersionStage | null {
  if (typeof value !== 'string' || value.length > MAX_INPUT) return null;
  const text = value.trim().toLowerCase();
  if (text === 'transicao') return 'transição';
  return VERSION_STAGES.find((stage) => stage === text) ?? null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const FIRST_YEAR = 1900;
const LAST_YEAR = 2999;

/**
 * The calendar day of an ISO date or date-time (`2027-03-15`, `2027-03-15T10:00:00Z`) as written, with no time-zone
 * conversion: a goal is a day, not an instant. `null` for anything that is not a real day in 1900–2999.
 */
export function normalizeTarget(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_INPUT) return null;
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  // Date.UTC rolls an impossible day over (30 Feb → 2 Mar): the round trip tells a real day from one that was rolled.
  const real = new Date(Date.UTC(year, month - 1, day));
  if (year < FIRST_YEAR || year > LAST_YEAR || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return null;
  if (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59 || (ss !== undefined && Number(ss) > 59))) return null;
  return `${y}-${m}-${d}`;
}

/** What a file read keeps: an unknown stage is `atual`, an invalid goal is dropped, and a current version has no goal. */
export function stageMeta(raw: { stage?: unknown; target?: unknown }): StageMeta {
  const stage = parseStage(raw.stage);
  if (stage === null || stage === 'atual') return {};
  const target = normalizeTarget(raw.target);
  return { stage, ...(target ? { target } : {}) };
}

const shown = (value: unknown) => String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 40);

export type StageCheck = { ok: true; meta: StageMeta } | { ok: false; error: string };

/** What a writer (dialog, agent, CLI) sends, checked strictly: the first problem comes back in pt-BR. */
export function checkStageMeta(stage: unknown, target: unknown): StageCheck {
  const kind = stage === undefined || stage === null || stage === '' ? 'atual' : parseStage(stage);
  if (kind === null) return { ok: false, error: `Estágio inválido: "${shown(stage)}". Use atual, transição ou planejado.` };
  const wanted = target === undefined || target === null || target === '' ? null : normalizeTarget(target);
  if (wanted === null && target !== undefined && target !== null && target !== '') {
    return { ok: false, error: `Meta inválida: "${shown(target)}". Use uma data real no formato AAAA-MM-DD.` };
  }
  if (kind === 'atual') return wanted ? { ok: false, error: 'Só versões de transição ou planejadas têm meta.' } : { ok: true, meta: {} };
  return { ok: true, meta: { stage: kind, ...(wanted ? { target: wanted } : {}) } };
}
