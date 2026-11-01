import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('distinguishes GitHub configuration and authorization errors with real HTTP sessions', () => {
  expect(execFileSync('bun', [new URL('./repositoryAuthorizationSmoke.ts', import.meta.url).pathname], { encoding: 'utf8', timeout: 15_000 })).toContain('Joinlet GitHub authorization smoke passed');
});
