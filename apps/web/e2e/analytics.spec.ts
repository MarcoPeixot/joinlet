import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test('analytics is opt-in, minimizes payloads, measures edits and supports revocation', async ({ page, context }) => {
  let consent: string | null = null;
  await context.route('**/telemetry/consent',route=>{if(route.request().method()==='POST')consent=route.request().postDataJSON().consent;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:2,consent})});});
  const events: Array<Record<string,string>> = [];
  await context.route('**/app/**', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="strukt-mode" content="browser-preview"><meta name="joinlet-analytics" content="/telemetry"><meta name="joinlet-analytics-source" content="editor">') });
  });
  await context.route('**/telemetry', route => { events.push(route.request().postDataJSON()); return route.fulfill({ status: 202, contentType: 'application/json', body: '{"accepted":true}' }); });
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeVisible();
  expect(events).toHaveLength(0);
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => events.map(event=>event.event)).toContain('editor_ready');
  expect(events.map(event=>event.event)).not.toContain('editor_edited');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  await expect.poll(() => events.map(event=>event.event)).toContain('workspace_limit_viewed');
  await page.getByRole('button', { name: 'Continue in my workspace', exact: true }).click();
  await page.getByText('Create document', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Sensitive internal document');
  await page.getByRole('textbox', { name: 'Document name', exact: true }).press('Enter');
  expect(events.map(event=>event.event)).not.toContain('editor_edited');
  const editor=page.getByRole('group',{name:'Document editor',exact:true}).locator('.cm-content');
  await editor.click();await page.keyboard.type('Sensitive internal content that must stay private.');
  await expect.poll(() => events.map(event=>event.event)).toContain('editor_edited');
  await expect.poll(() => events.map(event=>event.event)).toContain('content_saved');
  for (const event of events) {
    expect(event.version).toBe(2);expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(event)).not.toMatch(/Sensitive|internal|private/);
    expect(event.source).toBe('editor');
  }
  const visitor=events[0]!.visitor;
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
  await expect.poll(() => events.filter(event=>event.event==='editor_ready').length).toBe(2);
  expect(events.at(-1)!.visitor).toBe(visitor);
  await page.getByRole('button',{name:'Privacy',exact:true}).click();
  await page.getByRole('button',{name:'Decline analytics',exact:true}).click();
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toBeVisible();
  const count=events.length;
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
  expect(events).toHaveLength(count);
  expect(await page.evaluate(()=>localStorage.getItem('joinlet:analytics:v2'))).not.toContain('visitor');
});


test('documentation is opt-in and measures guide and editor CTA without search text',async({page,context})=>{
  const events:Array<Record<string,unknown>>=[];let consent:string|null=null;
  await context.route('**/docs/en/**',async route=>{if(route.request().resourceType()!=='document')return route.continue();const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace('<head>','<head><meta name="joinlet-analytics" content="/telemetry"><meta name="joinlet-analytics-source" content="site">')});});
  await context.route('**/telemetry/consent',route=>{if(route.request().method()==='POST')consent=route.request().postDataJSON().consent;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:2,consent})});});
  await context.route('**/telemetry',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:202,body:'{}'});});
  await page.goto('/docs/en/installation/?utm_source=github');await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
  await expect.poll(()=>events.length).toBe(1);expect(events[0]).toMatchObject({page:'docs',guide:'installation',utm_source:'github'});
  await page.getByRole('link',{name:'Open app ↗',exact:true}).first().click();
  await expect.poll(()=>events.map(e=>e.event)).toContain('editor_cta_clicked');
});

test('a local refusal survives a failed consent write and a stale shared grant',async({page,context})=>{
  const events:Array<Record<string,unknown>>=[];
  await context.route('**/app/**',async route=>{if(route.request().resourceType()!=='document')return route.continue();const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace('<head>','<head><meta name="strukt-mode" content="browser-preview"><meta name="joinlet-analytics" content="/telemetry"><meta name="joinlet-analytics-source" content="editor">')});});
  await context.route('**/telemetry/consent',route=>route.fulfill({status:route.request().method()==='POST'?503:200,contentType:'application/json',body:JSON.stringify({version:2,consent:'allowed'})}));
  await context.route('**/telemetry',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:202,body:'{}'});});
  await page.goto('/app/?lang=en');await expect(page.getByRole('button',{name:'Privacy',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Privacy',exact:true}).click();await page.getByRole('button',{name:'Decline analytics',exact:true}).click();
  const count=events.length;await page.reload();await expect(page.getByRole('navigation',{name:'Workspace',exact:true})).toBeVisible();
  expect(events).toHaveLength(count);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('joinlet:analytics:v2')!).consent)).toBe('declined');
});
