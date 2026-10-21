import type { VersionEntry } from './versions';
import type { VersionStage } from './versionStage';

/** One mark on the time axis: a saved version or "hoje" (the diagram as it is open now). */
export interface TimelinePoint {
  kind: 'version' | 'today';
  /** `now` for today, the version file path otherwise: unique and stable. */
  key: string;
  entry?: VersionEntry;
  stage: VersionStage;
  /** Where the point sits: the goal date of a planned/transition version, the day a current one was saved, or `null` without a goal. */
  date: string | null;
  /** Whole calendar days from today to `date` (negative: in the past); `null` without a date. */
  days: number | null;
  /** A planned/transition goal whose date has already passed. */
  overdue?: boolean;
}

export interface Timeline {
  /** Local calendar day the axis was built for (`YYYY-MM-DD`). */
  today: string;
  /** Chronological: saved states, today, then transition/planned ones by goal date (undated last). */
  points: TimelinePoint[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in the viewer's time zone. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

/** Whole days from one `YYYY-MM-DD` to another. Works on calendar dates, so daylight saving never shifts it. */
export function daysBetween(from: string, to: string): number {
  return utcDay(to) - utcDay(from);
}

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
const byPath = (a: VersionEntry, b: VersionEntry) => compare(a.path, b.path);
const byCreated = (a: VersionEntry, b: VersionEntry) => Date.parse(a.version.createdAt) - Date.parse(b.version.createdAt) || byPath(a, b);
const STAGE_RANK: Record<VersionStage, number> = { atual: 0, 'transição': 1, planejado: 2 };
const stageOf = (entry: VersionEntry): VersionStage => entry.version.stage ?? 'atual';

/**
 * The time axis of one diagram's versions: current saves in the order they were made, "hoje", then planned and
 * transition states by goal date. The order is total and independent of the input order. Entries with an unreadable
 * date are left out (the version list never produces them).
 */
export function buildTimeline(entries: readonly VersionEntry[], now: Date): Timeline {
  const today = localDay(now);
  const valid = entries.filter((e) => Number.isFinite(Date.parse(e.version.createdAt)));
  const past = valid.filter((e) => stageOf(e) === 'atual').sort(byCreated);
  const future = valid.filter((e) => stageOf(e) !== 'atual');
  const byGoal = (a: VersionEntry, b: VersionEntry) => compare(a.version.target!, b.version.target!) || compare(STAGE_RANK[stageOf(a)], STAGE_RANK[stageOf(b)]) || byCreated(a, b);
  const byStage = (a: VersionEntry, b: VersionEntry) => compare(STAGE_RANK[stageOf(a)], STAGE_RANK[stageOf(b)]) || byCreated(a, b);
  const dated = future.filter((e) => e.version.target).sort(byGoal);
  const undated = future.filter((e) => !e.version.target).sort(byStage);
  const pastPoint = (entry: VersionEntry): TimelinePoint => {
    const date = localDay(new Date(entry.version.createdAt));
    return { kind: 'version', key: entry.path, entry, stage: 'atual', date, days: daysBetween(today, date) };
  };
  const goalPoint = (entry: VersionEntry): TimelinePoint => {
    const target = entry.version.target ?? null;
    const days = target ? daysBetween(today, target) : null;
    return { kind: 'version', key: entry.path, entry, stage: stageOf(entry), date: target, days, ...(days !== null && days < 0 ? { overdue: true } : {}) };
  };
  return {
    today,
    points: [...past.map(pastPoint), { kind: 'today', key: 'now', stage: 'atual', date: today, days: 0 }, ...[...dated, ...undated].map(goalPoint)],
  };
}

/**
 * The saved state that stands for a stage: the newest current one; for transition/planned, the nearest goal still ahead,
 * else one without a date, else the latest overdue goal. `null` when the stage has no saved state.
 */
export function stagePoint(timeline: Timeline, stage: VersionStage): TimelinePoint | null {
  const versions = timeline.points.filter((p) => p.kind === 'version' && p.stage === stage);
  if (!versions.length) return null;
  if (stage === 'atual') return versions[versions.length - 1]!;
  return versions.find((p) => p.days !== null && p.days >= 0) ?? versions.find((p) => p.days === null) ?? versions[versions.length - 1]!;
}

/** The nearest dated planned/transition goal that has not passed (today counts): "next goal" in the panel and for agents. */
export function nextGoal(timeline: Timeline): TimelinePoint | null {
  return timeline.points.find((p) => p.kind === 'version' && p.stage !== 'atual' && p.days !== null && p.days >= 0) ?? null;
}

/** The first (newest) saved state of the current stage in a newest-first list: "the last saved version", future designs aside. */
export function latestCurrent(entries: readonly VersionEntry[]): VersionEntry | null {
  return entries.find((entry) => stageOf(entry) === 'atual') ?? null;
}
