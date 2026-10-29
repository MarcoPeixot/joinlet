import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startCollabHost } from './support/collabHost';
import type { CollabHost } from './support/collabHost';
import { itemAction } from './sidebarMenu';

let host: CollabHost;
test.beforeEach(async () => {
  host = await startCollabHost({
    name: 'Dois diagramas',
    diagrams: {
      mapa: { title: 'Mapa', nodes: ['Web', 'API', 'Banco'] },
      outro: { title: 'Outro', nodes: ['A', 'B'] },
    },
  });
});
test.afterEach(async () => { await host?.dispose(); });

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const nodes = (page: Page) => page.locator('.react-flow__node');
const editable = (page: Page) => expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
const arch = (...parts: string[]) => join(host.root, '.arch', ...parts);

/** Node ids of a diagram as the host has it on disk (empty when the file is missing). */
async function onDisk(slug: string): Promise<string[]> {
  const text = await readFile(arch('diagrams', `${slug}.strukt.json`), 'utf8').catch(() => null);
  if (!text) return [];
  return (JSON.parse(text).nodes as { id: string }[]).map((node) => node.id).sort();
}
/** The host writes a room's projection after a 1.5 s debounce: poll until the files settle on `expected`, then keep checking they stay there. */
async function expectDisk(expected: Record<string, string[]>) {
  for (const [slug, ids] of Object.entries(expected)) await expect.poll(() => onDisk(slug), { timeout: 8000 }).toEqual([...ids].sort());
  await new Promise((resolve) => setTimeout(resolve, 2500));
  for (const [slug, ids] of Object.entries(expected)) expect(await onDisk(slug), `${slug}.strukt.json after settling`).toEqual([...ids].sort());
}

test('switching, creating and deleting diagrams never writes one diagram into another (two real guests)', async ({ browser }) => {
  test.setTimeout(120_000);
  const [first, second] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await first.newPage(), await second.newPage()];
  await Promise.all([a.goto(host.invite), b.goto(host.invite)]);
  await Promise.all([a, b].map((page) => expect(sidebar(page)).toBeVisible()));

  // Both open Mapa and wait until it is live; then A leaves for Outro (the P0: this used to copy Outro over Mapa).
  await Promise.all([a, b].map((page) => sidebar(page).getByRole('button', { name: 'Mapa' }).click()));
  await expect(nodes(a)).toHaveCount(3);
  await expect(nodes(b)).toHaveCount(3);
  await editable(a);
  await a.waitForTimeout(1500);
  await sidebar(a).getByRole('button', { name: 'Outro' }).click();
  await expect(nodes(a)).toHaveCount(2);
  await expect(nodes(b)).toHaveCount(3);
  await expectDisk({ mapa: ['Web', 'API', 'Banco'], outro: ['A', 'B'] });

  // Back to Mapa: Outro must not inherit Mapa's nodes.
  await sidebar(a).getByRole('button', { name: 'Mapa' }).click();
  await expect(nodes(a)).toHaveCount(3);
  await expectDisk({ mapa: ['Web', 'API', 'Banco'], outro: ['A', 'B'] });

  // B goes the other way, both together, then B edits Outro and the edit lands only there.
  await Promise.all([
    sidebar(a).getByRole('button', { name: 'Outro' }).click(),
    sidebar(b).getByRole('button', { name: 'Outro' }).click(),
  ]);
  await expect(nodes(a)).toHaveCount(2);
  await expect(nodes(b)).toHaveCount(2);
  await editable(b);
  await b.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await expect(nodes(a)).toHaveCount(3);
  await expect.poll(async () => (await onDisk('outro')).length, { timeout: 8000 }).toBe(3);
  expect(await onDisk('mapa')).toEqual(['API', 'Banco', 'Web']);

  // Creating a diagram while in Mapa must not empty Mapa.
  await sidebar(a).getByRole('button', { name: 'Mapa' }).click();
  await expect(nodes(a)).toHaveCount(3);
  await editable(a);
  await a.waitForTimeout(1500);
  await sidebar(a).getByRole('button', { name: 'Novo diagrama' }).click();
  await a.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Terceiro');
  await a.keyboard.press('Enter');
  await expect.poll(async () => (await readdir(arch('diagrams'))).filter((name) => name.endsWith('.strukt.json')).length, { timeout: 8000 }).toBe(3);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(await onDisk('mapa')).toEqual(['API', 'Banco', 'Web']);

  // Back to Mapa and Outro: the files are still what the guests drew.
  await sidebar(a).getByRole('button', { name: 'Mapa' }).click();
  await expect(nodes(a)).toHaveCount(3);
  await expect(nodes(b)).toHaveCount(3);
  expect(await onDisk('mapa')).toEqual(['API', 'Banco', 'Web']);
  expect((await onDisk('outro')).length).toBe(3);
  await first.close();
  await second.close();
});

const manifestSlugs = async () => (JSON.parse(await readFile(arch('strukt.json'), 'utf8')).diagrams as { slug: string }[]).map((item) => item.slug).sort();

test('two guests creating items back to back both keep them, and each sidebar shows the other\'s items (P1 manifest)', async ({ browser }) => {
  test.setTimeout(90_000);
  const [first, second] = [await browser.newContext(), await browser.newContext()];
  const [ana, cris] = [await first.newPage(), await second.newPage()];
  await Promise.all([ana.goto(host.invite), cris.goto(host.invite)]);
  await Promise.all([ana, cris].map((page) => expect(sidebar(page)).toBeVisible()));
  const create = async (page: Page, title: string) => {
    await sidebar(page).getByRole('button', { name: 'Novo diagrama' }).click();
    await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill(title);
    await page.keyboard.press('Enter');
  };
  await create(ana, 'Do Ana');
  await expect.poll(manifestSlugs, { timeout: 8000 }).toContain('do-ana');
  // Cris still holds the list from when the page opened (its poll is seconds away): this is the stale write.
  await create(cris, 'Do Cris');
  await expect.poll(manifestSlugs, { timeout: 12_000 }).toEqual(['do-ana', 'do-cris', 'mapa', 'outro']);
  for (const page of [ana, cris]) {
    for (const title of ['Do Ana', 'Do Cris', 'Mapa', 'Outro']) await expect(sidebar(page).getByRole('button', { name: title, exact: true })).toBeVisible({ timeout: 15_000 });
  }
  await expect(cris.getByText('Não salvo')).toHaveCount(0);
  await expect(ana.getByText('Não salvo')).toHaveCount(0);
  // Both new diagrams are intact on the host.
  await expect.poll(() => onDisk('do-ana')).toEqual([]);
  expect(await readdir(arch('diagrams'))).toEqual(expect.arrayContaining(['do-ana.strukt.json', 'do-cris.strukt.json']));
  await first.close();
  await second.close();
});

test('a guest whose open diagram another guest deletes ends on the Overview with the item gone from the sidebar (P2)', async ({ browser }) => {
  test.setTimeout(90_000);
  const [first, second] = [await browser.newContext(), await browser.newContext()];
  const [ana, cris] = [await first.newPage(), await second.newPage()];
  await Promise.all([ana.goto(host.invite), cris.goto(host.invite)]);
  await Promise.all([ana, cris].map((page) => expect(sidebar(page)).toBeVisible()));
  await sidebar(cris).getByRole('button', { name: 'Outro', exact: true }).click();
  await expect(nodes(cris)).toHaveCount(2);
  await editable(cris);
  await itemAction(ana, 'Outro', 'Excluir');
  await expect(sidebar(cris).getByRole('button', { name: 'Outro', exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(cris.getByText(/foi excluído por outra pessoa|Este item foi excluído/).first()).toBeVisible();
  // Not left on another diagram's content with the old title and a "Connecting" assistant.
  await expect(nodes(cris)).toHaveCount(0);
  await expect(cris.getByText('Conectando à colaboração…')).toHaveCount(0);
  // The guest is free to open what is left.
  await sidebar(cris).getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(nodes(cris)).toHaveCount(3);
  await editable(cris);
  expect(await manifestSlugs()).toEqual(['mapa']);
  await first.close();
  await second.close();
});
