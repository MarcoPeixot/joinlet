import { expect, test } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
const panel = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
});

test('suggestions can be edited before sending and advanced actions stay out of the way', async ({ page }) => {
  const chat = panel(page);
  let calls = 0, question = '';
  await page.route('**/api/ai/chat', (route) => {
    calls++; question = route.request().postDataJSON().messages.at(-1).content;
    return route.fulfill({ json: { reply: 'Resposta revisada.' } });
  });
  await expect(chat.getByRole('button', { name: 'Auditar segurança', exact: true })).toBeHidden();
  await chat.getByText('Análises especializadas', { exact: true }).click();
  await expect(chat.getByRole('button', { name: 'Auditar segurança', exact: true })).toBeVisible();
  await chat.getByText('Análises especializadas', { exact: true }).click();
  await chat.getByRole('button', { name: 'Adicione um cache Redis ao diagrama', exact: true }).click();
  const input = chat.getByRole('textbox', { name: 'Mensagem para a IA' });
  await expect(input).toHaveValue('Adicione um cache Redis ao diagrama');
  await expect(input).toBeFocused();
  expect(calls).toBe(0);
  await expect(chat.locator('[data-role="user"]')).toHaveCount(0);
  await input.fill('Adicione um cache somente no serviço de pedidos');
  await chat.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(chat.locator('[data-role="assistant"]')).toContainText('Resposta revisada.');
  expect(question).toBe('Adicione um cache somente no serviço de pedidos');
  expect(calls).toBe(1);
});

test('the composer grows for long messages and shrinks after sending', async ({ page }) => {
  const chat = panel(page), input = chat.getByRole('textbox', { name: 'Mensagem para a IA' });
  await page.route('**/api/ai/chat', (route) => route.fulfill({ json: { reply: 'Recebido.' } }));
  const initial = (await input.boundingBox())!.height;
  await input.fill(Array.from({ length: 10 }, (_, i) => `Requisito ${i + 1}: manter as conexões dos serviços.`).join('\n'));
  const height = (await input.boundingBox())!.height;
  expect(height).toBeGreaterThan(initial);
  expect(height).toBeLessThanOrEqual(160);
  await input.press('Shift+Enter');
  await expect(chat.locator('[data-role="user"]')).toHaveCount(0);
  await chat.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(initial);
});

test('reading an earlier answer is not interrupted by new response text', async ({ page }) => {
  const chat = panel(page);
  const content = Array.from({ length: 45 }, (_, i) => `## Serviço ${i + 1}\n\nEsta etapa conecta a API aos dados e registra o resultado da operação.\n\n`).join('');
  await page.route('**/api/ai/chat', (route) => route.fulfill({ json: { reply: content } }));
  await chat.getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Explique a arquitetura');
  await chat.getByRole('button', { name: 'Enviar', exact: true }).click();
  const log = chat.getByRole('log', { name: 'Mensagens da conversa', exact: true });
  await expect(log).toContainText('Serviço 45');
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(64);
  await log.evaluate((el) => { el.scrollTop = 100; });
  const jump = chat.getByRole('button', { name: 'Última resposta', exact: true });
  await expect(jump).toBeVisible();
  const before = await log.evaluate((el) => el.scrollTop);
  // The request adapter appends streaming text through this same store update.
  await page.evaluate(async () => {
    const path = '/src/chat/session.ts';
    const { chatStore } = await import(path);
    chatStore.setState((state: { messages: { role: string; content: string }[] }) => ({
      status: 'loading', messages: state.messages.map((message, i) => i === state.messages.length - 1 ? { ...message, content: message.content + '\n\nUma nova parte da resposta.' } : message),
    }));
  });
  await expect(log).toContainText('Uma nova parte da resposta.');
  expect(Math.abs(await log.evaluate((el) => el.scrollTop) - before)).toBeLessThan(3);
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(8);
});
