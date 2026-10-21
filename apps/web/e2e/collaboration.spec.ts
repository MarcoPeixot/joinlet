import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startCollabHost } from './support/collabHost';
import type { CollabHost } from './support/collabHost';

let host: CollabHost;
test.beforeEach(async () => {
  host = await startCollabHost({
    name: 'Colaboração',
    docs: { notas: { title: 'Notas', text: 'Olá' } },
    diagrams: { mapa: { title: 'Mapa', nodes: ['Web', 'API', 'Banco'] } },
  });
});
test.afterEach(async () => { await host?.dispose(); });

const invite = () => host.invite;
const nodes = (page: Page) => page.locator('.react-flow__node');
async function rename(page: Page, id: string, to: string) {
  const box = await page.locator(`[data-id="${id}"]`).boundingBox();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const input = page.locator('.strukt-label-input');
  await input.fill(to);
  await input.press('Enter');
}

test('two guests coedit Markdown and see diagram changes', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  await Promise.all([a.goto(invite()), b.goto(invite())]);
  await expect(a.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(b.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Copiar convite de colaboração' })).toBeVisible();

  const sidebarA = a.getByRole('navigation', { name: 'Workspace' });
  const sidebarB = b.getByRole('navigation', { name: 'Workspace' });
  await Promise.all([
    sidebarA.getByRole('button', { name: 'Notas' }).click(),
    sidebarB.getByRole('button', { name: 'Notas' }).click(),
  ]);
  const editorA = a.getByLabel('Editor do documento').locator('.cm-content');
  const editorB = b.getByLabel('Editor do documento').locator('.cm-content');
  await expect(editorA).toContainText('Olá');
  await expect(editorB).toContainText('Olá');
  await editorA.click();
  await a.keyboard.press('End');
  await a.keyboard.type(' mundo');
  await expect(editorB).toContainText('Olá mundo');
  await Promise.all([
    (async () => { await editorA.click(); await a.keyboard.press('Home'); await a.keyboard.type('A '); })(),
    (async () => { await editorB.click(); await b.keyboard.press('End'); await b.keyboard.type(' B'); })(),
  ]);
  await expect(editorA).toContainText('A ');
  await expect(editorB).toContainText(' B');
  await expect.poll(() => editorA.textContent()).toBe(await editorB.textContent());

  await Promise.all([
    sidebarA.getByRole('button', { name: 'Mapa' }).click(),
    sidebarB.getByRole('button', { name: 'Mapa' }).click(),
  ]);
  await expect(a.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  const before = await b.locator('.react-flow__node').count();
  await a.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await expect(b.locator('.react-flow__node')).toHaveCount(before + 1);
  await Promise.all([
    a.getByRole('button', { name: 'Adicionar nó (N)' }).click(),
    b.getByRole('button', { name: 'Adicionar nó (N)' }).click(),
  ]);
  await expect(a.locator('.react-flow__node')).toHaveCount(before + 3);
  await expect(b.locator('.react-flow__node')).toHaveCount(before + 3);
  await a.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect(a.locator('.react-flow__node')).toHaveCount(before + 2);
  await expect(b.locator('.react-flow__node')).toHaveCount(before + 2);
  await a.getByRole('button', { name: 'Refazer (⇧⌘Z)' }).click();
  await expect(a.locator('.react-flow__node')).toHaveCount(before + 3);
  await expect(b.locator('.react-flow__node')).toHaveCount(before + 3);
  await first.close();
  await second.close();
});

const editable = (page: Page) => expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();

for (const delay of [0, 1000]) test(`two guests converge on add, rename and delete (bridge chunk delayed ${delay} ms)`, async ({ browser }) => {
  test.setTimeout(45_000);
  const [first, second] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await first.newPage(), await second.newPage()];
  // A's collaboration bridge arrives late: until it syncs the room, A's diagram must stay locked (an edit made
  // before would be saved around the room and reverted by it).
  if (delay) await a.route(/CollaborationBridge-.*\.js$/, async (route) => { await new Promise((r) => setTimeout(r, delay)); await route.continue(); });
  await Promise.all([a.goto(invite()), b.goto(invite())]);
  await Promise.all([a, b].map((page) => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Mapa' }).click()));
  await expect(nodes(a)).toHaveCount(3);
  await expect(nodes(b)).toHaveCount(3);
  // The seed is a valid diagram (Web → API → Banco), not "a file with errors": both guests draw its connections.
  for (const page of [a, b]) await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  expect(existsSync(join(host.root, '.arch', 'diagrams', 'mapa.strukt.json.bak'))).toBe(false);
  // rename: each peer renames a different node as soon as it can; the ids stay put (label edits), so nothing duplicates
  await editable(a);
  await rename(a, 'Web', 'Portal');
  await expect(nodes(b).filter({ hasText: 'Portal' })).toHaveCount(1);
  await editable(b);
  await rename(b, 'Banco', 'Dados');
  for (const page of [a, b]) {
    await expect(nodes(page).filter({ hasText: 'Portal' })).toHaveCount(1);
    await expect(nodes(page).filter({ hasText: 'Dados' })).toHaveCount(1);
    await expect(nodes(page)).toHaveCount(3);
  }
  // Nothing late reverts it: the rename is still there after the room's projection round-trip.
  await a.waitForTimeout(2000);
  for (const page of [a, b]) await expect(nodes(page).filter({ hasText: 'Portal' })).toHaveCount(1);
  // delete: A removes a node, B sees it go
  await a.locator('[data-id="API"] .strukt-label').click();
  await a.keyboard.press('Delete');
  await expect(nodes(a)).toHaveCount(2);
  await expect(nodes(b)).toHaveCount(2);
  // Its connections went with it, on both sides.
  for (const page of [a, b]) await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await first.close();
  await second.close();
});

test('a 1.2 MB paste gets an error toast and the session keeps working without a reconnect storm', async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  let sockets = 0;
  page.on('websocket', () => sockets++);
  await page.goto(invite());
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Notas' }).click();
  const editor = page.getByLabel('Editor do documento').locator('.cm-content');
  await expect(editor).toContainText('Olá');
  await editor.click();
  await editor.evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'x'.repeat(1_200_000));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText(/grande demais/)).toBeVisible();
  // the room is rebuilt from the host: the paste is gone and typing still syncs
  const fresh = page.getByLabel('Editor do documento').locator('.cm-content');
  await expect(fresh).toContainText('Olá');
  await expect(fresh).not.toContainText('xxxxxxxxxx');
  await fresh.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ok');
  const other = await (await browser.newContext()).newPage();
  await other.goto(invite());
  await other.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Notas' }).click();
  await expect(other.getByLabel('Editor do documento').locator('.cm-content')).toContainText('Olá ok');
  await page.waitForTimeout(3000);
  expect(sockets).toBeLessThanOrEqual(3);
  await context.close();
});

test('the browser reads the host closing a room it does not have (4404), unlike a refused upgrade (1006)', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invite());
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  const repo = host.root.split('/').at(-1)!;
  const code = await page.evaluate((repo) => new Promise<number>((done) => {
    const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/api/collaboration?repo=${encodeURIComponent(repo)}&kind=doc&slug=nao-salvo`);
    socket.onclose = (event) => done(event.code);
  }), repo);
  expect(code).toBe(4404);
  await context.close();
});

test('the read-only link shows the live workspace but changes nothing', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const viewer = await (await browser.newContext()).newPage();
  await Promise.all([owner.goto(invite()), viewer.goto(host.viewInvite)]);
  const sidebarOwner = owner.getByRole('navigation', { name: 'Workspace' });
  const sidebarViewer = viewer.getByRole('navigation', { name: 'Workspace' });
  await expect(sidebarViewer).toBeVisible();
  await expect(viewer.getByRole('note').filter({ hasText: 'Somente leitura' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Copiar convite de colaboração' })).toHaveCount(0);
  await expect(sidebarViewer.getByRole('button', { name: /^Novo / })).toHaveCount(0);
  await expect(owner.getByRole('note').filter({ hasText: 'Somente leitura' })).toHaveCount(0);

  // Diagram: the viewer sees the owner's change, and cannot add a node.
  await Promise.all([sidebarOwner.getByRole('button', { name: 'Mapa' }).click(), sidebarViewer.getByRole('button', { name: 'Mapa' }).click()]);
  await expect(nodes(viewer)).toHaveCount(3);
  await expect(owner.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  await expect(viewer.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();
  await owner.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await expect(nodes(viewer)).toHaveCount(4);
  await viewer.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await viewer.keyboard.press('n');
  await expect(nodes(viewer)).toHaveCount(4);
  await expect(nodes(owner)).toHaveCount(4);

  // Document: the viewer reads the owner's typing but its own keys go nowhere.
  await Promise.all([sidebarOwner.getByRole('button', { name: 'Notas' }).click(), sidebarViewer.getByRole('button', { name: 'Notas' }).click()]);
  const editorOwner = owner.getByLabel('Editor do documento').locator('.cm-content');
  const editorViewer = viewer.getByLabel('Editor do documento').locator('.cm-content');
  await expect(editorViewer).toContainText('Olá');
  await editorOwner.click();
  await owner.keyboard.press('End');
  await owner.keyboard.type(' mundo');
  await expect(editorViewer).toContainText('Olá mundo');
  await editorViewer.click();
  await viewer.keyboard.press('End');
  await viewer.keyboard.type(' invasor');
  await expect(editorViewer).not.toContainText('invasor');
  await expect(editorOwner).not.toContainText('invasor');
});
