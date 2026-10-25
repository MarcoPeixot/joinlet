import { cachedRepositoryAnalyzer } from '@strukt/workspace/repository-cache';
import { digest } from '@strukt/workspace/repository-reader';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSettings } from './settings';
import { createOpenRouterClient } from './openrouter';
import { repositoryAnalyzer } from './repositoryAi';

/** Reads the same local BYOK configuration as the API; no key ever enters .arch or stdout. */
export async function localRepositoryAi() {
  const settings = createSettings({
    file: join(process.env.STRUKT_CONFIG_DIR?.trim() || join(homedir(), '.config', 'strukt'), 'settings.json'),
    env: process.env,
    fs: { read: path => readFile(path, 'utf8').catch(() => null), write: async () => { throw Error('Settings are read-only in the repository CLI.'); } },
    fetch: globalThis.fetch,
    anthropic: apiKey => new Anthropic({ apiKey, authToken: null, maxRetries: 1, timeout: 240_000 }),
    openrouter: apiKey => createOpenRouterClient({ apiKey }),
  });
  await settings.load();
  const current = settings.current();
  return { settings, analyzer: current ? cachedRepositoryAnalyzer(repositoryAnalyzer(current.client, current.models.edit), digest(JSON.stringify(settings.view()))) : undefined };
}
