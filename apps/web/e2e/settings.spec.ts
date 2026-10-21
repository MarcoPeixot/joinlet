import { AI_PROVIDER_IDS, COMPATIBLE_PROVIDER_IDS, COMPATIBLE_PROVIDERS } from '@strukt/core';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { zoomIn } from './zoom';

import type { ModelRoles as Roles, SettingsView as View } from '../src/settings/client';
import { axeFindings } from './support/axe';

/** A fake local server for /api/settings*: keeps the view, records every POST body (no real keys, no network). */
async function fakeServer(page: Page) {
  const posts: unknown[] = [];
  const view: View = {
    provider: 'anthropic',
    active: null,
    providers: { ...Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, { configured: false, source: null, hint: null }])) as Pick<View['providers'], typeof COMPATIBLE_PROVIDER_IDS[number]>, anthropic: { configured: false, source: null, hint: null }, openrouter: { configured: false, source: null, hint: null }, openai: { configured: false, source: null, hint: null }, opencode: { configured: false, source: null, hint: null }, opencodego: { configured: false, source: null, hint: null } },
    models: { openrouter: { edit: 'openrouter/auto', generate: 'openrouter/auto', doc: 'openrouter/auto' }, openai: { edit: '', generate: '', doc: '' }, opencode: { edit: 'big-pickle', generate: 'big-pickle', doc: 'big-pickle' }, opencodego: { edit: 'glm-5.3-flash', generate: 'glm-5.3-flash', doc: 'glm-5.3-flash' } },
    openai: { baseUrl: null },
  };
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'POST') {
      const patch = route.request().postDataJSON() as { provider?: View['provider']; keys?: Record<string, string | null>; models?: { openrouter?: Partial<Roles>; openai?: Partial<Roles>; opencode?: Partial<Roles>; opencodego?: Partial<Roles> }; openai?: { baseUrl: string | null } };
      posts.push(patch);
      if (patch.provider) view.provider = patch.provider;
      for (const [id, key] of Object.entries(patch.keys ?? {})) {
        view.providers[id as 'openrouter'] = key ? { configured: true, source: 'file', hint: `…${key.slice(-4)}` } : { configured: false, source: null, hint: null };
      }
      Object.assign(view.models.openrouter, patch.models?.openrouter ?? {});
      Object.assign(view.models.openai, patch.models?.openai ?? {});
      Object.assign(view.models.opencode, patch.models?.opencode ?? {});
      Object.assign(view.models.opencodego, patch.models?.opencodego ?? {});
      if (patch.openai) view.openai.baseUrl = patch.openai.baseUrl;
      view.providers.openai.configured = !!view.openai.baseUrl && !!view.models.openai.edit;
      for (const id of COMPATIBLE_PROVIDER_IDS) {
        view.models[id] ??= { edit: COMPATIBLE_PROVIDERS[id].model, generate: '', doc: '' };
        Object.assign(view.models[id]!, (patch.models as Record<string, Partial<Roles>> | undefined)?.[id] ?? {});
      }
      view.active = AI_PROVIDER_IDS.find(id => id === view.provider && view.providers[id].configured) ?? AI_PROVIDER_IDS.find(id => view.providers[id].configured) ?? null;
    }
    await json(route, view);
  });
  await page.route('**/api/settings/test', (route) => json(route, { ok: true, detail: 'Chave aceita pelo OpenRouter.' }));
  await page.route('**/api/settings/opencode-go-models', (route) => json(route, { models: [{ id: 'glm-5.3-flash', name: 'GLM Flash', context: 0 }, { id: 'qwen3.8-flash', name: 'Qwen Flash', context: 0 }] }));
  await page.route('**/api/settings/opencode-models', (route) => json(route, { models: [{ id: 'big-pickle', name: 'Big Pickle', context: 0 }, { id: 'glm-5.3', name: 'GLM', context: 0 }] }));
  await page.route('**/api/settings/openai-models?provider=*', (route) => json(route, { models: ['test-tools', 'other-model'] }));
  await page.route('**/api/settings/openai-models', (route) => json(route, { models: ['llama3.1', 'qwen2.5'] }));
  await page.route('**/api/settings/openrouter-models', (route) => json(route, { models: [{ id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', context: 200000 }] }));
  return { posts };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('Configurações: the gear and ⌘, open it; Geral toggles the canvas; Atalhos filters', async ({ page }) => {
  await fakeServer(page);
  // The minimap hides while the whole diagram fits in view: zoom in so it has something to show.
  await zoomIn(page, 5);
  await expect(page.locator('.react-flow__minimap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await expect(dialog.getByRole('heading', { name: 'Geral' })).toBeVisible();

  await dialog.getByRole('switch', { name: /Mostrar minimapa/ }).click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await dialog.getByRole('switch', { name: /Mostrar minimapa/ }).click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Atalhos' }).click();
  await dialog.getByLabel('Buscar atalhos').fill('desfazer');
  await expect(dialog.getByText('Desfazer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Colar', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(dialog.getByRole('heading', { name: 'Atalhos' })).toBeVisible();
});

test('Configurações › IA: saving an OpenRouter key sends it once, shows only a hint, and switches the provider', async ({ page }) => {
  const { posts } = await fakeServer(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('button', { name: 'IA e providers' }).click();
  await expect(dialog.getByText('IA desativada')).toBeVisible();

  const card = dialog.getByRole('region', { name: 'OpenRouter' });
  await card.getByLabel('Chave OpenRouter').fill('sk-or-test-9876');
  await card.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(card.getByText('Salva neste computador …9876')).toBeVisible();
  await expect(card.getByLabel('Chave OpenRouter')).toHaveValue('');
  expect(posts).toEqual([{ provider: 'openrouter', keys: { openrouter: 'sk-or-test-9876' } }]);
  await expect(dialog.getByText('IA ativa via OpenRouter')).toBeVisible();


  await card.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(card.getByText('Chave aceita pelo OpenRouter.')).toBeVisible();

  await card.getByRole('button', { name: /Modelo para edit/ }).click();
  await page.getByRole('option', { name: /Claude Sonnet/ }).getByRole('button').click();
  await expect.poll(() => posts.at(-1)).toEqual({ models: { openrouter: { edit: 'anthropic/claude-sonnet' } } });
  await expect(card.getByRole('button', { name: 'Modelo para edit: anthropic/claude-sonnet' })).toBeVisible();
});

test('Configurações › IA: an OpenAI-compatible server needs an address and a model, no key', async ({ page }) => {
  const { posts } = await fakeServer(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('button', { name: 'IA e providers' }).click();
  await dialog.getByRole('button', { name: 'Configurar Compatível com OpenAI', exact: true }).click();
  const card = dialog.getByRole('region', { name: 'Compatível com OpenAI' });
  await expect(card.getByText('Não configurada')).toBeVisible();

  await card.getByRole('button', { name: 'Ollama' }).click();
  await expect(card.getByLabel('Endereço do servidor')).toHaveValue('http://localhost:11434/v1');
  await card.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ openai: { baseUrl: 'http://localhost:11434/v1' } });
  await expect(card.getByRole('button', { name: 'Testar conexão' })).toBeEnabled();

  const model = card.getByLabel('Modelo Editar diagrama');
  await model.fill('llama3.1');
  await model.press('Enter');
  await expect.poll(() => posts.at(-1)).toEqual({ models: { openai: { edit: 'llama3.1' } } });
  await expect(dialog.getByText('IA ativa via Compatível com OpenAI')).toBeVisible();
  await expect(card.getByText('localhost:11434/v1').first()).toBeVisible();

  await card.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(card.getByText('Chave aceita pelo OpenRouter.')).toBeVisible();
});

for (const width of [1440, 390]) test(`OpenCode key, model selection and provider switching at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 });
  const { posts } = await fakeServer(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByText('IA e providers', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Configurar Anthropic', exact: true }).click();
  const anthropic = dialog.getByRole('region', { name: 'Anthropic', exact: true });
  await anthropic.getByLabel('Chave Anthropic').fill('test-only-anthropic');
  await anthropic.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(dialog.getByText('IA ativa via Anthropic', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Configurar OpenCode Zen', exact: true }).click();
  const card = dialog.getByRole('region', { name: 'OpenCode Zen', exact: true });
  await card.getByLabel('Chave OpenCode Zen').fill('test-only-opencode-9876');
  await card.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(dialog.getByText('IA ativa via OpenCode Zen', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Chave OpenCode Zen')).toHaveValue('');
  expect(posts.at(-1)).toEqual({ provider: 'opencode', keys: { opencode: 'test-only-opencode-9876' } });
  await card.getByLabel('Modelo OpenCode Zen Editar diagrama').selectOption('glm-5.3');
  await expect.poll(() => posts.at(-1)).toEqual({ models: { opencode: { edit: 'glm-5.3' } } });
  await dialog.getByRole('button', { name: 'Configurar OpenRouter', exact: true }).click();
  const router = dialog.getByRole('region', { name: 'OpenRouter', exact: true });
  await router.getByLabel('Chave OpenRouter').fill('test-only-router');
  await router.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(dialog.getByText('IA ativa via OpenRouter', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Configurar OpenCode Zen', exact: true }).click();
  await card.getByRole('button', { name: 'Usar este provedor', exact: true }).click();
  await expect(dialog.getByText('IA ativa via OpenCode Zen', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Modelo OpenCode Zen Editar diagrama')).toHaveValue('glm-5.3');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath(`opencode-${width}.png`), animations: 'disabled' });
});

for (const width of [1440, 390]) test(`OpenCode Go has its own credentials and models among multiple providers at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 });
  const { posts } = await fakeServer(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByText('IA e providers', { exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Provedores de IA' }).getByRole('button')).toHaveCount(9);
  await dialog.getByRole('button', { name: 'Configurar OpenCode Go', exact: true }).click();
  const go = dialog.getByRole('region', { name: 'OpenCode Go', exact: true });
  await go.getByLabel('Chave OpenCode Go').fill('test-only-go-5432');
  await go.getByRole('button', { name: 'Conectar', exact: true }).click();
  expect(posts.at(-1)).toEqual({ provider: 'opencodego', keys: { opencodego: 'test-only-go-5432' } });
  await expect(dialog.getByText('IA ativa via OpenCode Go', { exact: true })).toBeVisible();
  await expect(go.getByLabel('Chave OpenCode Go')).toHaveValue('');
  await go.getByLabel('Modelo OpenCode Go Editar diagrama').selectOption('qwen3.8-flash');
  await expect.poll(() => posts.at(-1)).toEqual({ models: { opencodego: { edit: 'qwen3.8-flash' } } });
  await dialog.getByRole('button', { name: 'Configurar OpenCode Zen', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'OpenCode Zen', exact: true }).getByLabel('Chave OpenCode Zen')).toHaveAttribute('placeholder', 'Cole sua API key do OpenCode');
  await dialog.getByRole('button', { name: 'Configurar OpenCode Go', exact: true }).click();
  await expect(go.getByText('Salva neste computador …5432')).toBeVisible();
  await expect(go.getByLabel('Modelo OpenCode Go Editar diagrama')).toHaveValue('qwen3.8-flash');
  expect(await axeFindings(page)).toEqual([]);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`opencode-go-${width}.png`), animations: 'disabled' });
});

for (const width of [1440, 390]) test(`named providers keep separate keys and model roles at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const { posts } = await fakeServer(page);
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByText('IA e providers', { exact: true }).click();
  for (const id of COMPATIBLE_PROVIDER_IDS) {
    const name = COMPATIBLE_PROVIDERS[id].name;
    await dialog.getByRole('button', { name: `Configurar ${name}`, exact: true }).click();
    const card = dialog.getByRole('region', { name, exact: true });
    await card.getByLabel(`Chave ${name}`, { exact: true }).fill(`test-${id}-1234`);
    await card.getByRole('button', { name: 'Conectar', exact: true }).click();
    await expect(card.getByLabel(`Chave ${name}`, { exact: true })).toHaveValue('');
    await expect(dialog.getByText(`IA ativa via ${name}`, { exact: true })).toBeVisible();
    const model = card.getByLabel('Modelo Editar diagrama', { exact: true });
    await model.fill('test-tools');
    await model.press('Enter');
    await expect.poll(() => posts.at(-1)).toEqual({ models: { [id]: { edit: 'test-tools' } } });
    await expect(card.locator('datalist option[value="other-model"]')).toHaveCount(1);
    expect(posts).toContainEqual({ provider: id, keys: { [id]: `test-${id}-1234` } });
  }
  expect(await axeFindings(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
