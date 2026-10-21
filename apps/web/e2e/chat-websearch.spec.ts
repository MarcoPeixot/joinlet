import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

test.use({ reducedMotion: 'reduce' });
for (const [width, theme] of [[1680, 'dark'], [390, 'dark'], [1680, 'light']] as const) {
  test(`web search progress, sources and persistence at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => {
      localStorage.setItem('strukt:theme', theme);
      const original = window.fetch;
      window.fetch = async (...args) => {
        if (!String(args[0]).endsWith('/api/ai/chat')) return original(...args);
        return new Response(new ReadableStream({ start(controller) {
          const state = window as unknown as { searchEvent: (event: unknown) => void; searchDone: () => void };
          state.searchEvent = event => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
          state.searchDone = () => controller.close();
        } }), { headers: { 'content-type': 'application/x-ndjson' } });
      };
    }, theme);
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Pesquise as recomendações atuais do PostgreSQL');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.waitForFunction(() => typeof (window as unknown as { searchEvent?: unknown }).searchEvent === 'function');
    await page.evaluate(() => (window as unknown as { searchEvent: (event: unknown) => void }).searchEvent({ search: { query: 'site:postgresql.org documentation', status: 'searching' } }));
    await expect(panel.getByText('Pesquisando na web…', { exact: true })).toBeVisible();
    await expect(panel.getByText('site:postgresql.org documentation', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('chat-web-search-progress.png'), animations: 'disabled' });
    expect(await axeFindings(page)).toEqual([]);
    await page.evaluate(() => {
      const state = window as unknown as { searchEvent: (event: unknown) => void; searchDone: () => void };
      state.searchEvent({ search: { query: 'site:postgresql.org documentation', status: 'complete', count: 1 } });
      state.searchEvent({ t: 'Consulte a [documentação oficial](https://www.postgresql.org/docs/).' });
      state.searchEvent({ done: true }); state.searchDone();
    });
    const source = panel.getByRole('link', { name: 'documentação oficial', exact: true });
    await expect(source).toHaveAttribute('href', 'https://www.postgresql.org/docs/');
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(panel.getByText('Pesquisando na web…', { exact: true })).toHaveCount(0);
    await page.reload();
    if (!await panel.isVisible()) await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    await expect(source).toHaveAttribute('href', 'https://www.postgresql.org/docs/');
  });
}
