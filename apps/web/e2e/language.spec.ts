import { expect, test } from '@playwright/test';

test('language persists from landing to app and preserves the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Idioma' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('heading',{level:1})).toContainText('clear diagrams.');
  await expect(page).toHaveTitle('Joinlet — connect ideas, build systems');
  await page.getByRole('link',{name:'Open app',exact:true}).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
  await page.evaluate(async()=> {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    workspace.setName('Minha arquitetura — keep this');
    await workspace.flush();
  });
  await page.getByRole('combobox',{name:'Language'}).selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
  await expect(page.getByRole('button',{name:'Menu do workspace'})).toContainText('Minha arquitetura — keep this');
  await expect(page.locator('.react-flow__node[data-id="Pedidos"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
});

test('English settings, Overview and chat use the selected language', async ({ page }) => {
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.getByRole('button',{name:'Settings (⌘,)',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await expect(dialog.getByRole('heading',{name:'General',exact:true})).toBeVisible();
  await expect(dialog.getByText('Reduce motion',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Language'})).toHaveValue('en');
  await dialog.getByRole('button',{name:'Close settings'}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await expect(page.locator('body')).not.toContainText('Quadro');
  await page.getByRole('button',{name:'AI chat',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message to AI'})).toBeVisible();
});

test('the primary demo exposes component context and its editable example', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByRole('button', { name: 'Orders: show in code', exact: true }).click();
  await expect(page.locator('.code-line[data-active]').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open this example', exact: true })).toHaveAttribute('href', /example=orders/);
});

for (const width of [320,390]) test(`English landing fits ${width}px`, async ({page})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/?lang=en');
  await expect(page.getByRole('combobox',{name:'Language'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('Jo shows pending activity, respects reduced motion, and disappears on stop', async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  let release!:()=>void;
  await page.route('**/api/ai/chat',async route=>{
    await new Promise<void>(resolve=>{release=resolve;});
    await route.fulfill({contentType:'application/x-ndjson',body:'{"t":"Done"}\n{"done":true}\n'}).catch(()=>{});
  });
  await page.goto('/app/?lang=en');
  await page.getByRole('button',{name:'AI chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message to AI'}).fill('Review my architecture');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const activity=page.locator('.sk-jo-activity');
  await expect(activity).toHaveAttribute('data-phase','thinking');
  await expect(activity).toContainText('Jo is thinking');
  expect(await activity.locator('img').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(activity).toHaveCount(0);
  release();
});

test('English built-in templates remain discoverable and can be selected', async ({page})=>{
  await page.goto('/app/?lang=en');
  await page.getByRole('button',{name:'Diagram templates',exact:true}).click();
  await page.getByRole('menuitem',{name:'Explore templates',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Diagram templates'});
  await expect(dialog.getByRole('button',{name:'View template Microservices'})).toBeVisible();
  await dialog.getByRole('button',{name:'View template Microservices'}).click();
  await expect(dialog.getByRole('heading',{name:'Microservices'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Use template',exact:true})).toBeEnabled();
});
