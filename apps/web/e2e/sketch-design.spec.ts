import { test, expect } from '@playwright/test';
import { readFile } from './storage';
import type { SketchShape } from '@strukt/core';
const node = (id: string, text: string, type: SketchShape['type'] = 'rectangle'): SketchShape => ({ id, text, type, x: 80, y: 140, width: 192, height: 88 });
const edge = (from: string, to: string, text?: string): SketchShape => ({ id: `${from}-${to}`, type: 'arrow', from, to, text, x: 0, y: 0, width: 0, height: 0 });
const shapes = [{ id: 'title', type: 'text' as const, text: 'RAG · Consulta e ingestão', fontSize: 30, x: 80, y: 40, width: 0, height: 0 }, node('user', 'Usuário', 'ellipse'), { ...node('api', 'API de perguntas'), strokeColor: '#1971c2', backgroundColor: '#e7f5ff' }, node('search', 'Busca semântica'), node('llm', 'Modelo de linguagem'), node('docs', 'Documentos'), node('index', 'Indexador'), node('vectors', 'Banco vetorial'), node('cache', 'Cache de respostas'),
  edge('user', 'api', 'pergunta'), edge('api', 'search'), edge('search', 'llm', 'contexto'), edge('docs', 'index', 'ingestão'), edge('index', 'vectors', 'indexa'), edge('vectors', 'search', 'top-k'), edge('api', 'cache', 'consulta'),
];
for (const theme of ['light', 'dark'] as const) {
  test(`sketch architecture has readable bound labels, routed arrows and editable names in ${theme}`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('strukt:theme', value), theme);
    await page.goto('/app/');
    await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo sketch' }).click();
    await page.getByRole('textbox', { name: /sketch/i }).fill('RAG legível');
    await page.keyboard.press('Enter');
    await expect(page.locator('.excalidraw .App-menu_top')).toBeVisible();
    let call = 0;
    await page.route('**/api/ai/chat', (route) => {
      call++;
      const api = JSON.parse(route.request().postDataJSON().target.content).elements?.find((el: any) => el.id === 'api');
      const edit = call === 1 ? { layout: 'horizontal', upsert: shapes } : call === 2 ? { upsert: [{ ...shapes[2], text: 'API revisada', x: api.x, y: api.y }] } : { remove: ['api'], upsert: [] };
      return route.fulfill({ json: { reply: 'Certo.', edit: { kind: 'sketch', summary: 'Sketch organizado.', clear: false, remove: [], ...edit } } });
    });
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    const send = async (text: string) => { await chat.getByRole('textbox', { name: 'Mensagem para a IA' }).fill(text); await chat.getByRole('button', { name: 'Enviar', exact: true }).click(); };
    const scene = async () => JSON.parse(await readFile(page, 'sketches/rag-legivel.excalidraw') ?? '{"elements":[]}');
    await send('Desenhe uma arquitetura RAG organizada na horizontal');
    await expect.poll(async () => (await scene()).elements.filter((e: any) => e.type === 'text').length).toBe(shapes.filter((s) => s.text).length);
    const elements = (await scene()).elements;
    await info.attach('scene.json', { body: JSON.stringify(await scene()), contentType: 'application/json' });
    for (const shape of shapes.filter((s) => s.text)) {
      const label = elements.find((e: any) => shape.type === 'text' ? e.id === shape.id : e.containerId === shape.id);
      expect(label.width).toBeGreaterThan(0);
      if (shape.type === 'text') continue;
      expect(label?.originalText).toBe(shape.text);
      expect(label.text.replace(/\s+/g, ' ')).toBe(shape.text);
      expect(label.fontFamily).toBe(2);
      const owner = elements.find((e: any) => e.id === shape.id);
      expect(owner.boundElements.some((e: any) => e.id === label.id)).toBe(true);
      if (owner.type !== 'arrow') {
        expect(label.x).toBeGreaterThanOrEqual(owner.x);
        expect(label.y).toBeGreaterThanOrEqual(owner.y);
        expect(label.x + label.width).toBeLessThanOrEqual(owner.x + owner.width + 1);
        expect(label.y + label.height).toBeLessThanOrEqual(owner.y + owner.height + 1);
      }
    }
    for (const shape of shapes.filter((s) => s.from)) {
      const arrow = elements.find((e: any) => e.id === shape.id);
      expect(arrow.startBinding?.elementId).toBe(shape.from);
      expect(arrow.endBinding?.elementId).toBe(shape.to);
    }
    await page.screenshot({ path: info.outputPath('rag-sketch.png'), animations: 'disabled' });
    const labelId = elements.find((e: any) => e.containerId === 'api').id;
    await send('Renomeie a API para API revisada');
    await expect.poll(async () => (await scene()).elements.find((e: any) => e.id === labelId)?.text).toBe('API revisada');
    expect((await scene()).elements.filter((e: any) => e.containerId === 'api')).toHaveLength(1);
    await chat.getByRole('button', { name: 'Desfazer alteração' }).last().click();
    await expect.poll(async () => (await scene()).elements.find((e: any) => e.id === labelId)?.text).toBe('API de perguntas');
    await send('Remova a API');
    await expect.poll(async () => (await scene()).elements.some((e: any) => e.id === labelId || e.id === 'api')).toBe(false);
    await chat.getByRole('button', { name: 'Desfazer alteração' }).last().click();
    await expect.poll(async () => (await scene()).elements.some((e: any) => e.id === 'api')).toBe(true);
    await page.reload();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'RAG legível', exact: true }).click();
    await expect(page.locator('.excalidraw .App-menu_top')).toBeVisible();
    expect((await scene()).elements.filter((e: any) => e.containerId === 'api')).toHaveLength(1);
  });
}
