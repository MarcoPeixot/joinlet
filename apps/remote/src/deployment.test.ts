import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('exercises the production HTTP app, OAuth and SQLite recovery with a simulated GitHub', () => {
  const output = execFileSync('bun', [new URL('./deploymentSmoke.ts', import.meta.url).pathname], { encoding: 'utf8', timeout: 30_000 });
  expect(output).toContain('revocation, backup/restore and readiness passed');
});
it('serves split production hosts and keeps login sessions on the app origin', () => {
  const output = execFileSync('bun', [new URL('./domainSmoke.ts', import.meta.url).pathname], { encoding: 'utf8', timeout: 30_000 });
  expect(output).toContain('isolated sessions and OAuth passed');
});
