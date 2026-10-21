import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

test.describe('Joinlet landing', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

  test('presents the current workspace and opens the editor', async ({ page }, info) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Joinlet — conecte ideias, construa sistemas');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://joinlet.co/');
    const mascot = page.locator('.hero-illustration img.jo-illustration');
    await expect(mascot).toBeVisible();
    expect(await mascot.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return image.naturalWidth > 0;
    })).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('diagramas claros.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await mascot.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    {
      const reviewDir = process.env.STRUKT_LANDING_REVIEW_DIR ?? info.outputDir;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(reviewDir, 'desktop.png'), fullPage: true });
      await page.screenshot({ path: join(reviewDir, 'desktop-viewport.png') });
    }
    await page.getByRole('link', { name: 'Abrir o app', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('explores documents and sketches, then returns to the same diagram', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.getByRole('complementary', { name: 'Itens do workspace de demonstração' });
    await sidebar.getByRole('button', { name: 'Documentos', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Prévia de documento' })).toContainText('Eventos que conectam');
    await sidebar.getByRole('button', { name: 'Sketches', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Prévia de sketch' })).toContainText('Rascunhe. Conecte. Repense.');
    await sidebar.getByRole('button', { name: 'Diagramas', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Diagrama de arquitetura do exemplo' })).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key !== 'joinlet:locale'))).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  });

  test('reviews a proposal and carries it through the diagram, repository, context and download', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pedidos: mostrar no código', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.code-line[data-active]').first()).toContainText('{');
    await page.getByRole('button', { name: 'Mostrar conversa de exemplo' }).click();
    await page.getByRole('button', { name: /Adicione um serviço de Notificações/ }).click();
    const review = page.getByRole('group', { name: 'Revisão da proposta' });
    await expect(review).toContainText('1 componente, 1 conexão');
    await expect(page.getByRole('button', { name: 'Notificações: mostrar no código' })).toHaveAttribute('data-diff', 'added');
    await review.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Proposta aplicada ao diagrama.' })).toBeAttached();
    await expect(page.locator('.repo')).toHaveAttribute('data-applied', 'true');
    await page.locator('#agentes > summary').click();
    await page.locator('.agent-source summary').click();
    await expect(page.getByRole('region', { name: 'Conteúdo de ARCHITECTURE.md' })).toContainText('Notificações');
    await page.getByRole('button', { name: 'Mostrar código do diagrama' }).click();
    await expect(page.locator('.code-line[data-added]').first()).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.locator('#repositorio > summary').click();
    await page.getByRole('button', { name: 'Baixar pedidos.strukt.json', exact: true }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toBe('pedidos.strukt.json');
    const json = JSON.parse(readFileSync((await file.path())!, 'utf8'));
    expect(json.nodes.some((node: { id: string }) => node.id === 'Notificações')).toBe(true);
    expect(json.connections.some((edge: { from: string; to: string }) => edge.from === 'Kafka' && edge.to === 'Notificações')).toBe(true);
    await page.getByRole('button', { name: 'Mostrar conversa de exemplo' }).click();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(page.locator('.repo')).not.toHaveAttribute('data-applied');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key !== 'joinlet:locale'))).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  });

  test('discarding a proposal keeps the original diagram', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Adicione um serviço de Notificações/ }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Notificações: mostrar no código' })).toHaveCount(0);
  });

  test('starts in cream and shares an explicit theme choice with the editor', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Usar tema escuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('strukt:theme'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/app/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  for (const theme of ['dark', 'light']) {
    test(`accessible contrast and controls in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('strukt:theme', value), theme);
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      expect(await axeFindings(page)).toEqual([]);
      await page.getByRole('button', { name: 'Documentos', exact: true }).click();
      expect(await axeFindings(page)).toEqual([]);
      await page.getByRole('button', { name: 'Sketches', exact: true }).click();
      expect(await axeFindings(page)).toEqual([]);
    });
  }

  test('explains provider setup with a keyboard-operable disclosure', async ({ page }) => {
    await page.goto('/');
    const question = page.locator('summary').filter({ hasText: 'Posso escolher o modelo e o provedor de IA?' });
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(question.locator('..')).toHaveAttribute('open', '');
    await expect(question.locator('..')).toContainText('OpenCode Go');
    await expect(question.locator('..')).toContainText('Use sua própria chave');
    await page.locator('#agentes > summary').click();
    await page.locator('.agent-setup summary').click();
    await expect(page.getByRole('list', { name: 'Como conectar um agente' }).getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('Joinlet landing on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

  test('keeps the CTA usable, offers all previews and closes navigation after a selection', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Abrir o app', exact: true })).toBeInViewport();
    const tabs = page.getByRole('group', { name: 'Explorar o workspace' });
    await tabs.getByRole('button', { name: 'Documentos', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Prévia de documento' })).toBeVisible();
    await tabs.getByRole('button', { name: 'Sketches', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Prévia de sketch' })).toBeVisible();
    await tabs.getByRole('button', { name: 'Diagramas', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    {
      const reviewDir = process.env.STRUKT_LANDING_REVIEW_DIR ?? info.outputDir;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(reviewDir, 'mobile.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fechar menu' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('navigation').getByRole('link', { name: 'Para agentes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/#agentes$/);
    await expect(page.getByRole('heading', { name: 'O agente entende o sistema. Antes de mudar o código.' })).toBeVisible();
    expect(await axeFindings(page)).toEqual([]);
  });

  test('Escape dismisses the mobile menu and restores its trigger', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Produto', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});

for (const width of [320, 900]) {
  test(`all product previews remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    for (const [label, region] of [['Diagramas', 'Diagrama de arquitetura do exemplo'], ['Documentos', 'Prévia de documento'], ['Sketches', 'Prévia de sketch']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole(label === 'Diagramas' ? 'group' : 'region', { name: region })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    expect(await axeFindings(page)).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('link', { name: 'Abrir o app', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
}

test('provider carousel moves continuously, pauses, and becomes a single static list with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const rail = page.locator('.provider-conveyor');
  await page.locator('.provider-strip').scrollIntoViewIfNeeded();
  const before = await rail.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => rail.evaluate(el => getComputedStyle(el).transform)).not.toBe(before);
  await page.getByRole('button', { name: 'Pausar carrossel de provedores' }).click();
  await expect(rail).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Retomar carrossel de provedores' }).click();
  await expect(rail).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(rail).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.provider-track[aria-hidden=true]')).toBeHidden();
  const providers = page.getByRole('list', { name: 'Provedores de IA disponíveis' });
  await expect(providers.getByRole('listitem')).toHaveCount(9);
  for (const name of ['Google Gemini', 'DeepSeek', 'Groq', 'Mistral AI']) await expect(providers.getByText(name, { exact: true })).toBeVisible();
});
