import { expect, test } from '@playwright/test';
import { savedDiagram } from './storage';
import { axeFindings } from './support/axe';

test.use({ reducedMotion: 'reduce' });

test('selecting a component opens the original right-hand inspector without bottom buttons', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('strukt:theme', 'dark'));
  await page.goto('/app/');
  const kafka = page.locator('.react-flow__node[data-id="Kafka"]');
  await expect(kafka).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assistente de IA (⌘J)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Visualizar detalhes', exact: true })).toHaveCount(0);
  const panel = page.getByRole('complementary', { name: 'Propriedades', exact: true });
  await expect(panel).toHaveCount(0);
  await kafka.click();
  await expect(panel.getByRole('heading', { name: 'Nó', exact: true })).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x + (await panel.boundingBox())!.width)).toBe(1663);
  const bounds = (await panel.boundingBox())!;
  expect(bounds.width).toBe(360);
  expect(bounds.y).toBeLessThan(100);
  expect(bounds.height).toBeGreaterThan(700);
  await panel.getByRole('tab', { name: 'Editar', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Tecnologia', exact: true })).toBeAttached();
  await panel.getByRole('tab', { name: 'Visão', exact: true }).click();
  await page.screenshot({ path: info.outputPath('right-inspector.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Fechar propriedades', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: component editing persists, overview follows the content and advanced controls remain available`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('strukt:theme', value), theme);
    await page.goto('/app/');
    await page.locator('.react-flow__node[data-id="Pedidos"]').click();
    const panel = page.getByRole('complementary', { name: 'Propriedades', exact: true });
    await panel.getByRole('tab', { name: 'Editar', exact: true }).click();
    const label = panel.getByRole('textbox', { name: 'Rótulo', exact: true });
    await label.fill('Serviço de pedidos');
    await label.press('Enter');
    const tech = panel.getByRole('textbox', { name: 'Tecnologia', exact: true });
    await tech.fill('Node.js · PostgreSQL');
    await tech.press('Enter');
    const description = panel.getByRole('textbox', { name: 'Descrição', exact: true });
    const text = 'Gerencia o ciclo de vida dos pedidos, valida o estoque e publica eventos para os serviços de pagamento e entrega.';
    await description.fill(text);
    await tech.focus();
    await expect.poll(async () => (await savedDiagram(page))?.model.elements.Pedidos?.description).toBe(text);
    await expect.poll(() => panel.locator('[role="tabpanel"][data-state="active"]').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    expect(await axeFindings(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('component-edit.png'), animations: 'disabled' });
    await panel.getByRole('tab', { name: 'Visão', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Serviço de pedidos', exact: true })).toBeVisible();
    await expect(panel.getByText(text, { exact: true })).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Saídas' }).getByRole('button')).toHaveCount(3);
    await expect.poll(() => panel.locator('[role="tabpanel"][data-state="active"]').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    expect(await axeFindings(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('component-overview.png'), animations: 'disabled' });
    await panel.getByRole('button', { name: 'Editar', exact: true }).click();
    const shared = panel.locator('details').filter({ has: page.locator('summary', { hasText: 'Modelo e compartilhamento' }) });
    await shared.locator('summary').click();
    await expect(panel.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Pedidos');
    await expect(panel.getByRole('combobox', { name: 'Nível C4', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Fechar propriedades', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await savedDiagram(page))?.model.elements.Pedidos?.description).not.toBe(text);
  });
}

test('linked documentation opens from the overview and group details remain contextual', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/');
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('button', { name: 'Novo documento', exact: true }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Contrato de eventos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeVisible();
  await nav.getByRole('button', { name: 'Exemplo', exact: true }).click();
  await page.locator('.react-flow__node[data-id="Kafka"]').click();
  const panel = page.getByRole('complementary', { name: 'Propriedades', exact: true });
  await panel.getByRole('button', { name: 'Adicionar descrição', exact: true }).click();
  const links = panel.locator('details').filter({ has: page.locator('summary', { hasText: 'Vínculos e documentação' }) });
  await links.locator('summary').click();
  await panel.getByRole('combobox', { name: 'Documento', exact: true }).selectOption({ label: 'Contrato de eventos' });
  await panel.getByRole('tab', { name: 'Visão', exact: true }).click();
  await panel.getByRole('button', { name: 'Contrato de eventos Abrir documento' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await nav.getByRole('button', { name: 'Exemplo', exact: true }).click();
  await page.locator('.react-flow__node[data-id="Serviços"] .strukt-group__title').click();
  await expect(panel.getByRole('heading', { name: 'Grupo', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Sobre o grupo', exact: true })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Saídas' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('group-overview.png'), animations: 'disabled' });
});

for (const width of [320, 390]) {
  test(`${width}px: editing and advanced fields stay usable without horizontal scrolling`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/');
    await page.locator('.react-flow__node[data-id="Kafka"]').click();
    const panel = page.getByRole('complementary', { name: 'Propriedades', exact: true });
    await panel.getByRole('tab', { name: 'Editar', exact: true }).click();
    const description = panel.getByRole('textbox', { name: 'Descrição', exact: true });
    await description.fill('Distribui eventos entre os serviços.');
    await description.blur();
    await expect.poll(async () => (await savedDiagram(page))?.model.elements.Kafka?.description).toBe('Distribui eventos entre os serviços.');
    const advanced = panel.locator('details').filter({ has: page.locator('summary', { hasText: 'Aparência avançada' }) });
    await advanced.locator('summary').click();
    await expect(advanced.getByRole('group', { name: 'Fonte do elemento', exact: true })).toBeVisible();
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`mobile-${width}-edit.png`), animations: 'disabled' });
  });
}
