import { expect, test } from '@playwright/test';
import { savedDiagram } from './storage';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

test('the workspace header owns the sidebar toggle and a closed sidebar can be reopened', async ({ page }) => {
  await page.goto('/app/');
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  const bar = page.getByRole('banner');
  await expect(sidebar.getByRole('button', { name: 'Menu do workspace' })).toBeVisible();
  await expect(bar.getByRole('button', { name: /barra lateral/ })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Exemplo', exact: true })).toHaveCount(0);
  await sidebar.getByRole('button', { name: /barra lateral/ }).click();
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: /Mostrar\/ocultar barra lateral/ }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /barra lateral/ })).toHaveAttribute('aria-pressed', 'true');
});

for (const orientation of [{ label: 'Horizontal', direction: 'right', axis: 'x' }, { label: 'Vertical', direction: 'down', axis: 'y' }] as const) {
  test(`composition honors ${orientation.label} and keeps it after reload`, async ({ page }, info) => {
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(JSON.stringify({ version: 1, style: { direction: orientation.direction === 'right' ? 'down' : 'right' }, nodes: [{ id: 'Web', icon: 'monitor' }, { id: 'API', icon: 'server' }, { id: 'Banco', icon: 'database' }], connections: [{ from: 'Web', to: 'API' }, { from: 'API', to: 'Banco' }] }));
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await page.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
    await page.getByRole('button', { name: 'Aparência do diagrama', exact: true }).click();
    const choices = page.getByRole('group', { name: 'Orientação da composição' });
    await choices.getByRole('button', { name: orientation.label, exact: true }).click();
    await expect(choices.getByRole('button', { name: orientation.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Compor arquitetura', exact: true }).click();
    await expect.poll(async () => {
      const saved = await savedDiagram(page);
      if (saved?.model.style.direction !== orientation.direction || saved.model.elements.Web?.presentation !== 'card') return false;
      const boxes = saved.layout.nodes;
      return Boolean(boxes.Web && boxes.API && boxes.Banco && boxes.Web[orientation.axis] < boxes.API[orientation.axis] && boxes.API[orientation.axis] < boxes.Banco[orientation.axis]);
    }).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('composition.png'), animations: 'disabled' });
    const before = (await savedDiagram(page))!;
    await page.reload();
    await expect(page.locator('.react-flow__node-card')).toHaveCount(3);
    await expect.poll(async () => (await savedDiagram(page))?.model.style.direction).toBe(orientation.direction);
    expect((await savedDiagram(page))!.layout.nodes).toEqual(before.layout.nodes);
  });
}
