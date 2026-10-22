import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

test('documentation searches locally and switches language on the same guide',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/docs/');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.getByRole('searchbox',{name:'Search documentation'}).fill('MCP');
  await page.locator('#search-results').getByRole('link',{name:/Connect coding agents/}).click();
  await expect(page).toHaveURL(/\/docs\/en\/mcp\/$/);
  await page.getByRole('link',{name:'PT-BR',exact:true}).click();
  await expect(page).toHaveURL(/\/docs\/pt-BR\/mcp\/$/);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Conectar agentes de código pelo MCP');
  await page.getByRole('searchbox').fill('nãoexistetalguia');
  await expect(page.locator('#search-results')).toContainText('Nenhum resultado');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-results')).toBeHidden();
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({path:info.outputPath('documentation-desktop.png')});
  expect(errors).toEqual([]);
});

test('mobile documentation is navigable, readable and supports dark mode',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/docs/pt-BR/quickstart/');
  await expect(page.locator('.docs-menu')).not.toHaveAttribute('open','');
  await page.locator('summary').click();
  await page.getByRole('navigation',{name:'Documentação',exact:true}).getByRole('link',{name:'Referência da CLI',exact:true}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Referência da CLI');
  await page.getByRole('button',{name:'Alternar tema de cores'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({path:info.outputPath('documentation-mobile.png')});
});

test.describe('static documentation',()=>{
  test.use({javaScriptEnabled:false});
  test('direct guide links and language navigation work without JavaScript',async({page})=>{
    const response=await page.goto('/docs/en/workspaces/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading',{name:'Workspaces and storage',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'PT-BR',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Workspaces e armazenamento',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.locator('article')).toContainText('2 MB');
  });
});

test('landing and editor link to documentation in the chosen language',async({page})=>{
  await page.goto('/?lang=en');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Documentation'}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Joinlet documentation');
  await page.goto('/app/?lang=pt-BR');
  await page.evaluate(async()=>{(await import('/src/settings/store.ts')).openSettings('general');});
  await expect(page.getByRole('dialog',{name:'Configurações',exact:true}).getByRole('link',{name:'Documentação'})).toHaveAttribute('href','/docs/pt-BR/introduction/');
});

for (const width of [320, 390, 1024, 1440]) {
  test(`public source links and documentation layout at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?lang=pt-BR');
    if (width <= 960) await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    const source = width <= 960 ? page.getByRole('navigation').getByRole('link', { name: 'GitHub', exact: true }) : page.locator('.github-header');
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('href', 'https://github.com/MarcoPeixot/joinlet');
    await expect(source.locator('svg').first()).toBeVisible();
    if (width > 960) {
      const editor = await page.locator('.header-cta').boundingBox();
      expect(editor!.x + editor!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 960) await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('landing-source.png') });
    await expect(page.locator('footer').getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/MarcoPeixot/joinlet');
    await page.goto('/docs/pt-BR/installation/');
    await expect(page.locator('header').getByRole('link', { name: 'GitHub', exact: true })).toBeVisible();
    await expect(page.locator('article')).toContainText('git clone https://github.com/MarcoPeixot/joinlet.git');
    await expect(page.locator('article')).toContainText('bun install --frozen-lockfile');
    const editor = page.locator('footer').getByRole('link', { name: 'Abrir app' });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('href', '/app/?lang=pt-BR');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await axeFindings(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('documentation-source.png') });
  });
}
