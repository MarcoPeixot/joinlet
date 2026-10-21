import { expect, it } from 'vitest';
import { withAccessPlan, setRequestPlans, parseAdminGithubIds } from './accessContext';
import { ADMIN_PLAN, BETA_PLAN, BetaLimitError, assertBetaGrowth, assertBetaManifest, createBetaPresence } from './beta';
import { addItem, newWorkspace } from './workspace';
import { printManifest } from './manifest';
import { writeWorkspace } from './fs';
import { createMemoryAdapter } from './storage';

it('isolates concurrent accounts, defaults to Beta and scopes workspace quotas to the owner', async () => {
  await Promise.all([
    withAccessPlan(ADMIN_PLAN, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(() => assertBetaGrowth('workspaces', 1, 10)).not.toThrow();
      let data = newWorkspace('Admin');
      for (let i = 0; i < 25; i++) data = addItem(data, 'diagram', `Diagram ${i}`).data;
      const adapter = createMemoryAdapter();
      await writeWorkspace(adapter, data);
      expect(data.manifest.diagrams).toHaveLength(25);
      expect(() => assertBetaManifest(null, printManifest(data.manifest))).not.toThrow();
    }),
    withAccessPlan(BETA_PLAN, async () => {
      await Promise.resolve();
      expect(() => assertBetaGrowth('diagrams', 20, 21)).toThrow(BetaLimitError);
      setRequestPlans(ADMIN_PLAN, BETA_PLAN);
      expect(() => assertBetaGrowth('workspaces', 1, 2)).not.toThrow();
      expect(() => assertBetaGrowth('diagrams', 20, 21)).toThrow(BetaLimitError);
    }),
  ]);
  expect(() => assertBetaGrowth('workspaces', 1, 2)).toThrow(BetaLimitError);
});

it('allows larger administrator sessions and restores the cap after revocation', () => {
  let plan = ADMIN_PLAN;
  const presence = createBetaPresence({ reserved: 1, plan: () => plan });
  for (let i = 0; i < 12; i++) presence.touch(String(i));
  expect(presence.used()).toBe(13);
  plan = BETA_PLAN;
  expect(() => presence.touch('new')).toThrow(BetaLimitError);
  expect(() => presence.touch('0')).not.toThrow();
});

it('accepts only immutable numeric account IDs in the trusted configuration', () => {
  expect([...parseAdminGithubIds('42, 99,42')]).toEqual([42, 99]);
  expect([...parseAdminGithubIds()]).toEqual([]);
  for (const value of ['example-user', '*', '0', '-1', '1.2', '9007199254740992']) expect(() => parseAdminGithubIds(value)).toThrow();
});
