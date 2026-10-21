import { describe, expect, it } from 'vitest';
import { buildTimeline, daysBetween, latestCurrent, localDay, nextGoal, stagePoint } from './timeline';
import type { VersionEntry, VersionSummary } from './versions';

const NOW = new Date(2026, 9, 3, 12, 0, 0); // 3 Oct 2026, local noon

const entry = (id: string, createdAt: string, extra: Partial<VersionSummary> = {}): VersionEntry => ({
  path: `versions/loja/${createdAt.replace(/[-:.]/g, '')}-${id}.json`,
  version: { id, createdAt, message: `v ${id}`, author: 'human', ...extra },
});

describe('daysBetween / localDay', () => {
  it('counts whole calendar days, across month ends, leap days and years', () => {
    expect(daysBetween('2026-10-03', '2026-10-03')).toBe(0);
    expect(daysBetween('2026-10-03', '2026-10-04')).toBe(1);
    expect(daysBetween('2026-10-03', '2026-09-30')).toBe(-3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-03', '2027-10-03')).toBe(365);
  });

  it('is not moved by daylight saving: it works on dates, not instants', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('writes the local day of an instant', () => {
    expect(localDay(NOW)).toBe('2026-10-03');
    expect(localDay(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
  });
});

describe('buildTimeline', () => {
  it('lays past versions, today and the planned ones on one chronological axis', () => {
    const entries = [
      entry('p2', '2026-09-24T10:00:00.000Z', { stage: 'planejado', target: '2027-06-01' }),
      entry('a2', '2026-09-30T10:00:00.000Z'),
      entry('t1', '2026-09-25T10:00:00.000Z', { stage: 'transição', target: '2026-12-01' }),
      entry('a1', '2026-09-20T10:00:00.000Z'),
      entry('p1', '2026-09-26T10:00:00.000Z', { stage: 'planejado', target: '2027-01-15' }),
    ];
    const timeline = buildTimeline(entries, NOW);
    expect(timeline.today).toBe('2026-10-03');
    expect(timeline.points.map((p) => p.key)).toEqual([entries[3]!.path, entries[1]!.path, 'now', entries[2]!.path, entries[4]!.path, entries[0]!.path]);
    expect(timeline.points.map((p) => p.kind)).toEqual(['version', 'version', 'today', 'version', 'version', 'version']);
    expect(timeline.points.map((p) => p.stage)).toEqual(['atual', 'atual', 'atual', 'transição', 'planejado', 'planejado']);
    expect(timeline.points.map((p) => p.days)).toEqual([-13, -3, 0, 59, 104, 241]);
  });

  it('puts goals without a date after the dated ones, and overdue goals first among the planned ones, flagged', () => {
    const entries = [
      entry('u1', '2026-09-26T10:00:00.000Z', { stage: 'planejado' }),
      entry('d1', '2026-09-27T10:00:00.000Z', { stage: 'planejado', target: '2027-01-01' }),
      entry('o1', '2026-09-28T10:00:00.000Z', { stage: 'planejado', target: '2026-10-01' }),
    ];
    const timeline = buildTimeline(entries, NOW);
    expect(timeline.points.map((p) => (p.kind === 'today' ? 'now' : p.entry!.version.id))).toEqual(['now', 'o1', 'd1', 'u1']);
    const [, overdue, , undated] = timeline.points;
    expect(overdue).toMatchObject({ days: -2, overdue: true });
    expect(undated).toMatchObject({ days: null, date: null });
    expect(undated!.overdue).toBeFalsy();
  });

  it('orders ties the same way every time: stage, then creation time, then path', () => {
    const same = { target: '2027-01-01' } as const;
    const entries = [
      entry('b', '2026-09-26T10:00:00.000Z', { stage: 'planejado', ...same }),
      entry('a', '2026-09-26T10:00:00.000Z', { stage: 'planejado', ...same }),
      entry('c', '2026-09-27T10:00:00.000Z', { stage: 'transição', ...same }),
      entry('d', '2026-09-20T10:00:00.000Z', { stage: 'planejado', ...same }),
    ];
    const order = (list: VersionEntry[]) => buildTimeline(list, NOW).points.filter((p) => p.kind === 'version').map((p) => p.entry!.version.id);
    expect(order(entries)).toEqual(['c', 'd', 'a', 'b']);
    expect(order([...entries].reverse())).toEqual(['c', 'd', 'a', 'b']);
  });

  it('keeps a version with an unreadable date out of the way instead of crashing', () => {
    const odd = entry('x', 'ontem', {});
    const timeline = buildTimeline([odd, entry('a', '2026-09-20T10:00:00.000Z')], NOW);
    expect(timeline.points.map((p) => p.key)).toEqual([expect.stringContaining('-a.json'), 'now']);
  });

  it('is only today when there are no versions, and never mutates its input', () => {
    expect(buildTimeline([], NOW).points.map((p) => p.key)).toEqual(['now']);
    const entries = [entry('b', '2026-09-26T10:00:00.000Z'), entry('a', '2026-09-20T10:00:00.000Z')];
    const copy = structuredClone(entries);
    buildTimeline(entries, NOW);
    expect(entries).toEqual(copy);
  });

  it('survives hostile ids and paths as plain data', () => {
    const hostile = entry('__proto__', '2026-09-20T10:00:00.000Z', { stage: 'planejado', target: '2027-01-01' });
    const timeline = buildTimeline([hostile], NOW);
    expect(timeline.points).toHaveLength(2);
    expect(Object.getPrototypeOf(timeline.points[1])).toBe(Object.prototype);
  });
});

describe('stagePoint', () => {
  const entries = [
    entry('o1', '2026-09-20T10:00:00.000Z', { stage: 'planejado', target: '2026-09-30' }),
    entry('n2', '2026-09-21T10:00:00.000Z', { stage: 'planejado', target: '2027-06-01' }),
    entry('n1', '2026-09-22T10:00:00.000Z', { stage: 'planejado', target: '2027-01-15' }),
    entry('u', '2026-09-23T10:00:00.000Z', { stage: 'planejado' }),
    entry('a1', '2026-09-10T10:00:00.000Z'),
    entry('a2', '2026-09-12T10:00:00.000Z'),
  ];
  const timeline = buildTimeline(entries, NOW);

  it('picks the nearest goal that is still ahead', () => {
    expect(stagePoint(timeline, 'planejado')?.entry?.version.id).toBe('n1');
  });

  it('falls back to a goal without a date, then to the latest overdue one', () => {
    const noFuture = buildTimeline(entries.filter((e) => e.version.id !== 'n1' && e.version.id !== 'n2'), NOW);
    expect(stagePoint(noFuture, 'planejado')?.entry?.version.id).toBe('u');
    const onlyOverdue = buildTimeline([entries[0]!, entry('o2', '2026-09-21T10:00:00.000Z', { stage: 'planejado', target: '2026-09-15' })], NOW);
    expect(stagePoint(onlyOverdue, 'planejado')?.entry?.version.id).toBe('o1');
  });

  it('picks the newest saved state for the current stage, and nothing for an empty stage', () => {
    expect(stagePoint(timeline, 'atual')?.entry?.version.id).toBe('a2');
    expect(stagePoint(timeline, 'transição')).toBeNull();
  });
});

describe('nextGoal', () => {
  it('is the nearest planned or transition point that is still ahead', () => {
    const timeline = buildTimeline(
      [
        entry('o', '2026-09-20T10:00:00.000Z', { stage: 'planejado', target: '2026-09-30' }),
        entry('t', '2026-09-21T10:00:00.000Z', { stage: 'transição', target: '2026-12-01' }),
        entry('p', '2026-09-22T10:00:00.000Z', { stage: 'planejado', target: '2027-01-15' }),
        entry('u', '2026-09-23T10:00:00.000Z', { stage: 'planejado' }),
      ],
      NOW,
    );
    expect(nextGoal(timeline)?.entry?.version.id).toBe('t');
  });

  it('is today itself when the goal is today, and null with nothing ahead', () => {
    expect(nextGoal(buildTimeline([entry('d', '2026-09-20T10:00:00.000Z', { stage: 'planejado', target: '2026-10-03' })], NOW))?.days).toBe(0);
    expect(nextGoal(buildTimeline([entry('o', '2026-09-20T10:00:00.000Z', { stage: 'planejado', target: '2026-09-30' }), entry('u', '2026-09-20T11:00:00.000Z', { stage: 'planejado' })], NOW))).toBeNull();
    expect(nextGoal(buildTimeline([], NOW))).toBeNull();
  });
});

describe('latestCurrent', () => {
  it('is the newest saved state of the current stage, never a planned or transition one', () => {
    const entries = [
      entry('p', '2026-09-30T10:00:00.000Z', { stage: 'planejado', target: '2027-01-01' }),
      entry('t', '2026-09-29T10:00:00.000Z', { stage: 'transição' }),
      entry('a2', '2026-09-25T10:00:00.000Z'),
      entry('a1', '2026-09-20T10:00:00.000Z'),
    ];
    expect(latestCurrent(entries)?.version.id).toBe('a2');
    expect(latestCurrent(entries.slice(0, 2))).toBeNull();
    expect(latestCurrent([])).toBeNull();
  });
});
