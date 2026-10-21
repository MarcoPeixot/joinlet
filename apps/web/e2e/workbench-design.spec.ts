import { expect, test } from '@playwright/test';
for (const theme of ['dark', 'light'] as const) {
  test(`integrated ${theme} workspace keeps navigation, chat, documents and the original inspector usable`, async ({ page }, info) => {
    await page.addInitScript((theme) => localStorage.setItem('strukt:theme', theme), theme);
    await page.goto('/app/');
    const kafka = page.locator('.react-flow__node[data-id="Kafka"]');
    await expect(kafka).toBeVisible();
    const header = page.getByRole('banner');
    expect(await header.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('0px');
    await expect(page.getByLabel('Localização atual')).toHaveCount(0);
    expect((await page.getByRole('main').boundingBox())!.y).toBe(8);
    expect(await page.locator('.sk-topbar-group').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('1px');
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await expect(chat.getByRole('textbox', { name: 'Mensagem para a IA' })).toBeVisible();
    await expect.poll(async () => Math.round((await chat.boundingBox())!.width)).toBe(376);
    await expect.poll(async () => Math.round((await chat.boundingBox())!.x + (await chat.boundingBox())!.width)).toBe(1672);
    const bounds = (await chat.boundingBox())!, top = (await header.boundingBox())!;
    expect(bounds.y).toBe(8);
    expect(top.x + top.width).toBeLessThan(bounds.x);
    expect(Math.round(bounds.x + bounds.width)).toBe(1672);
    expect(await chat.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('10px');
    await page.screenshot({ path: info.outputPath('workspace-chat.png'), animations: 'disabled' });
    await chat.getByRole('button', { name: 'Fechar chat', exact: true }).click();
    await kafka.click();
    const properties = page.getByRole('complementary', { name: 'Propriedades', exact: true });
    await expect(properties).toBeVisible();
    expect((await properties.boundingBox())!.width).toBe(360);
    await properties.getByRole('button', { name: 'Fechar propriedades', exact: true }).click();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
    await page.getByRole('textbox', { name: /documento/i }).fill('Visão geral');
    await page.keyboard.press('Enter');
    await page.locator('.cm-content').fill('# Arquitetura da plataforma\n\nUma visão clara dos serviços, das decisões e de como os dados percorrem o sistema.\n\n## Componentes\n\n- API de perguntas\n- Busca semântica\n- Banco vetorial');
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    await expect(chat).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('documents-chat.png'), animations: 'disabled' });
  });
}
for (const width of [1024, 768, 390, 320]) {
  test(`workspace actions remain reachable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('strukt:theme', 'dark'));
    await page.goto('/app/');
    await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
    const header = page.getByRole('banner');
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await expect(chat.getByRole('textbox', { name: 'Mensagem para a IA' })).toBeVisible();
    await expect.poll(async () => (await chat.boundingBox())!.x + (await chat.boundingBox())!.width).toBeLessThanOrEqual(width + 0.5);
    const box = (await chat.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('responsive-workspace.png'), animations: 'disabled' });
  });
}

for (const width of [1680, 1024, 768, 390, 320]) {
  test(`${width}px: icon actions stay inside the canvas and Code belongs to its palette`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('strukt:theme', 'dark'));
    await page.goto('/app/');
    const actions = page.locator('.sk-topbar-group');
    const palette = page.getByRole('toolbar', { name: 'Ferramentas do diagrama', exact: true });
    await expect(actions.getByRole('button', { name: 'Comandos (⌘K)', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: 'Mostrar/ocultar código', exact: true })).toHaveCount(0);
    await expect(palette.getByRole('button', { name: 'Mostrar/ocultar código', exact: true })).toBeAttached();
    expect((await actions.innerText()).trim()).toBe('');
    await actions.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const main = page.getByRole('main');
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await expect(chat).toBeVisible();
    await expect.poll(async () => {
      const a = (await actions.boundingBox())!, m = (await main.boundingBox())!;
      return a.x >= m.x && a.x + a.width <= m.x + m.width;
    }).toBe(true);
    if (width >= 640) {
      await expect.poll(async () => {
        const a = (await actions.boundingBox())!, c = (await chat.boundingBox())!;
        return a.x + a.width < c.x;
      }).toBe(true);
      expect((await chat.boundingBox())!.y).toBe(8);
    }
    const firstRun = page.getByRole('status', { name: 'Primeiro acesso', exact: true });
    if (await firstRun.isVisible()) {
      const chip = (await firstRun.boundingBox())!, a = (await actions.boundingBox())!;
      expect(chip.y).toBeGreaterThanOrEqual(a.y + a.height);
    }
    await page.screenshot({ path: info.outputPath('canvas-icon-actions.png'), animations: 'disabled' });
    await chat.getByRole('button', { name: 'Fechar chat', exact: true }).click();
    if (width >= 1024) {
      await palette.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
      await expect(page.locator('.cm-content')).toBeVisible();
      await expect(palette.getByRole('button', { name: 'Mostrar/ocultar código', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await palette.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
      await expect(page.locator('.cm-content')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
