import { applyOps, emptyModel } from '@strukt/core';
import { expect, test } from '@playwright/test';
import { readFile } from './storage';

// A fresh context (Playwright gives each test its own) has no IndexedDB workspace yet, so this is
// the one scenario `firstWorkspace()` (apps/web/src/workspace/boot.ts) actually migrates: the
// M1–M3 scratch diagram, seeded here the way the old autosave used to leave it in localStorage.
const seedResult = applyOps(emptyModel(), [{ op: 'add_node', id: 'Seed' }]);
if (!seedResult.ok) throw new Error(`Seed inválido: ${seedResult.error.message}`);
const SEED_SNAPSHOT = { model: seedResult.model, layout: { nodes: { Seed: { x: 40, y: 40 } }, edges: {} } };

test('migrates the M1–M3 scratch diagram from localStorage into the first workspace, then clears the old key', async ({ page }) => {
  await page.addInitScript((json) => localStorage.setItem('strukt:scratch:v1', json), JSON.stringify(SEED_SNAPSHOT));
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Seed"]')).toBeVisible();
  await expect.poll(() => readFile(page, 'diagrams/sem-titulo.strukt.json')).toContain('Seed');
  expect(await page.evaluate(() => localStorage.getItem('strukt:scratch:v1'))).toBeNull();
});
