import { expect, test } from '@playwright/test';
import { savedDiagram } from './storage';

const panelOf = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
test.use({ reducedMotion: 'reduce' });

test('a selected component copies as a transparent PNG and ordinary copy still duplicates it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app/');
  await page.locator('.react-flow__node[data-id="Kafka"]').click();
  await page.getByRole('button', { name: 'Copiar imagem transparente (⌘⇧C)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imagem copiada' }).first()).toBeVisible();
  const pixels = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType('image/png');
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { cornerAlpha: data[3], drawn: data.some((v, i) => i % 4 === 3 && v > 0), width: image.width, height: image.height };
  });
  expect(pixels.cornerAlpha).toBe(0); expect(pixels.drawn).toBe(true); expect(pixels.width).toBeLessThan(800); expect(pixels.height).toBeLessThan(800);
  const before = (await savedDiagram(page))!.model.order.length;
  await page.evaluate(() => navigator.clipboard.writeText('Anterior'));
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png')))).toBe(true);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await savedDiagram(page))!.model.order.length).toBe(before + 1);
});

test('presentation explores a component flow with playback, direction and no model changes', async ({ page }, info) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  const before = (await savedDiagram(page))!.model;
  await page.locator('#canvas').focus(); await page.keyboard.press('p');
  const bar = page.getByRole('region', { name: 'Apresentação', exact: true });
  await bar.getByRole('button', { name: 'Explorar fluxo', exact: true }).click();
  await page.locator('.react-flow__node[data-id="Kafka"]').click();
  await bar.getByRole('button', { name: 'Pausar fluxo', exact: true }).click();
  await expect(bar).toContainText('Kafka');
  await bar.getByRole('button', { name: 'Próximo passo (→)', exact: true }).click();
  await expect(page.locator('.react-flow__edge.sk-focus-edge')).toHaveCount(1);
  await page.getByRole('button', { name: 'Antes', exact: true }).click();
  await bar.getByRole('button', { name: 'Pausar fluxo', exact: true }).click();
  await bar.getByRole('button', { name: 'Próximo passo (→)', exact: true }).click();
  await expect(page.locator('.react-flow__edge[data-id="Pedidos→Kafka"]')).toHaveClass(/sk-focus-edge/);
  await page.screenshot({ path: info.outputPath('presentation-flow.png'), animations: 'disabled' });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await savedDiagram(page))!.model).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('banner')).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: the three panes resize by keyboard, retain their widths and fit the viewport`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('strukt:theme', value), theme);
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = panelOf(page), main = page.getByRole('main');
    await expect(chat).toBeVisible();
    const left = page.getByRole('separator', { name: 'Redimensionar sidebar', exact: true });
    await left.focus(); await page.keyboard.press('ArrowRight');
    await expect(left).toHaveAttribute('aria-valuenow', '280');
    const right = page.getByRole('separator', { name: 'Redimensionar painel lateral', exact: true });
    await right.focus(); await page.keyboard.press('ArrowLeft');
    await expect(right).toHaveAttribute('aria-valuenow', '404');
    await expect.poll(async () => Math.round((await chat.boundingBox())!.x + (await chat.boundingBox())!.width)).toBe(1672);
    const handle = (await right.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, 300); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 32, 300, { steps: 4 }); await page.mouse.up();
    await expect(right).toHaveAttribute('aria-valuenow', '436');
    await page.mouse.move(800, 700); await main.focus();
    await expect.poll(async () => Math.round((await chat.boundingBox())!.width)).toBe(428);
    await expect.poll(async () => Math.round((await chat.boundingBox())!.x + (await chat.boundingBox())!.width)).toBe(1672);
    const c = (await chat.boundingBox())!, m = (await main.boundingBox())!;
    expect(m.x + m.width).toBeLessThan(c.x); expect(Math.round(c.x + c.width)).toBe(1672); expect(m.y).toBe(8); const toolbar = (await page.getByRole('banner').boundingBox())!; expect(c.y).toBe(8); expect(toolbar.x + toolbar.width).toBeLessThan(c.x);
    await page.screenshot({ path: info.outputPath('three-pane-workbench.png'), animations: 'disabled' });
    await page.reload();
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    await expect(left).toHaveAttribute('aria-valuenow', '280'); await expect(right).toHaveAttribute('aria-valuenow', '436');
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    expect((await main.boundingBox())!.width).toBeGreaterThan(380);
  });
}

test('chat displays streaming text, preserves drafts across sessions and reloads, and renames history', async ({ page }, info) => {
  await page.addInitScript(() => {
    const real = window.fetch;
    window.fetch = async (...args) => {
      if (String(args[0]).includes('/api/ai/chat')) {
        const stream = new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ t: 'Resposta parcial em tempo real.' }) + '\n'));
          args[1]?.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Cancelado', 'AbortError')); } catch {} });
        } });
        return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return real(...args);
    };
  });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  const chat = panelOf(page), input = chat.getByRole('textbox', { name: 'Mensagem para a IA', exact: true });
  await input.fill('Documentar o fluxo de eventos'); await input.press('Enter');
  await expect(chat.locator('[data-role="assistant"]')).toContainText('Resposta parcial em tempo real.');
  await expect(chat.getByText('Respondendo…', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await input.fill('Este é um rascunho independente.');
  await page.reload();
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await expect(input).toHaveValue('Este é um rascunho independente.');
  await chat.getByRole('button', { name: 'Ver todas as conversas', exact: true }).click();
  await chat.getByRole('textbox', { name: 'Buscar conversas', exact: true }).fill('eventos');
  await chat.getByRole('button', { name: 'Ações de Documentar o fluxo de eventos', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Renomear conversa', exact: true }).click();
  const name = chat.getByRole('textbox', { name: 'Nome da conversa', exact: true });
  await name.fill('Arquitetura de eventos'); await name.press('Enter');
  await chat.getByRole('button', { name: /Arquitetura de eventos Hoje/, exact: true }).click();
  await expect(chat.locator('[data-role="assistant"]')).toContainText('Resposta parcial em tempo real.');
  await expect(chat.getByText('Resposta interrompida.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chat-conversation.png'), animations: 'disabled' });
  await chat.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await expect(input).toHaveValue('Este é um rascunho independente.');
  await page.screenshot({ path: info.outputPath('chat-home-and-history.png'), animations: 'disabled' });
});
