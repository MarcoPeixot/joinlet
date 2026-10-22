import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('exercises password-only hosting, migration, access boundaries and restored SQLite with the real Bun runtime', () => {
  const output = execFileSync('bun', [new URL('./passwordSmoke.ts', import.meta.url).pathname], { encoding: 'utf8', timeout: 45_000 });
  expect(output).toContain('Joinlet password smoke passed:');
}, 50_000);
