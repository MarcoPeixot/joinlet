import {test,expect} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {unzipFiles} from '@strukt/workspace/zip';
let server:ChildProcess,origin:string;
test.beforeAll(async()=>{
 server=spawn('bun',[new URL('./fixtures/hosted.ts',import.meta.url).pathname],{env:{...process.env,JOINLET_BROWSER_PASSWORD_ONLY:'1',JOINLET_BROWSER_OPTIONAL_LOGIN:'1'},stdio:['ignore','pipe','pipe']});
 origin=await new Promise<string>((done,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Optional-login backend did not start')),15000);server.stdout!.on('data',chunk=>{output+=String(chunk);if(output.includes('\n')){clearTimeout(timer);done(output.trim().split('\n')[0]!);}});server.once('exit',()=>reject(Error('Backend exited')));});
});
test.afterAll(async()=>{server?.kill('SIGTERM');if(server?.exitCode===null)await new Promise(done=>server.once('exit',done));});

test('opens without login, preserves drafts and returns from an empty login form',async({page})=>{
 await page.goto(origin+'/app/?lang=en');await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(0);
 await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'New note',exact:true}).click();await page.getByRole('textbox',{name:'Note text',exact:true}).fill('Keep this local draft');
 await page.getByRole('button',{name:'Sign in to your account',exact:true}).click();await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/^Export draft:/}).first().click()]);const files=unzipFiles(new Uint8Array(await readFile((await download.path())!)));expect(files['board.json']).toContain('Keep this local draft');
 await page.getByRole('button',{name:'Continue without an account',exact:true}).click();await expect(page.getByRole('textbox',{name:'Note text',exact:true})).toHaveValue('Keep this local draft');await page.reload();await expect(page.getByRole('textbox',{name:'Note text',exact:true})).toHaveValue('Keep this local draft');
 expect((await page.request.get(origin+'/api/remote/session')).status()).toBe(401);expect((await page.request.post(origin+'/api/connectors/pairing',{data:{},headers:{origin}})).status()).toBe(401);
});

test('keeps Cloud sign-in optional and authenticated data isolated',async({page,browser})=>{
 const email=randomUUID()+'@example.test',password='fixture-'+randomUUID();await page.goto(origin+'/app/?lang=en');await page.getByRole('button',{name:'Sign in to your account',exact:true}).click();await page.getByRole('button',{name:'Create an account',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await expect(page.getByText('Joinlet Cloud',{exact:true}).first()).toBeVisible();expect(new URL(page.url()).searchParams.has('account')).toBe(false);const session=await(await page.request.get(origin+'/api/remote/session')).json();
 const other=await browser.newContext();try{const stranger=await other.newPage();await stranger.goto(origin+'/app/?lang=en&workspace='+encodeURIComponent(session.repo));await expect(stranger.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect((await other.request.get(origin+'/api/remote/workspace?repo='+encodeURIComponent(session.repo))).status()).toBe(401);}finally{await other.close();}
 await page.getByRole('button',{name:'Settings (⌘,)',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in to your account',exact:true})).toBeVisible();
});

test('explains unavailable GitHub connections and does not restart OAuth on a repository network failure',async({page})=>{
 const email=randomUUID()+'@example.test',password='fixture-'+randomUUID();
 await page.goto(origin+'/app/?lang=en');await page.getByRole('button',{name:'Sign in to your account',exact:true}).click();await page.getByRole('button',{name:'Create an account',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'New diagram',exact:true}).click();await page.getByRole('textbox',{name:'Diagram name',exact:true}).fill('Repository configuration');await page.keyboard.press('Enter');
 await page.getByRole('button',{name:/^Panels/}).click();await page.getByRole('menuitemcheckbox',{name:/^GitHub/}).click();
 const connect=page.getByRole('button',{name:'Connect GitHub repository',exact:true});
 await expect(connect).toBeDisabled();await expect(page.getByText('GitHub connections have not been enabled by the Joinlet administrator yet.',{exact:true})).toBeVisible();
 await page.route('**/api/repositories',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,githubConfigured:true,githubInstallUrl:'https://github.com/apps/joinlet-test/installations/new'}});});
 let authorizations=0;
 await page.route('**/api/repositories/github/authorize',async route=>{authorizations++;await route.fulfill({status:503,json:{error:'Unexpected authorization'}});});
 await page.route('**/api/repositories/github/repos',route=>route.fulfill({status:503,json:{error:'Temporary repository network failure'}}));
 await expect(connect).toBeEnabled();await connect.click();await expect(page.getByRole('alert')).toContainText('Temporary repository network failure');expect(authorizations).toBe(0);
 await page.route('**/api/repositories/github/repos',route=>route.fulfill({json:{repos:[]}}));await connect.click();
 await expect(page.getByText('No repositories with write access were found. Install the GitHub App on the desired repositories and check your permissions.',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Install or configure the GitHub App',exact:true})).toHaveAttribute('href','https://github.com/apps/joinlet-test/installations/new');
});

test('explicit local mode opens offline while a remote outage remains visible by default',async({page})=>{
 await page.route('**/api/remote/session**',route=>route.fulfill({status:503,json:{error:'temporary outage'}}));await page.goto(origin+'/app/?lang=pt-BR');await expect(page.getByRole('alert')).toContainText('servidor remoto');await page.goto(origin+'/app/?lang=pt-BR&account=local');await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await expect(page.getByRole('button',{name:'Entrar na conta',exact:true})).toBeVisible();
});

test('still opens a temporary editor when the browser blocks local persistence',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get(){throw Error('Storage blocked for test');}});});await page.goto(origin+'/app/?lang=en');await expect(page.getByRole('navigation',{name:'Workspace'})).toBeVisible();await expect(page.getByText('Memory (not saved)',{exact:true})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(0);
});
