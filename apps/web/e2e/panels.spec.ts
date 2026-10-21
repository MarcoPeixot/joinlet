import { expect, test } from '@playwright/test';
import type { PanelName } from './panelMenu';
import { panelsTrigger, togglePanel } from './panelMenu';

const toggles: { item: PanelName; panel: string }[] = [
  { item: 'Versões', panel: 'Versões' },
  { item: 'Fluxos', panel: 'Fluxos guiados' },
  { item: 'Modelo', panel: 'Modelo de arquitetura' },
  { item: 'Precisão', panel: 'Precisão da arquitetura' },
  { item: 'Perspectivas', panel: 'Perspectivas' },
  { item: 'Comentários', panel: 'Comentários' },
  { item: 'Linha do tempo', panel: 'Linha do tempo' },
  { item: 'GitHub', panel: 'GitHub' },
];

test('the Painéis menu checks only the visible right-hand panel and the trigger names it', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  const checked = async () => {
    await panelsTrigger(page).click();
    const items = page.getByRole('menuitemcheckbox');
    const names: string[] = [];
    for (const item of await items.all()) if ((await item.getAttribute('aria-checked')) === 'true') names.push((await item.textContent()) ?? '');
    await page.keyboard.press('Escape');
    return names;
  };

  for (const { item, panel } of toggles) {
    await togglePanel(page, item);
    await expect(page.getByRole('complementary', { name: panel, exact: true })).toBeVisible();
    await expect(page.locator('aside[aria-label]')).toHaveCount(1);
    await expect(panelsTrigger(page)).toHaveAccessibleName(`Painéis: ${item}`);
    const on = await checked();
    expect(on).toHaveLength(1);
    expect(on[0]).toMatch(new RegExp(`^${item}`));
  }

  await togglePanel(page, 'GitHub');
  await expect(page.locator('aside[aria-label]')).toHaveCount(0);
  await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis');
  expect(await checked()).toHaveLength(0);
});


test('the simplified toolbar has no flow or eye control, and code stays usable beside panels on narrow windows',async({page})=>{
 await page.setViewportSize({width:900,height:900});
 await page.goto('/app/');await expect(page.locator('[data-id="Kafka"]')).toBeVisible();
 const toolbar=page.getByRole('toolbar',{name:'Ferramentas do diagrama'});
 await expect(toolbar.getByRole('button',{name:'Animar fluxo'})).toHaveCount(0);
 await expect(toolbar.getByRole('button',{name:'Perspectivas',exact:true})).toHaveCount(0);
 await toolbar.getByRole('button',{name:'Mostrar/ocultar código'}).click();
 const code=page.getByRole('complementary',{name:'Código',exact:true});await expect(code).toBeVisible();
 const editor=code.locator('.cm-content');
 await editor.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' invalid draft');
 await togglePanel(page,'Modelo');
 await expect(page.getByRole('complementary',{name:'Modelo de arquitetura'})).toBeVisible();
 await expect.poll(async()=>(await page.locator('#canvas').boundingBox())!.width).toBeGreaterThanOrEqual(420);
 await expect(editor).toContainText('invalid draft');
 await page.setViewportSize({width:1440,height:900});
 await expect(editor).toContainText('invalid draft');
 await page.setViewportSize({width:390,height:844});
 await expect(code).toBeVisible();
 const box=(await code.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await expect(editor).toContainText('invalid draft');
 await code.getByRole('button',{name:'Fechar código'}).click();await expect(code).toHaveCount(0);
});

test('selection properties return after chat closes, and chat follows a document without duplicate panels',async({page})=>{
 await page.goto('/app/');await expect(page.locator('[data-id="Kafka"]')).toBeVisible();
 await page.locator('.react-flow__node[data-id="Kafka"]').click();
 const inspector=page.getByRole('complementary',{name:'Propriedades',exact:true});await expect(inspector).toBeVisible();
 await page.getByRole('button',{name:'Chat com a IA',exact:true}).click();
 const chat=page.getByRole('complementary',{name:'Chat com a IA',exact:true});await expect(chat).toBeVisible();
 await expect(inspector).toHaveCount(0);
 await chat.getByRole('button',{name:'Fechar chat',exact:true}).click();await expect(inspector).toBeVisible();
 await page.getByRole('button',{name:'Chat com a IA',exact:true}).click();await expect(chat).toBeVisible();
 await page.evaluate(async()=>{const{workspace}=await import('/src/workspace/appWorkspace.ts');await workspace.create('doc','Painéis','# Documento');await workspace.flush();});
 await expect(page.getByLabel('Editor do documento')).toBeVisible();await expect(chat).toBeVisible();
 await expect(page.locator('aside[aria-label]')).toHaveCount(1);
 await chat.getByRole('button',{name:'Fechar chat',exact:true}).click();await expect(chat).toHaveCount(0);
});
