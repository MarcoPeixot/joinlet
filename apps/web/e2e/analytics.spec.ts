import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test('analytics is opt-in, minimizes payloads, measures edits and supports revocation', async ({ page, context }) => {
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
  await expect.poll(() => events.map(event=>event.event)).toContain('editor_edited');
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual(['event','referrer','source','visitor']);
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
  expect(await page.evaluate(()=>localStorage.getItem('joinlet:analytics:v1'))).not.toContain('visitor');
});
