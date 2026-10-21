import { expect, test } from '@playwright/test';
import { readFile, savedDiagram } from './storage';

test.use({ reducedMotion: 'reduce' });
const chat = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
async function send(page: import('@playwright/test').Page, text: string) {
  await chat(page).getByRole('textbox', { name: 'Mensagem para a IA' }).fill(text);
  await chat(page).getByRole('button', { name: 'Enviar', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('chat adds, saves, undoes and clears the diagram', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai/chat', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.target.kind).toBe('diagram');
    const ops = calls++ === 0 ? [{ op: 'add_node', id: 'Cache do chat', icon: 'redis', description: 'Armazena respostas para reduzir a latência.' }] : JSON.parse(body.target.content).nodes.map((n: { id: string }) => ({ op: 'remove', id: n.id }));
    await route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'diagram', summary: calls === 1 ? 'Cache adicionado.' : 'Diagrama limpo.', ops } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Adicione um cache Redis');
  await expect(chat(page).getByText('Cache adicionado.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page))?.model.order.includes('Cache do chat')).toBe(true);
  expect((await savedDiagram(page))?.model.elements['Cache do chat']?.description).toBe('Armazena respostas para reduzir a latência.');
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).click();
  await expect.poll(async () => (await savedDiagram(page))?.model.order.includes('Cache do chat')).toBe(false);
  await send(page, 'Limpe o diagrama');
  await expect.poll(async () => (await savedDiagram(page))?.model.order.length).toBe(0);
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).click();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('chat rewrites the open document, updates its editor, saves and undoes', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Notas do chat');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.route('**/api/ai/chat', (route) => {
    expect(route.request().postDataJSON().target).toMatchObject({ kind: 'doc', slug: 'notas-do-chat' });
    return route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'doc', summary: 'Documento revisado.', markdown: '# Arquitetura revisada\n\nInclui cache Redis.' } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Escreva a documentação');
  await expect(page.locator('.cm-content')).toContainText('Inclui cache Redis.');
  await expect.poll(() => readFile(page, 'docs/notas-do-chat.md')).toContain('Inclui cache Redis.');
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).click();
  await expect(page.locator('.cm-content')).not.toContainText('Inclui cache Redis.');
});

test('chat draws and clears a sketch, retaining undo', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo sketch' }).click();
  await page.getByRole('textbox', { name: /sketch/i }).fill('Sketch do chat');
  await page.keyboard.press('Enter');
  await expect(page.locator('.excalidraw .App-menu_top')).toBeVisible();
  let n = 0;
  await page.route('**/api/ai/chat', (route) => {
    expect(route.request().postDataJSON().target.kind).toBe('sketch');
    return route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'sketch', summary: ++n === 1 ? 'Bloco desenhado.' : 'Sketch limpo.', clear: n > 1, remove: [], upsert: n === 1 ? [{ id: 'bloco-chat', type: 'rectangle', x: 100, y: 100, width: 200, height: 100, strokeColor: '#1971c2' }] : [] } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Desenhe um bloco azul');
  const elements = async () => JSON.parse(await readFile(page, 'sketches/sketch-do-chat.excalidraw') ?? '{"elements":[]}').elements;
  await expect.poll(async () => (await elements()).some((e: { id: string }) => e.id === 'bloco-chat')).toBe(true);
  await send(page, 'Limpe o sketch');
  await expect.poll(async () => (await elements()).length).toBe(0);
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).last().click();
  await expect.poll(async () => (await elements()).length).toBe(1);
  await page.screenshot({ path: test.info().outputPath('sketch-chat.png') });
});

test('a late edit cannot change an item after navigating away', async ({ page }) => {
  let release!: () => void;
  await page.route('**/api/ai/chat', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'diagram', summary: 'Cache adicionado.', ops: [{ op: 'add_node', id: 'Cache atrasado' }] } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Adicione um cache');
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Outro item');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeVisible();
  release();
  await expect(chat(page).getByRole('alert')).toContainText('O item mudou');
  expect((await savedDiagram(page))?.model.order.includes('Cache atrasado')).toBe(false);
});

test('an interrupted streamed answer discards its edit until done arrives', async ({ page }) => {
  await page.route('**/api/ai/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ t: 'Vou incluir o cache.' })}\n${JSON.stringify({ edit: { kind: 'diagram', summary: 'Cache adicionado', ops: [{ op: 'add_node', id: 'Cache incompleto' }] } })}\n` }));
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Adicione um cache');
  await expect(chat(page).getByRole('alert')).toContainText('interrompida');
  expect((await savedDiagram(page))?.model.order.includes('Cache incompleto')).toBe(false);
  await expect(chat(page).getByRole('button', { name: 'Desfazer alteração' })).toHaveCount(0);
});

test('a complete streamed edit applies and a malformed batch leaves the diagram intact', async ({ page }) => {
  let n = 0;
  await page.route('**/api/ai/chat', (route) => {
    const ops = ++n === 1 ? [{ op: 'add_node', id: 'Cache streaming', icon: 'redis' }] : [{ op: 'add_node', id: 'Não deve existir' }, { op: 'connect', from: 'Inexistente', to: 'Kafka' }];
    return route.fulfill({ contentType: 'application/x-ndjson', body: [{ t: 'Vou atualizar.' }, { edit: { kind: 'diagram', summary: 'Cache adicionado.', ops } }, { done: true }].map((e) => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Adicione um cache');
  await expect.poll(async () => (await savedDiagram(page))?.model.order.includes('Cache streaming')).toBe(true);
  await expect(chat(page).getByRole('button', { name: 'Desfazer alteração' })).toBeVisible();
  await send(page, 'Mais uma alteração');
  await expect(chat(page).getByRole('alert')).toBeVisible();
  const model = (await savedDiagram(page))!.model;
  expect(model.order.includes('Não deve existir')).toBe(false);
  expect(model.order.includes('Cache streaming')).toBe(true);
});

test('a document edited while the AI is thinking keeps the manual changes', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Documento concorrente');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').fill('Texto original');
  let release!: () => void;
  await page.route('**/api/ai/chat', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'doc', summary: 'Revisado.', markdown: 'Texto da IA' } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Revise o documento');
  await expect.poll(() => !!release).toBe(true);
  await page.locator('.cm-content').fill('Texto editado manualmente');
  release();
  await expect(chat(page).getByRole('alert')).toContainText('O item mudou');
  await expect(page.locator('.cm-content')).toContainText('Texto editado manualmente');
  await expect.poll(() => readFile(page, 'docs/documento-concorrente.md')).toBe('Texto editado manualmente');
});

test('chat splits a diagram into two real items, persists them and undoes both parts', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai/chat', (route) => {
    const body = route.request().postDataJSON();
    const edit = ++calls === 1 ? {
      kind: 'diagram', summary: 'Arquitetura preparada.', ops: [
        ...JSON.parse(body.target.content).nodes.map((n: { id: string }) => ({ op: 'remove', id: n.id })),
        { op: 'add_node', id: 'Consulta API', description: 'Recebe perguntas', icon: 'nodejs' },
        { op: 'add_node', id: 'Banco compartilhado', icon: 'postgresql' },
        { op: 'add_node', id: 'Indexador docs' },
        { op: 'connect', from: 'Consulta API', to: 'Banco compartilhado', label: 'busca' },
        { op: 'connect', from: 'Indexador docs', to: 'Banco compartilhado', label: 'indexa' },
      ],
    } : { kind: 'split_diagram', summary: 'Consulta e ingestão separadas.', parts: [
      { title: 'Consulta', elements: ['Consulta API', 'Banco compartilhado'] },
      { title: 'Ingestão', elements: ['Indexador docs', 'Banco compartilhado'] },
    ] };
    return route.fulfill({ contentType: 'application/x-ndjson', body: [{ t: 'Vou organizar por responsabilidade.' }, { edit }, { done: true }].map(e => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Prepare uma arquitetura de consulta e ingestão');
  await expect.poll(async () => (await savedDiagram(page))?.model.order).toEqual(['Consulta API', 'Banco compartilhado', 'Indexador docs']);
  const original = await savedDiagram(page);
  await send(page, 'Divida em dois diagramas porque em um só fica difícil visualizar');
  await expect(chat(page).getByText('Consulta e ingestão separadas.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page))?.model.order).toEqual(['Consulta API', 'Banco compartilhado']);
  await expect.poll(async () => (await savedDiagram(page, 'ingestao'))?.model.order).toEqual(['Banco compartilhado', 'Indexador docs']);
  const ingest = (await savedDiagram(page, 'ingestao'))!;
  expect(ingest.model.edges).toHaveLength(1);
  expect(ingest.layout.nodes['Banco compartilhado']).toEqual(original!.layout.nodes['Banco compartilhado']);
  expect((await savedDiagram(page))!.model.elements['Consulta API']?.description).toBe('Recebe perguntas');
  await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Ingestão', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chat-split-diagram.png') });
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).last().click();
  await expect.poll(async () => (await savedDiagram(page))?.model.order).toEqual(original!.model.order);
  await expect.poll(() => readFile(page, 'diagrams/ingestao.strukt.json')).toBeNull();
  await send(page, 'Separe consulta e ingestão em dois diagramas');
  await expect.poll(() => readFile(page, 'diagrams/ingestao.strukt.json')).not.toBeNull();
  await page.reload();
  await expect.poll(async () => (await savedDiagram(page, 'ingestao'))?.model.order).toEqual(['Banco compartilhado', 'Indexador docs']);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Ingestão', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="Indexador docs"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="Consulta API"]')).toHaveCount(0);
});
