import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startCollabHost } from './support/collabHost';

test('an editor reconnects after a local host restart without losing Markdown', async ({ browser }) => {
  test.setTimeout(60_000);
  const host = await startCollabHost({ name: 'Reconnect', docs: { notes: { title: 'Notes', text: 'start' } } });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(host.invite);
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Notes' }).click();
    const editor = page.getByLabel('Editor do documento').locator('.cm-content');
    await expect(editor).toContainText('start');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' saved');
    await expect(editor).toContainText('start saved');
    // Loopback delivers the update in a few ms; the host's 1.5 s projection debounce has not fired yet.
    await page.waitForTimeout(300);
    await host.stop();
    // SIGTERM wrote the room's pending projection to disk before the host exited.
    expect(await readFile(join(host.root, '.arch', 'docs', 'notes.md'), 'utf8')).toBe('start saved');
    const reconnecting = page.getByRole('status').filter({ hasText: 'Reconectando…' });
    await expect(reconnecting).toBeVisible();
    await host.start();
    await expect(reconnecting).toHaveCount(0, { timeout: 15_000 });
    await expect(editor).toContainText('start saved');
    const newcomer = await browser.newContext();
    const other = await newcomer.newPage();
    await other.goto(host.invite);
    await other.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Notes' }).click();
    await expect(other.getByLabel('Editor do documento').locator('.cm-content')).toContainText('start saved');
    await newcomer.close();
    await context.close();
  } finally {
    await host.dispose();
  }
});
