import { expect, test } from '@playwright/test';
import { readFile } from './storage';

const kafka = (page: import('@playwright/test').Page) => page.locator('.react-flow__node[data-id="Kafka"]');

test.describe('chat com a IA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
    await expect(kafka(page)).toBeVisible();
  });

  test('opens beside Configurações, sends the diagram JSON with the question and shows the answer', async ({ page }) => {
    let body: { messages: { role: string; content: string }[]; context: string; stream?: boolean } | null = null;
    await page.route('**/api/ai/chat', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: 'O **Kafka** ' })}\n${JSON.stringify({ t: 'conecta os serviços.' })}\n${JSON.stringify({ done: true })}\n` });
    });
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Lendo:/)).toBeVisible();
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('O que é o Kafka aqui?');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"] strong')).toHaveText('Kafka');
    expect(body!.messages).toEqual([{ role: 'user', content: 'O que é o Kafka aqui?' }]);
    expect(body!.stream).toBe(true);
    expect(body!.context).toContain('"id": "Kafka"');
    await expect(panel.locator('[data-role="assistant"]')).toContainText('conecta os serviços.');
    await panel.getByRole('button', { name: 'Apagar conversa' }).click();
    await expect(panel.locator('[data-role]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fechar chat' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('without the AI server it says so and offers no retry', async ({ page }) => {
    await page.route('**/api/ai/chat', (route) => route.fulfill({ status: 503, json: { error: 'IA indisponível: configure um provider.' } }));
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('button', { name: 'Resuma este diagrama' }).click();
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('IA indisponível');
    await expect(panel.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0);
  });

  test('the conversation survives a reload, and a new one keeps the old in the history', async ({ page }) => {
    let n = 0;
    await page.route('**/api/ai/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: `Resposta ${++n}` })}\n${JSON.stringify({ done: true })}\n` }));
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Primeira pergunta');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta 1');
    await page.reload();
    await expect(kafka(page)).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    await expect(panel.locator('[data-role="user"]')).toHaveText('Primeira pergunta');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta 1');
    await panel.getByRole('button', { name: 'Nova conversa' }).click();
    await expect(panel.locator('[data-role]')).toHaveCount(0);
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Segunda pergunta');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta 2');
    await panel.getByRole('button', { name: 'Conversas anteriores' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Primeira pergunta/ }).click();
    await expect(panel.locator('[data-role="user"]')).toHaveText('Primeira pergunta');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta 1');
  });

  test('continuing a conversation after a reload does not overwrite the saved answers', async ({ page }) => {
    let n = 0;
    await page.route('**/api/ai/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: `Resposta ${++n}` })}\n${JSON.stringify({ done: true })}\n` }));
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Q1');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta 1');
    await page.reload();
    await expect(kafka(page)).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Q2');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText(['Resposta 1', 'Resposta 2']);
  });

  test('renaming the workspace keeps its conversation', async ({ page }) => {
    await page.route('**/api/ai/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: 'Resposta salva' })}\n${JSON.stringify({ done: true })}\n` }));
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Antes de renomear');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toHaveText('Resposta salva');
    await page.getByRole('button', { name: 'Menu do workspace' }).click();
    await page.getByRole('menuitem', { name: 'Renomear workspace', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nome do workspace', exact: true }).fill('Outro nome');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="user"]')).toHaveText('Antes de renomear');
    await page.reload();
    await expect(kafka(page)).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    await expect(panel.locator('[data-role="user"]')).toHaveText('Antes de renomear');
  });

  test('shows the answer while it is being written and lets you stop it', async ({ page }) => {
    // The first piece arrives, the rest never does until the page gives up (the request is aborted by "Parar").
    await page.route('**/api/ai/chat', async (route) => {
      await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: 'Começo da resposta' })}\n` });
    });
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Explique tudo');
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-role="assistant"]')).toContainText('Começo da resposta');
    // The body ended without {done}: the client reports the cut, and the text stays marked.
    await expect(panel.getByRole('alert')).toContainText('interrompida');
    await expect(panel.getByText('Resposta interrompida.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  });

  test('also opens over a document', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
    await page.getByRole('textbox', { name: /documento/i }).fill('Notas');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Editor do documento', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await expect(panel.getByText('Lendo: Notas')).toBeVisible();
  });
});

test.describe('compartilhar', () => {
  test('generates the link, copies it and shows who is online', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    let active = false;
    let people: { name: string; color: string }[] = [];
    await page.route('**/api/share**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/audit')) return route.fulfill({ json: { entries: [] } });
      if (url.pathname.endsWith('/start')) active = true;
      if (url.pathname.endsWith('/stop')) active = false;
      const invite = (id: string, name: string, role: string, token: string) => ({ id, name, role, createdAt: 1, expiresAt: null, url: `http://192.168.0.5:8790/join?token=${token}`, publicUrl: null });
      await route.fulfill({ json: active ? { active: true, root: '/repo', people, startedAt: 1, tunnel: { active: false }, invites: [invite('e', 'Link para editar', 'edit', 'abc'), invite('v', 'Link só para ver', 'view', 'view')] } : { active: false } });
    });
    await page.goto('/app/');
    await expect(kafka(page)).toBeVisible();
    await page.getByRole('button', { name: 'Compartilhar workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compartilhar workspace' });
    await dialog.getByRole('textbox').fill('/repo');
    await dialog.getByRole('textbox').blur();
    await dialog.getByRole('button', { name: 'Gerar link' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Link para editar' })).toHaveValue('http://192.168.0.5:8790/join?token=abc');
    await expect(dialog.getByRole('textbox', { name: 'Link só para ver' })).toHaveValue('http://192.168.0.5:8790/join?token=view');
    await expect(dialog.getByText('Ninguém conectado ainda')).toBeVisible();
    await dialog.getByRole('button', { name: 'Copiar link para editar' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://192.168.0.5:8790/join?token=abc');
    people = [{ name: 'Ana Souza', color: '#3972dc' }];
    await expect(dialog.locator('[data-person="Ana Souza"]')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('header').getByRole('status').filter({ hasText: '1 online' })).toBeVisible();
    await expect(page.locator('header [data-person="Ana Souza"]')).toBeVisible();
    await page.getByRole('button', { name: 'Compartilhar workspace' }).click();
    await dialog.getByRole('button', { name: 'Parar de compartilhar' }).click();
    await expect(dialog.getByRole('button', { name: 'Gerar link' })).toBeVisible();
  });
});

test.describe('chat: citações e assistentes', () => {
  type Body = { messages: { role: string; content: string }[]; context: string };
  const answer = (...pieces: string[]) => `${pieces.map((t) => JSON.stringify({ t })).join('\n')}\n${JSON.stringify({ done: true })}\n`;
  const sidebar = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Workspace' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
    await expect(kafka(page)).toBeVisible();
  });

  async function ask(page: import('@playwright/test').Page, reply: string, question = 'Pergunta') {
    await page.route('**/api/ai/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: answer(reply) }));
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Chat com a IA' }).click();
    await panel.getByRole('textbox', { name: 'Mensagem para a IA' }).fill(question);
    await page.keyboard.press('Enter');
    return panel;
  }

  test('a known [[Id]] is a chip that selects the node; unknown ids and hostile links stay inert', async ({ page }) => {
    const panel = await ask(
      page,
      'O [[Kafka]] liga tudo; [[Inventado]] não existe. [x](javascript:alert(1)) [y](#cite/exemplo/x" onclick="alert(1)) [[<img src=x onerror=alert(2)>]] <img src=x onerror=alert(3)>',
    );
    const answerBox = panel.locator('[data-role="assistant"]');
    const chip = answerBox.locator('a[href^="#cite/"]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('Kafka');
    await expect(answerBox).toContainText('[[Inventado]]');
    // Nothing active got through: no image, no handlers, and every href is a web link or an exact citation address.
    await expect(answerBox.locator('[onclick], [onerror], img:not([src^="data:image/svg+xml"])')).toHaveCount(0);
    const hrefs = await answerBox.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    for (const href of hrefs) expect(href === null || /^(https?:\/\/|#cite\/[A-Za-z0-9][\w-]*\/[\w.%~-]+$)/.test(href)).toBe(true);
    await expect(kafka(page)).not.toHaveClass(/selected/);
    await chip.click();
    await expect(kafka(page)).toHaveClass(/selected/);
    expect(page.url()).not.toContain('#cite');
  });

  test('[[slug#Id]] brings you back to that diagram from another one', async ({ page }) => {
    const panel = await ask(page, 'Veja [[Kafka]].');
    const href = (await panel.locator('a[href^="#cite/"]').getAttribute('href'))!;
    const slug = /^#cite\/([^/]+)\//.exec(href)![1]!;
    await sidebar(page).getByRole('button', { name: 'Novo diagrama' }).click();
    await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Pagamentos');
    await page.keyboard.press('Enter');
    await expect(kafka(page)).toHaveCount(0);
    await ask(page, `E o [[${slug}#Kafka]] lá.`, 'De novo');
    await panel.locator('[data-role="assistant"]').last().locator('a[href^="#cite/"]').click();
    await expect(kafka(page)).toHaveClass(/selected/);
  });

  test('a built-in assistant runs in its own conversation with the scope it asks for, and its answer can become a document', async ({ page }) => {
    let body: Body | null = null;
    await page.route('**/api/ai/chat', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/x-ndjson', body: answer('# Revisão de falhas\n\nO [[Kafka]] é um ponto único.') });
    });
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('button', { name: 'Assistentes', exact: true }).click();
    await page.getByRole('menuitem', { name: /Revisar pontos únicos de falha/ }).click();
    await expect(panel.locator('[data-role="user"][data-assistant="Revisar pontos únicos de falha"]')).toBeVisible();
    await expect(panel.locator('[data-role="assistant"] h1')).toHaveText('Revisão de falhas');
    expect(body!.messages).toHaveLength(1);
    expect(body!.messages[0]!.content).toContain('pontos únicos de falha');
    expect(body!.context).toContain('(slug: ');
    await panel.getByRole('button', { name: 'Salvar como documento' }).click();
    await expect(sidebar(page).getByRole('button', { name: 'Revisão de falhas', exact: true })).toBeVisible();
  });

  test('the "changes" assistant also sends the diff against the last saved version', async ({ page }) => {
    let body: Body | null = null;
    await page.route('**/api/ai/chat', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/x-ndjson', body: answer('Sem versões.') });
    });
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByText('Análises especializadas', { exact: true }).click();
    await panel.getByRole('button', { name: 'Resumir mudanças desde a última versão' }).click();
    await expect(panel.locator('[data-role="assistant"]')).toContainText('Sem versões.');
    expect(body!.context).toContain('## Mudanças desde a última versão salva');
    expect(body!.context).toContain('ainda não tem versões salvas');
  });

  test('saved assistants live in .arch/assistants.json and survive a reload', async ({ page }) => {
    let body: Body | null = null;
    await page.route('**/api/ai/chat', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/x-ndjson', body: answer('Custos revisados.') });
    });
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    const panel = page.getByRole('complementary', { name: 'Chat com a IA' });
    await panel.getByRole('button', { name: 'Assistentes', exact: true }).click();
    await page.getByRole('menuitem', { name: /Gerenciar assistentes/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistentes do workspace' });
    await dialog.getByRole('button', { name: 'Novo assistente' }).click();
    await dialog.getByRole('textbox', { name: 'Nome' }).fill('Revisar custos');
    await dialog.getByRole('textbox', { name: 'Instrução' }).fill('Aponte onde o desenho gera custo desnecessário.');
    await dialog.getByRole('button', { name: 'Todo o workspace' }).click();
    await dialog.getByRole('button', { name: 'Salvar assistente' }).click();
    await expect(dialog.getByRole('list', { name: 'Assistentes salvos' }).getByText('Revisar custos')).toBeVisible();
    await expect.poll(async () => JSON.parse((await readFile(page, 'assistants.json')) ?? '{}').assistants?.[0]).toMatchObject({ id: 'revisar-custos', name: 'Revisar custos', scope: 'workspace' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(kafka(page)).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA' }).click();
    await panel.getByText('Análises especializadas', { exact: true }).click();
    await panel.getByRole('button', { name: 'Revisar custos' }).click();
    await expect(panel.locator('[data-role="assistant"]')).toContainText('Custos revisados.');
    expect(body!.messages[0]!.content).toBe('Aponte onde o desenho gera custo desnecessário.');

    await panel.getByRole('button', { name: 'Assistentes', exact: true }).click();
    await page.getByRole('menuitem', { name: /Gerenciar assistentes/ }).click();
    await dialog.getByRole('button', { name: 'Excluir Revisar custos' }).click();
    await expect.poll(() => readFile(page, 'assistants.json')).toBeNull();
  });
});
