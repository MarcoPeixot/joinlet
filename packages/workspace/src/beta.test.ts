import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BETA_PLAN, SELF_HOSTED_PLAN, setAccessPlanResolver, BetaLimitError, assertBetaGrowth, assertBetaManifest, createBetaPresence } from './beta';
import { addItem, newWorkspace, removeItem } from './workspace';
import { printManifest } from './manifest';
import { restoreItem, snapshotItem } from './itemSnapshot';

describe('Joinlet Beta business rules', () => {
  beforeEach(() => setAccessPlanResolver(() => BETA_PLAN));
  afterEach(() => setAccessPlanResolver(() => SELF_HOSTED_PLAN));
  it('allows 20 diagrams, refuses the 21st and frees capacity after deletion', () => {
    let data = newWorkspace('Beta');
    for (let i = 0; i < 20; i++) data = addItem(data, 'diagram', `Diagram ${i}`).data;
    const before = data;
    expect(() => addItem(data, 'diagram', 'Extra')).toThrow(BetaLimitError);
    expect(data).toBe(before);
    expect(data.manifest.diagrams).toHaveLength(BETA_PLAN.limits.diagrams);
    expect(addItem(data, 'doc', 'Unlimited docs').data.manifest.docs).toHaveLength(1);
    const snapshot = snapshotItem(data, 'diagram', data.manifest.diagrams[0]!.slug)!;
    data = removeItem(data, 'diagram', snapshot.slug);
    data = addItem(data, 'diagram', 'Replacement').data;
    expect(() => restoreItem(data, snapshot)).toThrow(BetaLimitError);
  });

  it('validates raw manifest imports and preserves existing over-limit workspaces', () => {
    const base = newWorkspace('Existing').manifest;
    const manifest = (count: number) => printManifest({ ...base, diagrams: Array.from({ length: count }, (_, i) => ({ slug: `d-${i}`, title: `D ${i}` })) });
    expect(() => assertBetaManifest(null, manifest(21))).toThrow(BetaLimitError);
    expect(() => assertBetaManifest(manifest(20), manifest(21))).toThrow(BetaLimitError);
    expect(() => assertBetaManifest(manifest(30), manifest(30))).not.toThrow();
    expect(() => assertBetaManifest(manifest(30), manifest(25))).not.toThrow();
    expect(() => assertBetaManifest(manifest(30), manifest(31))).toThrow(BetaLimitError);
  });

  it('returns a stable machine-readable refusal for the frontend and APIs', () => {
    try { assertBetaGrowth('workspaces', 1, 2); throw new Error('Expected refusal'); }
    catch (error) {
      expect(error).toBeInstanceOf(BetaLimitError);
      expect((error as BetaLimitError).toJSON()).toMatchObject({ code: 'WORKSPACE_LIMIT_REACHED', used: 1, limit: 1, plan: 'free-beta' });
    }
    expect(() => assertBetaGrowth('workspaces', 3, 3)).not.toThrow();
  });

  it('counts a session once across rooms, includes the host and expires abandoned sessions', () => {
    let now = 0;
    const presence = createBetaPresence({ now: () => now, reserved: 1, plan: () => BETA_PLAN });
    for (let i = 0; i < 4; i++) presence.touch(`guest-${i}`);
    presence.touch('guest-0');
    expect(presence.used()).toBe(5);
    expect(() => presence.touch('guest-4')).toThrow(BetaLimitError);
    now = 30_000;
    presence.touch('guest-0');
    now = 45_001;
    presence.touch('guest-4');
    expect(presence.used()).toBe(3);
    presence.leave('guest-4');
    expect(presence.used()).toBe(2);
  });
});


it('local product operations exceed Cloud quotas without an administrator identity', () => {
  let data = newWorkspace('Self-hosted');
  for (let i = 0; i < 25; i++) data = addItem(data, 'diagram', `Diagram ${i}`).data;
  expect(data.manifest.diagrams).toHaveLength(25);
  expect(() => assertBetaGrowth('workspaces', 1, 10)).not.toThrow();
  const presence = createBetaPresence({ reserved: 1 });
  for (let i = 0; i < 9; i++) presence.touch(String(i));
  expect(presence.used()).toBe(10);
});
