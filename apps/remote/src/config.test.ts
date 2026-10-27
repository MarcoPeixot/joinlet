import { expect, it } from 'vitest';
import { remoteConfig } from './config';
const env = { NODE_ENV: 'production', STRUKT_PUBLIC_URL: 'https://joinlet.co', STRUKT_REMOTE_ENCRYPTION_KEY: 'a'.repeat(64), STRUKT_GITHUB_APP_CLIENT_ID: 'client', STRUKT_GITHUB_APP_CLIENT_SECRET: 'secret' };
it('accepts the production origin and validates server settings without logging values', () => {
  expect(remoteConfig(env)).toMatchObject({ publicUrl: 'https://joinlet.co', port: 8788, trustProxyHops: 1 });
  expect(remoteConfig({ ...env, NODE_ENV: 'development', STRUKT_PUBLIC_URL: 'http://localhost:8788' }).publicUrl).toBe('http://localhost:8788');
});
it.each([
  { STRUKT_PUBLIC_URL: 'http://localhost:8788' }, { STRUKT_PUBLIC_URL: 'https://joinlet.co/path' },
  { STRUKT_PUBLIC_URL: 'https://user:secret@joinlet.co' }, { PORT: 'NaN' }, { PORT: '0' },
  { JOINLET_TRUST_PROXY_HOPS: '-1' }, { STRUKT_REMOTE_ENCRYPTION_KEY: 'a'.repeat(64) + 'invalid' },
  { JOINLET_ACCOUNT_DIRECTORY_TOKEN: 'short' },
  { STRUKT_REMOTE_ENCRYPTION_KEY: 'z'.repeat(64) }, { STRUKT_GITHUB_APP_CLIENT_SECRET: '' },
])('rejects incomplete or unsafe startup settings %j', override => {
  expect(() => remoteConfig({ ...env, ...override })).toThrow();
});
it('validates distinct app and marketing origins and keeps combined mode optional', () => {
  expect(remoteConfig({ ...env, STRUKT_PUBLIC_URL: 'https://app.joinlet.co', JOINLET_SITE_URL: 'https://joinlet.co/' }).siteUrl).toBe('https://joinlet.co');
  expect(remoteConfig(env).siteUrl).toBeUndefined();
  for (const site of ['https://joinlet.co', 'https://joinlet.co/path', 'http://site.test', 'https://user:secret@site.test', 'not a URL']) {
    expect(() => remoteConfig({ ...env, JOINLET_SITE_URL: site })).toThrow();
  }
});

it('defaults to self-hosted and accepts Cloud policy only from trusted startup configuration', () => {
  expect(remoteConfig(env).deploymentMode).toBe('self-hosted');
  expect(remoteConfig({ ...env, JOINLET_DEPLOYMENT_MODE: 'cloud' }).deploymentMode).toBe('cloud');
  expect(() => remoteConfig({ ...env, JOINLET_DEPLOYMENT_MODE: 'administrator' })).toThrow('JOINLET_DEPLOYMENT_MODE');
});

it('starts password-only hosting without GitHub credentials and rejects a partially configured provider', () => {
  const passwordOnly = { ...env, STRUKT_GITHUB_APP_CLIENT_ID: '', STRUKT_GITHUB_APP_CLIENT_SECRET: '' };
  expect(remoteConfig(passwordOnly).githubClientId).toBeUndefined();
  expect(remoteConfig(passwordOnly).githubClientSecret).toBeUndefined();
  expect(() => remoteConfig({ ...passwordOnly, STRUKT_GITHUB_APP_CLIENT_ID: 'configured' })).toThrow('both GitHub');
});

it('keeps analytics opt-in and validates the local collector path', () => {
  expect(remoteConfig(env).analyticsPath).toBeUndefined();
  expect(remoteConfig({ ...env, JOINLET_ANALYTICS_PATH: '/telemetry' }).analyticsPath).toBe('/telemetry');
  expect(() => remoteConfig({ ...env, JOINLET_ANALYTICS_PATH: 'https://unexpected.test' })).toThrow('JOINLET_ANALYTICS_PATH');
});

it("enables optional editor entry only through the operator configuration",()=>{expect(remoteConfig(env).optionalLogin).toBe(false);expect(remoteConfig({...env,JOINLET_OPTIONAL_LOGIN:"1"}).optionalLogin).toBe(true);});
