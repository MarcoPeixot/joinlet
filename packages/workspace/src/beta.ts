import { parseManifest } from './manifest';

/** Product policy shared by the server, MCP and editor. No paid tiers during the beta. */
export const BETA_PLAN = Object.freeze({
  id: 'free-beta' as const,
  name: 'Joinlet Beta',
  limits: Object.freeze({ workspaces: 1, diagrams: 20, participants: 5 }),
  features: Object.freeze({ documents: true, export: true, collaboration: true, bringYourOwnKey: true }),
});
export type BetaResource = keyof typeof BETA_PLAN.limits;
export interface AccessPlan {
  readonly id: 'free-beta' | 'administrator';
  readonly name: string;
  readonly limits: Readonly<Record<BetaResource, number | null>>;
  readonly features: typeof BETA_PLAN.features;
}
/** null is unlimited, including in JSON responses. Never infer this from a workspace file. */
export const ADMIN_PLAN: AccessPlan = Object.freeze({
  id: 'administrator', name: 'Joinlet Admin',
  limits: Object.freeze({ workspaces: null, diagrams: null, participants: null }),
  features: BETA_PLAN.features,
});
let resolvePlan: (resource: BetaResource) => AccessPlan = () => BETA_PLAN;
/** Runtime wiring only: browser state or the server's request-local AsyncLocalStorage. */
export function setAccessPlanResolver(resolve: (resource: BetaResource) => AccessPlan): void { resolvePlan = resolve; }
export function getAccessPlan(resource: BetaResource = 'diagrams'): AccessPlan { return resolvePlan(resource); }

const codes = { workspaces: 'WORKSPACE_LIMIT_REACHED', diagrams: 'DIAGRAM_LIMIT_REACHED', participants: 'PARTICIPANT_LIMIT_REACHED' } as const;
const messages = {
  workspaces: 'O Joinlet Beta permite {0} workspace próprio. Abra seu workspace existente.',
  diagrams: 'O Joinlet Beta permite {0} diagramas por workspace. Exclua um diagrama para criar outro. Seus dados foram preservados.',
  participants: 'Este workspace atingiu o limite de {0} pessoas simultâneas do Joinlet Beta. Tente novamente quando alguém sair.',
};
export class BetaLimitError extends Error {
  readonly code: typeof codes[BetaResource];
  readonly limit: number;
  constructor(readonly resource: BetaResource, readonly used: number) {
    const limit = BETA_PLAN.limits[resource];
    super(messages[resource].replace('{0}', String(limit)));
    this.name = 'BetaLimitError'; this.code = codes[resource]; this.limit = limit;
  }
  toJSON() { return { error: this.message, code: this.code, plan: BETA_PLAN.id, resource: this.resource, used: this.used, limit: this.limit }; }
}

/** Grandfather existing data: reads, edits, exports and reductions remain possible above a new limit. */
export function assertBetaGrowth(resource: BetaResource, before: number, after: number, plan = getAccessPlan(resource)): void {
  const limit = plan.limits[resource];
  if (limit !== null && after > limit && after > before) throw new BetaLimitError(resource, before);
}

/** The manifest is the inventory; staged files are not diagrams until listed here. */
export function assertBetaManifest(before: string | null, after: string, plan = getAccessPlan()): void {
  const previous = before === null ? 0 : parseManifest(before).manifest.diagrams.length;
  assertBetaGrowth('diagrams', previous, parseManifest(after).manifest.diagrams.length, plan);
}

/** Workspace-wide occupancy, independent of diagram rooms. One browser/session occupies one slot. */
export function createBetaPresence({ now = Date.now, reserved = 0, ttl = 45_000, plan = () => BETA_PLAN }: { now?: () => number; reserved?: number; ttl?: number; plan?: () => AccessPlan } = {}) {
  const sessions = new Map<string, number>();
  const sweep = () => { for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id); };
  return {
    touch(id: string): void {
      sweep();
      if (!sessions.has(id)) assertBetaGrowth('participants', sessions.size + reserved, sessions.size + reserved + 1, plan());
      sessions.set(id, now() + ttl);
    },
    leave(id: string): void { sessions.delete(id); },
    has(id: string): boolean { sweep(); return sessions.has(id); },
    used(): number { sweep(); return sessions.size + reserved; },
  };
}
