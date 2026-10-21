import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startCollabHost } from './support/collabHost';
import type { CollabHost } from './support/collabHost';

let host: CollabHost;
test.beforeEach(async () => {
  host = await startCollabHost({ name: 'Documentos', docs: { um: { title: 'Um', text: 'Primeiro' }, dois: { title: 'Dois', text: 'Segundo' } } });
});
test.afterEach(async () => { await host?.dispose(); });
async function split(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Um', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Primeiro');
  await page.getByRole('button', { name: 'Dividir documentos', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dois', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(2);
  await expect(page.locator('.sk-doc-pane').last().locator('.cm-content')).toContainText('Segundo');
}
test('both split documents synchronize through their rooms, including edits in the inactive pane', async ({ browser }) => {
  test.setTimeout(60_000);
  const a = await browser.newContext(); const b = await browser.newContext();
  try {
    const first = await a.newPage(); const second = await b.newPage();
    await Promise.all([split(first, host.invite), split(second, host.invite)]);
    const editor = (page: Page, title: string) => page.getByRole('region', { name: `Documento: ${title}`, exact: true }).locator('.cm-content');
    await editor(first, 'Um').fill('Primeiro editado em A');
    await expect(editor(second, 'Um')).toHaveText('Primeiro editado em A');
    await editor(second, 'Dois').fill('Segundo editado em B');
    await expect(editor(first, 'Dois')).toHaveText('Segundo editado em B');
    await expect.poll(() => readFile(join(host.root, '.arch/docs/um.md'), 'utf8')).toBe('Primeiro editado em A');
    await expect.poll(() => readFile(join(host.root, '.arch/docs/dois.md'), 'utf8')).toBe('Segundo editado em B');
    await first.getByRole('region', { name: 'Documento: Dois', exact: true }).getByRole('button', { name: 'Fechar divisão', exact: true }).click();
    await expect(first.locator('.cm-content')).toHaveCount(1);
    await editor(second, 'Dois').fill('Segundo continua compartilhado');
    await expect(first.locator('.cm-content')).toHaveText('Segundo continua compartilhado');
  } finally { await a.close(); await b.close(); }
});
test('a view-only guest can compare and export two documents without gaining editing actions', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await split(page, host.viewInvite);
    for (const editor of await page.locator('.cm-content').all()) {
      await expect(editor).toHaveAttribute('contenteditable', 'true'); // Selectable for reading; CodeMirror state is read-only.
      await editor.click(); await page.keyboard.type(' proibido');
    }
    await expect(page.locator('.cm-content').first()).toHaveText('Primeiro');
    await expect(page.locator('.cm-content').last()).toHaveText('Segundo');
    await expect(page.getByRole('button', { name: 'Mostrar formatação', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toHaveCount(2);
  } finally { await context.close(); }
});
