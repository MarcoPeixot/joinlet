import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('validates account profiles and the scoped operator directory in the real SQLite runtime', () => {
  expect(execFileSync('bun', [new URL('./profileSmoke.ts', import.meta.url).pathname], { encoding: 'utf8', timeout: 20_000 })).toContain('Joinlet profile smoke passed:');
}, 25_000);
