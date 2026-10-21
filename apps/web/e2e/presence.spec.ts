import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { startCollabHost } from './support/collabHost';
import type { CollabHost } from './support/collabHost';

let host: CollabHost;
test.beforeEach(async () => {
  host = await startCollabHost({
    name: 'Presença',
    docs: { notas: { title: 'Notas', text: 'Olá mundo' } },
    diagrams: { mapa: { title: 'Mapa', nodes: ['Web', 'API', 'Banco'] } },
  });
});
test.afterEach(async () => { await host?.dispose(); });

/** Two guests with fixed names, so the labels each sees are predictable. */
async function guests(browser: Browser): Promise<{ a: Page; b: Page }> {
  const pages: Page[] = [];
  for (const [name, cid, color] of [['Ana', 'ana-0000001', '#3972dc'], ['Bia', 'bia-0000002', '#c75c8f']] as const) {
    const context = await browser.newContext();
    await context.addInitScript(([n, c, col]) => sessionStorage.setItem('strukt:collaborator', JSON.stringify({ name: n, cid: c, color: col })), [name, cid, color]);
    pages.push(await context.newPage());
  }
  await Promise.all(pages.map((page) => page.goto(host.invite)));
  for (const page of pages) await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  return { a: pages[0]!, b: pages[1]! };
}

const open = (page: Page, title: string) => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: title, exact: true }).click();

test('the bar shows who else is in the room', async ({ browser }) => {
  const { a, b } = await guests(browser);
  await open(a, 'Notas');
  await open(b, 'Notas');
  await expect(a.locator('header [data-person="Bia"]')).toBeVisible();
  await expect(b.locator('header [data-person="Ana"]')).toBeVisible();
  await expect(a.locator('header [data-person="Ana"]')).toHaveCount(0); // not yourself
});

test('in a doc, each person sees the other\'s named cursor and selection', async ({ browser }) => {
  const { a, b } = await guests(browser);
  await open(a, 'Notas');
  await open(b, 'Notas');
  const editorA = a.getByLabel('Editor do documento').locator('.cm-content');
  await expect(editorA).toContainText('Olá mundo');
  await editorA.click();
  await a.keyboard.press('ControlOrMeta+a');
  await expect(b.locator('.cm-remote-caret')).toHaveAttribute('data-name', 'Ana');
  await expect(b.locator('.cm-remote-selection')).toHaveCount(1);
  // The cursor moves: a plain caret, no selection any more.
  await a.keyboard.press('End');
  await expect(b.locator('.cm-remote-selection')).toHaveCount(0);
  await expect(b.locator('.cm-remote-caret')).toHaveAttribute('data-name', 'Ana');
  // The name is drawn by CSS: it never becomes part of the editor's text.
  await expect(b.getByLabel('Editor do documento').locator('.cm-content')).not.toContainText('Ana');
  // Leaving the doc takes the cursor away.
  await open(a, 'Mapa');
  await expect(b.locator('.cm-remote-caret')).toHaveCount(0);
});

test('in a diagram, the pointer and the selected nodes show to the other person', async ({ browser }) => {
  const { a, b } = await guests(browser);
  await open(a, 'Mapa');
  await open(b, 'Mapa');
  await expect(a.locator('.react-flow__node[data-id="API"]')).toBeVisible();
  await expect(b.locator('.react-flow__node[data-id="API"]')).toBeVisible();
  const api = (await a.locator('.react-flow__node[data-id="API"]').boundingBox())!;
  await a.mouse.click(api.x + api.width / 2, api.y + api.height / 2);
  await expect(b.locator('[data-remote-selection="Ana"]')).toHaveCount(1);
  await a.mouse.move(api.x + 40, api.y + 120);
  await a.mouse.move(api.x + 60, api.y + 140);
  await expect(b.locator('[data-remote-pointer="Ana"]')).toBeVisible();
  // Nothing of the sort on the person's own screen.
  await expect(a.locator('[data-remote-pointer], [data-remote-selection]')).toHaveCount(0);
  // Deselecting clears it.
  await a.mouse.click(api.x + api.width + 300, api.y + 300);
  await expect(b.locator('[data-remote-selection="Ana"]')).toHaveCount(0);
});
