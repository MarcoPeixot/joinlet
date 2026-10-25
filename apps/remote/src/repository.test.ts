import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('persists and isolates connector pairing, projections, cloud edits and revocation with real HTTP and SQLite',()=>{
  expect(execFileSync('bun',[new URL('./repositorySmoke.ts',import.meta.url).pathname],{encoding:'utf8',timeout:30_000})).toContain('Joinlet repository smoke passed');
});

it('analyzes pinned GitHub revisions and maintains a single PR with batched, idempotent commits',()=>{
  expect(execFileSync('bun',[new URL('./repositoryGithubSmoke.ts',import.meta.url).pathname],{encoding:'utf8',timeout:30_000})).toContain('Joinlet GitHub worker smoke passed');
});

it('runs the actual paired CLI process through two-way edits, persisted restart and revocation',()=>{
  expect(execFileSync('bun',[new URL('./repositoryConnectorSmoke.ts',import.meta.url).pathname],{encoding:'utf8',timeout:60_000})).toContain('Joinlet connector process smoke passed');
},65_000);

it('starts API and worker concurrently and preserves authenticated workspaces after restart',()=>{
 expect(execFileSync('bun',[new URL('./repositoryStartupSmoke.ts',import.meta.url).pathname],{encoding:'utf8',timeout:60_000})).toContain('Joinlet concurrent startup smoke passed');
},65_000);
