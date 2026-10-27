import { parseAdminGithubIds } from '@strukt/workspace/access-context';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RemoteAuthOptions } from './auth';

/** Fail before opening sockets or a database. Never include secret values in validation errors. */
export function remoteConfig(env: Record<string, string | undefined>): RemoteAuthOptions & { port: number; trustProxyHops: number } {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Configure ${name} to start Joinlet remote.`);
    return value;
  };
  const publicUrl = required('STRUKT_PUBLIC_URL').replace(/\/$/, '');
  let url: URL;
  try { url = new URL(publicUrl); } catch { throw new Error('STRUKT_PUBLIC_URL must be a valid HTTPS origin.'); }
  if (url.origin !== publicUrl || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('STRUKT_PUBLIC_URL must be an HTTPS origin (HTTP loopback is development-only).');
  }
  const siteUrl = env.JOINLET_SITE_URL?.trim().replace(/\/$/, '') || undefined;
  if (siteUrl) {
    let site: URL;
    try { site = new URL(siteUrl); } catch { throw new Error('JOINLET_SITE_URL must be a valid HTTPS origin.'); }
    if (site.origin !== siteUrl || site.protocol !== 'https:' || site.host === url.host) {
      throw new Error('JOINLET_SITE_URL must be a distinct HTTPS origin.');
    }
  }
  const analyticsPath = env.JOINLET_ANALYTICS_PATH?.trim() || undefined;
  const accountDirectoryToken = env.JOINLET_ACCOUNT_DIRECTORY_TOKEN?.trim() || undefined;
  if (accountDirectoryToken && !/^[a-f0-9]{64}$/.test(accountDirectoryToken)) throw new Error('JOINLET_ACCOUNT_DIRECTORY_TOKEN must contain 64 lowercase hexadecimal characters.');
  if (analyticsPath && analyticsPath !== '/telemetry') throw new Error('JOINLET_ANALYTICS_PATH must be /telemetry or empty.');
  const encryptionKey = required('STRUKT_REMOTE_ENCRYPTION_KEY');
  if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) throw new Error('STRUKT_REMOTE_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.');
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    return value;
  };
  if (!!env.STRUKT_GITHUB_APP_CLIENT_ID?.trim() !== !!env.STRUKT_GITHUB_APP_CLIENT_SECRET?.trim()) throw new Error('Configure both GitHub App client settings, or leave both empty for password-only access.');
  const deploymentMode = env.JOINLET_DEPLOYMENT_MODE?.trim() || 'self-hosted';
  if (deploymentMode !== 'self-hosted' && deploymentMode !== 'cloud') throw new Error('JOINLET_DEPLOYMENT_MODE must be self-hosted or cloud.');
  return {
    deploymentMode,
    optionalLogin: env.JOINLET_OPTIONAL_LOGIN === '1',
    repositoryWorker: env.JOINLET_REPOSITORY_WORKER === '1',
    repositoryWebhookSecret: env.JOINLET_REPOSITORY_WEBHOOK_SECRET?.trim() || undefined,
    publicUrl, siteUrl, analyticsPath, encryptionKey, accountDirectoryToken,
    githubClientId: env.STRUKT_GITHUB_APP_CLIENT_ID?.trim() || undefined,
    githubClientSecret: env.STRUKT_GITHUB_APP_CLIENT_SECRET?.trim() || undefined,
    githubAppSlug: env.STRUKT_GITHUB_APP_SLUG?.trim() || undefined,
    databasePath: env.STRUKT_REMOTE_DB?.trim() || join(fileURLToPath(new URL('../data/', import.meta.url)), 'remote.sqlite'),
    adminGithubIds: parseAdminGithubIds(env.JOINLET_ADMIN_GITHUB_IDS),
    port: integer('PORT', 8788, 1, 65535),
    trustProxyHops: integer('JOINLET_TRUST_PROXY_HOPS', 1, 0, 5),
  };
}
