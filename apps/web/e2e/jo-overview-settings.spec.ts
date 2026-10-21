import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

test('Jo stays static on hover and has no interactive mascot controls', async ({ page }) => {
  await page.goto('/?lang=en');
  const jo = page.locator('.jo-illustration');
  await expect(jo).toBeVisible();
  await jo.hover();
  await expect(jo).toHaveCSS('animation-name','none');
  await expect(page.locator('.jo-hit, .jo-wave-displacement, .jo-open-eyes')).toHaveCount(0);
  await page.locator('.hero').evaluate(async element => {
    await Promise.all(element.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
  });
  expect(await axeFindings(page)).toEqual([]);
});

test('chat activity keeps Jo still while the status changes',async({page})=>{
  await page.goto('/app/?lang=en');
  await page.getByRole('button',{name:'AI chat',exact:true}).click();
  await page.evaluate(async()=>{const {chatStore}=await import('/src/chat/session.ts');chatStore.setState({status:'loading',activity:'thinking'});});
  const image=page.locator('.sk-jo-activity img');
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS('animation-name','none');
  await expect(image).toHaveCSS('transform','none');
  const source=await image.getAttribute('src');
  await page.evaluate(async()=>{const {chatStore}=await import('/src/chat/session.ts');chatStore.setState({activity:'applying'});});
  await expect(image).toHaveAttribute('src',source!);
  await expect(page.locator('.sk-jo-activity')).toContainText('Jo is applying');
  await expect(page.locator('.sk-jo-thoughts, .sk-jo-orbit')).toHaveCount(0);
});

for (const width of [1440,390]) test(`Overview toolbar stays inside the expanded canvas at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height:900 });
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async () => { const {workspace} = await import('/src/workspace/appWorkspace.ts'); await workspace.show({kind:'board'}); });
  const canvas = page.locator('#canvas');
  const bar = canvas.locator('header[data-embedded]');
  await expect(bar).toBeVisible();
  const box = (await canvas.boundingBox())!, toolbar = (await bar.boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(10);
  expect(box.height).toBeGreaterThan(870);
  expect(toolbar.x).toBeGreaterThanOrEqual(box.x);
  expect(toolbar.y).toBeGreaterThan(box.y);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(box.x + box.width);
  const tools = (await page.locator('.sk-overview-tools').boundingBox())!;
  const actions = (await bar.locator('.sk-topbar-group').boundingBox())!;
  expect(tools.y + tools.height <= actions.y || tools.y >= actions.y + actions.height || tools.x + tools.width <= actions.x).toBe(true);
  await bar.getByRole('button',{name:'Settings (⌘,)',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Settings',exact:true});
  const palette = dialog.getByRole('group',{name:'Accent color',exact:true});
  await expect(palette.locator('.sk-accent-swatch')).toHaveCount(7);
  const cobalt = palette.getByRole('button',{name:'Cobalt',exact:true});
  await cobalt.click();
  await expect(cobalt).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('html')).toHaveAttribute('data-accent','cobalt');
  await dialog.screenshot({ path:info.outputPath(`accent-${width}.png`),animations:'disabled' });
  await dialog.getByRole('button',{name:'Close settings'}).click();
  await page.screenshot({ path:info.outputPath(`overview-${width}.png`),animations:'disabled' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent','cobalt');
});

test('integration cards display provider icons without fetching provider assets', async ({ page }, info) => {
  const empty = { configured:false, hint:null };
  await page.route('**/api/integrations', route => route.fulfill({json:{ webhooks:{slack:{...empty,host:null,events:[]},teams:{...empty,host:null,events:[]},discord:{...empty,host:null,events:[]}},notion:{...empty,parentPageId:null},atlassian:{...empty,site:null,email:null},confluence:{spaceKey:null,parentId:null},jira:{projectKey:null,issueType:null}}}));
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async () => (await import('/src/settings/store.ts')).openSettings('integrations'));
  const dialog = page.getByRole('dialog',{name:'Settings',exact:true});
  for (const brand of ['slack','teams','discord']) await expect(dialog.locator(`[data-integration-icon="${brand}"] svg`)).toBeVisible();
  await dialog.screenshot({path:info.outputPath('integration-icons.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Notion, Confluence, and Jira'}).click();
  for (const brand of ['notion','atlassian']) await expect(dialog.locator(`[data-integration-icon="${brand}"] svg`)).toBeVisible();
});
