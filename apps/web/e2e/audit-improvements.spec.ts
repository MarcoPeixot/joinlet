import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

test('opening the applied demo creates a separate persistent workspace', async ({ page }) => {
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await page.evaluate(async () => { const {workspace}=await import('/src/workspace/appWorkspace.ts'); workspace.setName('Keep my project'); await workspace.flush(); });
  await page.goto('/?lang=en');
  await page.getByRole('button', { name: /Add a Notifications service/ }).click();
  await page.getByRole('group', { name: 'Proposal review' }).getByRole('button', { name: 'Apply', exact:true }).click();
  await page.getByRole('link', { name: 'Open this example', exact:true }).click();
  await expect(page.getByRole('button', { name:'Workspace menu' })).toContainText('Joinlet example');
  await expect(page.locator('.react-flow__node[data-id="Notificações"]')).toContainText('Notifications');
  await expect(page).not.toHaveURL(/example=/);
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Notificações"]')).toBeVisible();
  const projects = await page.evaluate(async () => { const {loadCatalog}=await import('/src/workspace/catalog.ts'); return (await loadCatalog())?.entries.map(x=>x.name); });
  expect(projects).toContain('Keep my project');
  expect(projects?.filter(x=>x==='Joinlet example')).toHaveLength(1);
});

for (const theme of ['light','dark']) test(`offline AI setup offers a next step in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(value=>localStorage.setItem('strukt:theme',value),theme);
  await page.route('**/api/**', route=>route.fulfill({status:503,body:''}));
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async()=>{(await import('/src/settings/store.ts')).openSettings('ai');});
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await expect(dialog.getByRole('heading',{name:'Set up your AI connection'})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'Installation guide'})).toHaveAttribute('href','/setup/?lang=en');
  await expect(dialog.locator('pre')).toContainText('bun install --frozen-lockfile\nbun run dev');
  await expect(dialog.getByRole('button',{name:'Continue editing'})).toBeEnabled();
  await page.waitForTimeout(250);
  expect(await axeFindings(page)).toEqual([]);
  await dialog.screenshot({path:info.outputPath(`setup-${theme}.png`),animations:'disabled'});
  await dialog.getByRole('button',{name:'Continue editing'}).click();
  await expect(dialog).toHaveCount(0);
});

test('Overview status and zoom remain separate beside chat',async({page},info)=>{
  await page.setViewportSize({width:768,height:900});
  await page.goto('/app/?lang=en');
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await page.getByRole('button',{name:'AI chat',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message to AI'})).toBeVisible();
  const status=page.locator('.sk-overview-status');const zoom=page.locator('.strukt-board .react-flow__panel.sk-corner.bottom.left');
  await expect.poll(async()=>{const a=(await status.boundingBox())!,b=(await zoom.boundingBox())!;return a.y+a.height<=b.y||b.y+b.height<=a.y||a.x+a.width<=b.x||b.x+b.width<=a.x;}).toBe(true);
  await page.screenshot({path:info.outputPath('overview-tablet.png')});
});

test('fresh English sample uses localized labels with stable identifiers',async({page})=>{
  await page.goto('/app/?lang=en');
  for(const [id,label]of [['Pedidos','Orders'],['Pagamentos','Payments'],['Serviços','Services'],['Dados','Data']])await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toContainText(label);
});

test('the static mascot never requests animation assets',async({page})=>{
  const images:string[]=[];page.on('request',r=>{if(r.url().includes('/brand/jo-'))images.push(r.url());});
  await page.goto('/?lang=en');await expect(page.locator('.jo-illustration')).toBeVisible();
  await page.locator('.jo-illustration').hover();
  expect(images.some(x=>/eyes-open|wave-field|face-neutral/.test(x))).toBe(false);
  expect(images.some(x=>x.endsWith('.png'))).toBe(false);
});

test.describe('static content',()=>{
 test.use({javaScriptEnabled:false});
 test('landing and installation guide remain useful without JavaScript',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('clear diagrams');
  await expect(page.getByRole('link',{name:'Open Joinlet'})).toHaveAttribute('href','/app/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content','https://joinlet.co/brand/joinlet-social.png');
  await page.getByRole('link',{name:'Learn how to set up AI.'}).click();
  await expect(page.getByRole('heading',{name:'Connect AI to Joinlet.'})).toBeVisible();
  await page.getByRole('link',{name:'Português brasileiro'}).click();
  await expect(page.getByRole('heading',{name:'Conecte IA ao Joinlet.'})).toBeInViewport();
 });
});

test('the provider CTA opens AI settings in the selected language',async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:''}));
  await page.goto('/?lang=pt-BR');
  await page.getByRole('link',{name:'Escolha sua conexão'}).click();
  await expect(page.getByRole('dialog',{name:'Configurações',exact:true}).getByRole('heading',{name:'Prepare sua conexão de IA'})).toBeVisible();
  await expect(page).not.toHaveURL(/settings=/);
  await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
});
