import { ADMIN_PLAN, BETA_PLAN } from '@strukt/workspace';
import { websocket } from 'hono/bun';
import Anthropic from '@anthropic-ai/sdk';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createApp } from './app';
import { createWebSearch } from './webSearch';
import { createAuditLog } from './audit';
import { startCollaborationHost } from './collaborationHost';
import { createGithubAuth } from './githubAuth';
import { createIntegrations } from './integrations';
import { allowedOrigins } from './origin';
import { createOpenRouterClient } from './openrouter';
import { createSettings } from './settings';
import { createShare } from './share';

// Keys come from the environment (apps/server/.env or the shell) or from Configurações, saved in a file on this
// machine outside the repo; the browser sends a typed key once and never receives one back.
const configDir = process.env.STRUKT_CONFIG_DIR?.trim() || join(homedir(), '.config', 'strukt');
const privateFiles = {
  read: (path: string) => readFile(path, 'utf8').catch(() => null),
  async write(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  },
};
const settings = createSettings({
  file: join(configDir, 'settings.json'),
  env: process.env,
  fs: {
    read: privateFiles.read,
    write: privateFiles.write,
  },
  fetch: globalThis.fetch,
  // The request deadline (createApp's default deadlineMs, 240_000) bounds the total, so a single long call may
  // use the whole budget; the SDK timeout just needs to be at least that (plus its own retry).
  anthropic: (apiKey) => new Anthropic({ apiKey, authToken: null, timeout: 240_000, maxRetries: 1 }),
  openrouter: (apiKey) => createOpenRouterClient({ apiKey }),
});
await settings.load();

const githubAuth = createGithubAuth({
  clientId: process.env.STRUKT_GITHUB_CLIENT_ID,
  fs: {
    read: () => privateFiles.read(join(configDir, 'github-auth.json')),
    write: async (text) => {
      const path = join(configDir, 'github-auth.json');
      if (text === null) await rm(path, { force: true });
      else await privateFiles.write(path, text);
    },
  },
});
await githubAuth.load();

// Webhooks, Notion/Confluence and Jira: their credentials live next to settings.json, same 0600 rules.
const integrations = createIntegrations({ file: join(configDir, 'integrations.json'), fs: privateFiles, fetch: globalThis.fetch });
await integrations.load();

const port = Number(process.env.PORT ?? 8787);
// Loopback by default: 0.0.0.0 would expose the AI proxy (and so the API key's spend) to the whole LAN.
const hostname = process.env.HOST?.trim() || '127.0.0.1';
const active = settings.current();
let currentRepo = (await privateFiles.read(join(configDir, 'repository.txt')))?.trim() || null;
const selectedRepo = {
  get: () => currentRepo,
  async set(path: string | null) {
    await privateFiles.write(join(configDir, 'repository.txt'), path ?? '');
    currentRepo = path;
  },
};

// "Compartilhar" starts a LAN collaboration host on request; it stops with this server (every open room writes its
// pending projection first).
const accessPlan = process.env.JOINLET_LOCAL_ADMIN === '1' ? ADMIN_PLAN : BETA_PLAN;
const share = createShare({
  start: ({ root, port, audit }) => startCollaborationHost({ root, port, audit, accessPlan }),
  audit: (root) => createAuditLog({ dir: join(configDir, 'audit'), root }),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void share.stop().finally(() => process.exit(0)));
}

console.log(
  `Joinlet server em http://${hostname}:${port} — IA ${active ? `ativa (${active.id})` : 'desativada (configure em Configurações › IA ou defina ANTHROPIC_API_KEY / OPENROUTER_API_KEY)'}`,
);

// Bun serves the default export. Claude calls can take a while: raise Bun's 10 s idle timeout to its maximum
// (255 s, Bun's cap) — it must stay above createApp's deadlineMs, or a dropped idle connection reaches the
// browser as non-JSON before the 504 can be sent, and the client wrongly classifies that as offline.
export default { port, hostname, websocket, fetch: createApp({ accessPlan, webSearch: createWebSearch({ braveKey: process.env.BRAVE_SEARCH_API_KEY?.trim() }), settings, githubAuth, selectedRepo, share, integrations, allowedOrigins: allowedOrigins(process.env, port) }).fetch, idleTimeout: 255 };
