import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { newWorkspace, workspaceFiles } from '@strukt/workspace';
import { unzipFiles } from '@strukt/workspace/zip';

let process: ChildProcess;
let origin: string;
test.beforeAll(async () => {
  process = spawn('bun', [new URL('./fixtures/hosted.ts', import.meta.url).pathname], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...globalThis.process.env, JOINLET_BROWSER_PASSWORD_ONLY: '1' },
  });
  let errors = '';
  process.stderr!.on('data', chunk => { errors += chunk; });
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(errors || 'Password fixture did not start.')), 15_000);
    process.stdout!.once('data', chunk => { clearTimeout(timer); resolve(String(chunk).trim()); });
    process.once('exit', code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${errors}`)); });
  });
});
test.afterAll(async () => {
  if (process && process.exitCode === null && !process.killed) {
    process.kill('SIGTERM'); await new Promise<void>(resolve => process.once('exit', () => resolve()));
  }
});
const secret = () => '  test-only-' + randomUUID() + '  ';

test('signs up without GitHub, saves online, signs in from another browser and changes the password', async ({ page, browser }) => {
  const email = `${randomUUID()}@example.test`, password = secret(), next = secret();
  await page.goto(`${origin}/app/?lang=en`);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Passwords do not match.');
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings (⌘,)' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Workspace', exact: true }).click();
  await settings.getByLabel('Workspace name', { exact: true }).fill('Password workspace');
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByText('Workspace updated.', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Edit profile', exact: true }).click();
  await settings.getByLabel('Display name', { exact: true }).fill('Maria Profile');
  const avatar = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#a3ff3d'; ctx.fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1]!; });
  await settings.getByLabel('Upload profile photo', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(avatar, 'base64') });
  await expect(settings.getByRole('img', { name: 'Profile photo', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(settings.getByText('Profile updated.', { exact: true })).toBeVisible();
  await expect(settings.getByRole('img', { name: 'Profile photo', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/joinlet-account-profile.png', fullPage: true });
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(`${origin}/app/?lang=en`);
    await other.getByLabel('Email', { exact: true }).fill(email);
    await other.getByLabel('Password', { exact: true }).fill(password);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(other.getByText('Password workspace', { exact: true }).first()).toBeVisible();
    await other.getByRole('button', { name: 'Settings (⌘,)' }).click();
    const otherSettings = other.getByRole('dialog', { name: 'Settings', exact: true });
    await otherSettings.getByRole('button', { name: 'Edit profile', exact: true }).click();
    await expect(otherSettings.getByLabel('Display name', { exact: true })).toHaveValue('Maria Profile');
    await expect(otherSettings.getByRole('img', { name: 'Profile photo', exact: true })).toBeVisible();
    await otherSettings.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await otherSettings.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(otherSettings.getByText('Profile updated.', { exact: true })).toBeVisible();
    await expect(otherSettings.getByRole('img', { name: 'Profile photo', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: 'Change password', exact: true }).click();
    const change = settings.getByRole('form', { name: 'Change password' });
    await change.getByLabel('Current password', { exact: true }).fill(password);
    await change.getByLabel('New password', { exact: true }).fill(next);
    await change.getByLabel('Confirm password', { exact: true }).fill(next);
    await change.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password.');
    await page.getByLabel('Password', { exact: true }).fill(next);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Password workspace', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Settings (⌘,)' }).click();
    await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('exports the existing preview draft from the login screen and keeps it intact', async ({ page }) => {
  await page.goto(`${origin}/app/?lang=en`);
  const files = workspaceFiles(newWorkspace('Old preview'));
  await page.evaluate(async files => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('strukt', 1);
      request.onupgradeneeded = () => { for (const name of ['files', 'meta']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      for (const [path, text] of Object.entries(files)) tx.objectStore('files').put(text, path);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, files);
  await page.reload();
  const backup = page.getByRole('button', { name: 'Export draft: Old preview', exact: true });
  await expect(backup).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await backup.click();
  const download = await downloadPromise;
  const content = unzipFiles(await readFile((await download.path())!));
  expect(content['strukt.json']).toBe(files['strukt.json']);
  await page.reload();
  await expect(backup).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('keeps Portuguese password entry usable on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${origin}/app/?lang=pt-BR`);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Criar uma conta', exact: true }).click();
  await expect(page.getByLabel('Confirmar senha', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('password-mobile.png'), fullPage: true });
});
