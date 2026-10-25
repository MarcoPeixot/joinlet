import { afterEach, expect, it, vi } from 'vitest';
import { BETA_PLAN, CLOUD_BETA_PLAN, SELF_HOSTED_PLAN } from '@strukt/workspace';
import { acceptAccessPlan, accessPlanStore, loadAccessPlan } from './accessPlan';

afterEach(() => {
  vi.unstubAllGlobals();
  accessPlanStore.setState({ plan: SELF_HOSTED_PLAN, accountPlan: SELF_HOSTED_PLAN });
});

it('accepts the canonical self-hosted policy without granting administrator identity', () => {
  acceptAccessPlan({ plan: { id: 'self-hosted' }, accountPlan: { id: 'self-hosted' } });
  expect(accessPlanStore.getState()).toEqual({ plan: SELF_HOSTED_PLAN, accountPlan: SELF_HOSTED_PLAN });
});

it('does not trust arbitrary server payload limits or unknown plan identifiers', () => {
  acceptAccessPlan({ plan: { id: 'free-beta', limits: { diagrams: null } }, accountPlan: { id: 'paid-spoof' } });
  expect(accessPlanStore.getState()).toEqual({ plan: BETA_PLAN, accountPlan: BETA_PLAN });
});

it('keeps the local account policy while an owner observes a shared workspace', () => {
  acceptAccessPlan({ plan: { id: 'free-beta' }, accountPlan: { id: 'free-beta' } }, true);
  expect(accessPlanStore.getState()).toEqual({ plan: BETA_PLAN, accountPlan: SELF_HOSTED_PLAN });
});

it('recognizes the canonical authenticated Cloud workspace policy',()=>{
  acceptAccessPlan({plan:CLOUD_BETA_PLAN,accountPlan:CLOUD_BETA_PLAN});
  expect(accessPlanStore.getState()).toEqual({plan:CLOUD_BETA_PLAN,accountPlan:CLOUD_BETA_PLAN});
});

it('allows offline local use while falling back conservatively for a remote policy failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await loadAccessPlan('/api/plan', false, SELF_HOSTED_PLAN);
  expect(accessPlanStore.getState().plan).toBe(SELF_HOSTED_PLAN);
  await loadAccessPlan('/api/remote/plan');
  expect(accessPlanStore.getState().plan).toBe(BETA_PLAN);
});
