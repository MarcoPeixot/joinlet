import { ADMIN_PLAN, BETA_PLAN, setAccessPlanResolver, type AccessPlan } from '@strukt/workspace';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export const accessPlanStore = createStore<{ plan: AccessPlan; accountPlan: AccessPlan }>()(() => ({ plan: BETA_PLAN, accountPlan: BETA_PLAN }));
setAccessPlanResolver(resource => resource === 'workspaces' ? accessPlanStore.getState().accountPlan : accessPlanStore.getState().plan);
export const useAccessPlan = () => useStore(accessPlanStore);
const readPlan = (value: unknown): AccessPlan => (value as { id?: string } | null)?.id === 'administrator' ? ADMIN_PLAN : BETA_PLAN;
/** Only responses from the active server. No persisted or user-editable admin flag. */
export function acceptAccessPlan(value: { plan?: unknown; accountPlan?: unknown }, owner = false): void {
  accessPlanStore.setState({ plan: readPlan(value.plan), accountPlan: owner ? accessPlanStore.getState().accountPlan : readPlan(value.accountPlan) });
}
export async function loadAccessPlan(endpoint: string, owner = false): Promise<void> {
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Plan unavailable');
    acceptAccessPlan(await response.json(), owner);
  } catch { accessPlanStore.setState({ plan: BETA_PLAN, accountPlan: BETA_PLAN }); }
}
