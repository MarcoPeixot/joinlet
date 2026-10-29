import {INITIAL_JS_BYTES,INITIAL_JS_REQUESTS} from '../build/loadingBudget';
import {writeFile} from 'node:fs/promises';
import {expect,test} from '@playwright/test';

test('cold production editor stays within the complete JavaScript loading budget',async({page,context},testInfo)=>{
 await page.addInitScript(()=>localStorage.setItem('joinlet:locale','pt-BR'));
 const session=await context.newCDPSession(page);await session.send('Network.enable');await session.send('Network.setCacheDisabled',{cacheDisabled:true});
 const requests:{url:string;bytes:number}[]=[];const pending:Promise<void>[]=[];const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 context.on('requestfailed',request=>{if(request.resourceType()==='script'||/\.(?:m?js)(?:\?|$)/.test(request.url()))errors.push('Script request failed: '+new URL(request.url()).pathname);});
 context.on('response',response=>{if(/tree-sitter|\.wasm(?:\?|$)/.test(response.url()))errors.push('Repository parser reached frontend: '+new URL(response.url()).pathname);if(response.request().resourceType()==='script'||/\.(?:m?js)(?:\?|$)/.test(response.url()))pending.push(response.body().then(body=>{requests.push({url:new URL(response.url()).pathname,bytes:body.byteLength});}).catch(()=>{errors.push('Unable to measure script: '+new URL(response.url()).pathname);}));});
 await page.goto('/app/');await expect(page.locator('.react-flow__node').first()).toBeVisible();await expect(page.getByText('Salvo',{exact:true})).toBeVisible();const ready=await page.evaluate(()=>performance.now());await page.waitForLoadState('networkidle');await Promise.all(pending);
 const bytes=requests.reduce((sum,r)=>sum+r.bytes,0);
 const report={ready,bytes,requests:requests.length,resources:requests.sort((a,b)=>b.bytes-a.bytes),timings:await page.evaluate(()=>({ready:performance.now(),navigation:performance.getEntriesByType('navigation').map(entry=>entry.toJSON())}))};
 await writeFile(testInfo.outputPath('javascript-budget.json'),JSON.stringify(report,null,2));
 await testInfo.attach('javascript-budget.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 expect(errors).toEqual([]);expect(bytes).toBeLessThanOrEqual(INITIAL_JS_BYTES);expect(requests.length).toBeLessThanOrEqual(INITIAL_JS_REQUESTS);
 expect(requests.some(r=>/tree-sitter|\.wasm|codemirror|simple-icons-/.test(r.url))).toBe(false);
 await page.getByRole('button',{name:'Mostrar/ocultar código'}).click();await expect(page.locator('.cm-editor').first()).toBeVisible();expect(await page.locator('.react-flow__node').count()).toBeGreaterThan(0);
 // Opening the panel persists workspace UI state; reload after that write is durable.
 await expect(page.getByText('Salvo',{exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.cm-editor').first()).toBeVisible();
});

for(const consent of ['allowed','declined'] as const)test(`production analytics respects ${consent} consent and keeps the editor usable`,async({page,context})=>{
 const events:unknown[]=[];
 await context.route('**/app/**',async route=>{if(route.request().resourceType()!=='document')return route.continue();const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('<head>','<head><meta name="joinlet-analytics" content="/telemetry"><meta name="joinlet-analytics-source" content="editor">')});});
 await context.route('**/telemetry/consent',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:2,consent})}));
 await context.route('**/telemetry',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:202,body:'{}'});});
 await page.addInitScript(value=>localStorage.setItem('joinlet:analytics:v2',JSON.stringify({consent:value,expires:Date.now()+60000,...(value==='allowed'?{visitor:'00000000-0000-4000-8000-000000000001'}:{})})),consent);
 await page.goto('/app/?lang=en');await expect(page.locator('.react-flow__node').first()).toBeVisible();await page.waitForLoadState('networkidle');
 if(consent==='declined')expect(events).toHaveLength(0);else await expect.poll(()=>events.length).toBeGreaterThan(0);
});
