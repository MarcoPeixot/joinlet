import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('persists authenticated ownership, handles members and atomically limits competing connections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'joinlet-beta-'));
  try {
    const output = execFileSync('bun', ['-e', `
      import { Database } from 'bun:sqlite';
      import { createBetaAccounts } from ${JSON.stringify(new URL('./betaAccounts.ts', import.meta.url).pathname)};
      import assert from 'node:assert/strict';
      const file = ${JSON.stringify(join(dir, 'accounts.sqlite'))};
      let db = new Database(file, { create: true });
      let beta = createBetaAccounts(db);
      assert.equal(beta.claim(42, 'Org/First').owner, true);
      assert.equal(beta.claim(42, 'org/first').owner, true);
      assert.equal(beta.status(42, 'ORG/FIRST').ownedWorkspaces, 1);
      assert.throws(() => beta.claim(42, 'org/second'), e => e.code === 'WORKSPACE_LIMIT_REACHED');
      assert.equal(beta.claim(99, 'org/first').owner, false);
      assert.equal(beta.status(99, 'org/first').ownedWorkspaces, 0);
      assert.equal(beta.claim(99, 'org/second').owner, true);
      assert.throws(() => beta.claim(0, 'org/spoofed'));
      db.close();
      db = new Database(file);
      beta = createBetaAccounts(db);
      assert.equal(beta.status(42, 'org/first').ownedWorkspaces, 1);
      const otherDb = new Database(file);
      const other = createBetaAccounts(otherDb);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => beta.claim(123, 'org/a')),
        Promise.resolve().then(() => other.claim(123, 'org/b')),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(beta.status(123, 'org/a').ownedWorkspaces, 1);
      otherDb.close();
      beta = createBetaAccounts(db, Date.now, new Set([42]));
      beta.claim(42, 'org/admin-two'); beta.claim(42, 'org/admin-three');
      assert.equal(beta.status(42, 'org/first').ownedWorkspaces, 3);
      assert.equal(beta.status(42, 'org/first').plan.id, 'administrator');
      assert.equal(beta.status(99, 'org/first').plan.id, 'administrator');
      assert.equal(beta.status(99, 'org/first').accountPlan.id, 'free-beta');
      assert.equal(beta.status(42, 'org/second').plan.id, 'free-beta');
      assert.equal(beta.status(42, 'org/second').accountPlan.id, 'administrator');
      for (let i = 0; i < 9; i++) beta.presence('org/first').touch(String(i));
      for (let i = 0; i < 5; i++) beta.presence('org/second').touch(String(i));
      assert.throws(() => beta.presence('org/second').touch('extra'));
      assert.throws(() => beta.claim(99, 'org/regular-extra'));
      // Removing the allowlist takes effect without rewriting ownership or losing existing data.
      const regular = createBetaAccounts(db);
      assert.equal(regular.workspacePlan('org/first').id, 'free-beta');
      assert.throws(() => regular.claim(42, 'org/after-revocation'));
      db.close(); console.log('beta-account-ok');
    `], { encoding: 'utf8' });
    expect(output).toContain('beta-account-ok');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
