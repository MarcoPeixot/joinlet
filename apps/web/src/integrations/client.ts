import { call, post } from '../settings/client';

/** Mirrors the server's IntegrationsView (apps/server/src/integrations/config.ts): status and "…abcd" hints, never a secret. */
export type WebhookKind = 'slack' | 'teams' | 'discord';
export type NotifyEvent = 'version' | 'pr' | 'drift';
export type TestTarget = WebhookKind | 'notion' | 'atlassian';

export interface IntegrationsView {
  webhooks: Record<WebhookKind, { configured: boolean; host: string | null; hint: string | null; events: NotifyEvent[] }>;
  notion: { configured: boolean; hint: string | null; parentPageId: string | null };
  atlassian: { configured: boolean; site: string | null; email: string | null; hint: string | null };
  confluence: { spaceKey: string | null; parentId: string | null };
  jira: { projectKey: string | null; issueType: string | null };
}

export interface IntegrationsPatch {
  webhooks?: Partial<Record<WebhookKind, { url?: string; events?: NotifyEvent[] } | null>>;
  notion?: { token?: string; parentPageId?: string | null } | null;
  atlassian?: { site?: string; email?: string; token?: string } | null;
  confluence?: { spaceKey?: string; parentId?: string | null } | null;
  jira?: { projectKey?: string; issueType?: string } | null;
}

export interface PublishReply {
  ok: true;
  url?: string;
  warnings: string[];
}
export interface JiraReply {
  ok: true;
  key: string;
  url: string;
}
export interface JiraConcernInput {
  id: string;
  diagram: string;
  element?: string;
  message: string;
}

export const integrationsApi = {
  get: () => call<IntegrationsView>('/api/integrations'),
  save: (patch: IntegrationsPatch) => post<IntegrationsView>('/api/integrations', patch),
  test: (target: TestTarget) => post<{ ok: boolean; detail: string }>('/api/integrations/test', { target }),
  publish: (body: { target: 'notion' | 'confluence'; title: string; markdown: string; svg?: string; svgName?: string }) => post<PublishReply>('/api/integrations/publish', body),
  jira: (concern: JiraConcernInput, diagramTitle?: string) => post<JiraReply>('/api/integrations/jira', { concern, ...(diagramTitle ? { diagramTitle } : {}) }),
};

/** Only an http(s) link from the server is ever rendered as a link. */
export const safeLink = (url: string | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** A version accepted from the AI: tells the server so it can ping the webhooks. Never blocks or fails the app. */
export function notifyAiVersion(diagram: string, message: string): void {
  void post('/api/integrations/notify', { event: 'version', diagram, message, author: 'ai' }).catch(() => undefined);
}
