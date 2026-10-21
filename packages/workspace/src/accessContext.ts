import { AsyncLocalStorage } from 'node:async_hooks';
import { SELF_HOSTED_PLAN, setAccessPlanResolver } from './beta';
import type { AccessPlan } from './beta';

const context = new AsyncLocalStorage<{ account: AccessPlan; workspace: AccessPlan }>();
setAccessPlanResolver(resource => {
  const scope = context.getStore();
  return (resource === 'workspaces' ? scope?.account : scope?.workspace) ?? SELF_HOSTED_PLAN;
});
/** Each request owns a separate scope; async operations cannot promote another account. */
export function withAccessPlan<T>(plan: AccessPlan, action: () => T): T {
  return context.run({ account: plan, workspace: plan }, action);
}
/** Call after verified authentication + ownership lookup, never from a request's plan/role fields. */
export function setRequestPlans(account: AccessPlan, workspace: AccessPlan): void {
  const scope = context.getStore();
  if (!scope) throw new Error('Missing request access context');
  scope.account = account; scope.workspace = workspace;
}
export function parseAdminGithubIds(value = ''): ReadonlySet<number> {
  const ids = value.split(',').map(id => id.trim()).filter(Boolean);
  if (ids.some(id => !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('JOINLET_ADMIN_GITHUB_IDS must contain positive GitHub numeric IDs.');
  return new Set(ids.map(Number));
}
