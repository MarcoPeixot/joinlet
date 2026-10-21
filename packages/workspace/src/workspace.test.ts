import { applyOps, emptyModel, semanticView } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { emptyBoard } from './board';
import type { DiagramSnapshot } from './diagram';
import { printManifest } from './manifest';
import { createMemoryAdapter, replaceFiles, writeFiles } from './storage';
import { addItem, loadWorkspace, newWorkspace, removeItem, renameItem, workspaceFiles } from './workspace';

function scratch(): DiagramSnapshot {
  const result = applyOps(emptyModel(), [
    { op: 'add_node', id: 'API' },
    { op: 'add_node', id: 'Banco', shape: 'cylinder' },
    { op: 'connect', from: 'API', to: 'Banco' },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: { API: { x: 10, y: 20 }, Banco: { x: 300, y: 20 } }, edges: {} } };
}

describe('workspace data', () => {
  it('migrates a scratch diagram into a new workspace with a Quadro card', () => {
    const data = newWorkspace('Meu workspace', { title: 'Sem título', snapshot: scratch() });
    expect(data.manifest.diagrams).toEqual([{ slug: 'sem-titulo', title: 'Sem título' }]);
    expect(data.diagrams['sem-titulo']).toEqual(scratch());
    expect(data.board.cards.map((c) => c.id)).toEqual(['diagram:sem-titulo']);
  });

  it('adds items with unique slugs and default content', () => {
    let data = newWorkspace('Loja');
    let slug: string;
    ({ data, slug } = addItem(data, 'doc', 'Visão geral'));
    expect(slug).toBe('visao-geral');
    expect(data.docs[slug]).toBe('# Visão geral\n\n');
    ({ data, slug } = addItem(data, 'doc', 'Visão Geral!'));
    expect(slug).toBe('visao-geral-2');
    ({ data, slug } = addItem(data, 'sketch', 'Ideias'));
    expect(JSON.parse(data.sketches[slug]!).type).toBe('excalidraw');
    ({ data, slug } = addItem(data, 'diagram', 'Visão geral'));
    expect(slug).toBe('visao-geral');
    expect(data.diagrams[slug]!.model.order).toEqual([]);
    expect(data.board.cards).toHaveLength(4);
  });

  it('renames keep the slug; removals drop content and the card', () => {
    let { data } = addItem(newWorkspace('Loja'), 'doc', 'API');
    data = renameItem(data, 'doc', 'api', 'API pública');
    expect(data.manifest.docs).toEqual([{ slug: 'api', title: 'API pública' }]);
    data = removeItem(data, 'doc', 'api');
    expect(data.manifest.docs).toEqual([]);
    expect(data.docs).toEqual({});
    expect(data.board.cards).toEqual([]);
  });

  it('persists accuracy concerns and removes those tied to a deleted diagram', async () => {
    const data = newWorkspace('Loja', { title: 'API', snapshot: scratch() });
    data.concerns = [{ id: 'c1', diagram: 'api', element: 'API', message: 'Cache ausente', status: 'open', createdAt: '2026-09-24T00:00:00Z' }];
    const loaded = await loadWorkspace(createMemoryAdapter(workspaceFiles(data)));
    expect(loaded?.data.concerns).toEqual(data.concerns);
    expect(removeItem(data, 'diagram', 'api').concerns).toEqual([]);
  });
});

describe('loading and writing', () => {
  it('writes the manifest last and reads everything back', async () => {
    let data = newWorkspace('Loja', { title: 'Loja', snapshot: scratch() });
    data = addItem(data, 'doc', 'API', '# API\n\nREST.\n').data;
    data = addItem(data, 'sketch', 'Ideias').data;
    const adapter = createMemoryAdapter();
    const order: string[] = [];
    const write = adapter.write;
    await writeFiles({ ...adapter, write: (path, text) => (order.push(path), write(path, text)) }, workspaceFiles(data));
    expect(order.at(-1)).toBe('strukt.json');
    expect([...adapter.files.keys()].sort()).toEqual([
      'board.json', 'diagrams/loja.layout.json', 'diagrams/loja.strukt.json', 'docs/api.md', 'sketches/ideias.excalidraw', 'strukt.json',
      'strukt.schema.json',
    ]);
    expect(JSON.parse(adapter.files.get('strukt.schema.json')!)).toMatchObject({ title: 'Diagrama do Joinlet' });
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.data.manifest).toEqual(data.manifest);
    expect(semanticView(loaded!.data.diagrams.loja!.model)).toEqual(semanticView(data.diagrams.loja!.model));
    expect(loaded?.data.diagrams.loja!.layout).toEqual(data.diagrams.loja!.layout);
    expect(loaded?.data.docs).toEqual(data.docs);
    expect(loaded?.data.sketches).toEqual(data.sketches);
    expect(loaded?.data.board).toEqual(data.board);
  });

  it('returns null without a manifest and fills in missing files', async () => {
    expect(await loadWorkspace(createMemoryAdapter())).toBeNull();
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [{ slug: 'd', title: 'D' }], sketches: [] };
    const loaded = await loadWorkspace(createMemoryAdapter({ 'strukt.json': printManifest(manifest) }));
    expect(loaded?.data.diagrams.a!.model.order).toEqual([]);
    expect(loaded?.data.docs.d).toBe('');
    expect(loaded?.data.board.cards.map((c) => c.id)).toEqual(['diagram:a', 'doc:d']);
  });

  it('backs up a diagram file with errors before anything can overwrite it', async () => {
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const broken = '{\n  "version": 1,\n  "nodes": [}\n}';
    const adapter = createMemoryAdapter({ 'strukt.json': printManifest(manifest), 'diagrams/a.strukt.json': broken });
    const loaded = await loadWorkspace(adapter);
    expect(adapter.files.get('diagrams/a.strukt.json.bak')).toBe(broken);
    expect(loaded?.warnings[0]).toMatch(/^diagrams\/a\.strukt\.json tem erros \(linha 3: .+\); o original foi copiado para diagrams\/a\.strukt\.json\.bak\.$/);
    expect(loaded?.data.diagrams.a!.model.order).toEqual([]);
  });

  it('does not rewrite a backup that already holds the same text, and never fails the load over the backup', async () => {
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const broken = '{\n<<<<<<< HEAD\n  "version": 1,\n=======\n  "version": 2,\n>>>>>>> main\n}';
    // A collaboration guest: the host wrote the .bak when it opened the workspace, and refuses a write that does not
    // know the file is there (409), like the LAN host's `expected: null`.
    const host = createMemoryAdapter({ 'strukt.json': printManifest(manifest), 'diagrams/a.strukt.json': broken, 'diagrams/a.strukt.json.bak': broken });
    const writes: string[] = [];
    const guest = { ...host, write: async (path: string) => { writes.push(path); throw new Error('Arquivo alterado fora da sessão.'); } };
    const loaded = await loadWorkspace(guest);
    expect(writes).toEqual([]);
    expect(loaded?.data.diagrams.a!.model.order).toEqual([]);
    expect(loaded?.warnings[0]).toContain('o original foi copiado para diagrams/a.strukt.json.bak');

    // An older, different backup: the write is tried; its failure becomes a warning, not a failed load.
    host.files.set('diagrams/a.strukt.json.bak', 'older');
    const again = await loadWorkspace(guest);
    expect(writes).toEqual(['diagrams/a.strukt.json.bak']);
    expect(again?.data.diagrams.a!.model.order).toEqual([]);
    expect(again?.warnings[0]).toMatch(/^diagrams\/a\.strukt\.json tem erros \(linha \d+: .+\); não foi possível copiar o original para diagrams\/a\.strukt\.json\.bak\.$/);
  });

  it('migrates a legacy .strukt into .strukt.json and keeps the original as .bak', async () => {
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const legacy = 'A [icon: server]\nB [shape: cylinder]\n\nA > B: SQL\n';
    const adapter = createMemoryAdapter({
      'strukt.json': printManifest(manifest),
      'diagrams/a.strukt': legacy,
      'diagrams/a.layout.json': '{"version":1,"nodes":{"A":{"x":10,"y":20}}}',
    });
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.warnings).toEqual(['diagrams/a.strukt foi convertido para diagrams/a.strukt.json; o original virou diagrams/a.strukt.bak.']);
    expect(adapter.files.get('diagrams/a.strukt.bak')).toBe(legacy);
    expect(adapter.files.get('diagrams/a.strukt.json')).toContain('"id": "A"');
    expect(loaded?.data.diagrams.a!.layout.nodes).toEqual({ A: { x: 10, y: 20 } });
    expect(loaded?.data.diagrams.a!.model.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'SQL' });

    const second = await loadWorkspace(adapter);
    expect(second?.warnings).toEqual([]);
    expect(second?.data.diagrams.a!.model.order).toEqual(['A', 'B']);
  });

  it('loads a workspace whose board.json has a gigantic section (never scans forever for a free cell)', async () => {
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const board = JSON.stringify({ version: 1, cards: [], sections: [{ id: 's', title: 'S', x: 0, y: 0, w: 1e300, h: 1e300 }], connections: [] });
    const loaded = await loadWorkspace(createMemoryAdapter({ 'strukt.json': printManifest(manifest), 'board.json': board }));
    expect(loaded?.data.board.cards.map((c) => c.id)).toEqual(['diagram:a']);
  });

  it('reports warning-level diagnostics (constructs the Joinlet drops) without a backup', async () => {
    const manifest = { version: 1, name: 'x', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const text = '{"version": 1, "nodes": [{"id": "A"}], "connections": [{"from": "A", "to": "B"}]}';
    const adapter = createMemoryAdapter({ 'strukt.json': printManifest(manifest), 'diagrams/a.strukt.json': text });
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.warnings).toHaveLength(1);
    expect(loaded?.warnings[0]).toMatch(/^diagrams\/a\.strukt\.json: o Joinlet ignorou 1 trecho\(s\) \(linha 1: .*não existe.*\); eles saem do arquivo na próxima mudança do diagrama\.$/);
    expect(adapter.files.has('diagrams/a.strukt.json.bak')).toBe(false);
  });

  it('replaceFiles leaves exactly the given files', async () => {
    const adapter = createMemoryAdapter({ 'strukt.json': '{}', 'docs/velho.md': 'x' });
    await replaceFiles(adapter, { 'strukt.json': '{"v":1}', 'docs/novo.md': 'y' });
    expect(Object.fromEntries(adapter.files)).toEqual({ 'strukt.json': '{"v":1}', 'docs/novo.md': 'y' });
  });
});

describe('hostile slugs', () => {
  it('replaceFiles removes files named like Object.prototype members', async () => {
    const adapter = createMemoryAdapter({ constructor: 'a', toString: 'b', 'strukt.json': '{}' });
    await replaceFiles(adapter, { 'strukt.json': '{"v":1}' });
    expect(await adapter.list()).toEqual(['strukt.json']);
  });

  it('workspaceFiles never reads content through the prototype chain', () => {
    const manifest = {
      version: 1,
      name: 'x',
      diagrams: [{ slug: 'constructor', title: 'Constructor' }],
      docs: [{ slug: 'toString', title: 'ToString' }],
      sketches: [{ slug: 'constructor', title: 'Constructor' }],
    };
    const data = { manifest, diagrams: {}, docs: {}, sketches: {}, board: emptyBoard() };
    const files = workspaceFiles(data);
    expect(typeof files['diagrams/constructor.strukt.json']).toBe('string');
    expect(files['docs/toString.md']).toBe('');
    expect(JSON.parse(files['sketches/constructor.excalidraw']!).type).toBe('excalidraw');
  });

  it('an item literally titled "constructor" round-trips through files and back', async () => {
    const { data } = addItem(newWorkspace('Loja'), 'doc', 'constructor');
    const adapter = createMemoryAdapter();
    await writeFiles(adapter, workspaceFiles(data));
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.data.docs.constructor).toBe(data.docs.constructor);
  });
});

describe('loadWorkspace concurrency', () => {
  /** Reads stay pending until the test releases them: no wall-clock involved. */
  function gatedAdapter(files: Record<string, string>) {
    const inner = createMemoryAdapter(files);
    const stats = { active: 0, peak: 0, total: 0 };
    const waiting: Array<() => void> = [];
    const read = async (path: string) => {
      stats.active += 1;
      stats.total += 1;
      stats.peak = Math.max(stats.peak, stats.active);
      await new Promise<void>((resolve) => waiting.push(resolve));
      stats.active -= 1;
      return inner.read(path);
    };
    /** Releases every pending read, wave after wave, until loading is done. Returns the widest wave. */
    async function drain(loading: Promise<unknown>) {
      let done = false;
      void loading.then(() => { done = true; }, () => { done = true; });
      let widest = 0;
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 0)); // let all microtasks settle
        widest = Math.max(widest, waiting.length);
        waiting.splice(0).forEach((release) => release());
      }
      return widest;
    }
    return { adapter: { ...inner, read }, stats, drain };
  }

  const many = (count: number) => {
    let data = newWorkspace('Loja');
    for (let index = 0; index < count; index += 1) {
      data = addItem(data, 'diagram', `Diagrama ${index}`, scratch()).data;
      data = addItem(data, 'doc', `Doc ${index}`).data;
      data = addItem(data, 'sketch', `Sketch ${index}`).data;
    }
    return data;
  };

  it('reads diagrams, docs and sketches in parallel with at most 8 reads in flight, keeping manifest order', async () => {
    const data = many(20);
    const files = workspaceFiles(data);
    const serial = await loadWorkspace(createMemoryAdapter(files));
    const { adapter, stats, drain } = gatedAdapter(files);
    const pending = loadWorkspace(adapter);
    const widest = await drain(pending);
    const loaded = await pending;
    expect(loaded).toEqual(serial);
    expect(Object.keys(loaded!.data.diagrams)).toEqual(data.manifest.diagrams.map((d) => d.slug));
    expect(stats.peak).toBeGreaterThan(1);
    expect(stats.peak).toBeLessThanOrEqual(8);
    expect(widest).toBeGreaterThan(1);
    expect(widest).toBeLessThanOrEqual(8);
    expect(stats.total).toBeGreaterThan(20);
  });

  it('still converts a legacy .strukt and reports warnings in manifest order under concurrency', async () => {
    const data = many(3);
    const files = workspaceFiles(data);
    const slugs = data.manifest.diagrams.map((d) => d.slug);
    for (const slug of [slugs[0]!, slugs[2]!]) {
      delete files[`diagrams/${slug}.strukt.json`];
      files[`diagrams/${slug}.strukt`] = 'API [icon: server]\n';
    }
    const { adapter, drain } = gatedAdapter(files);
    const pending = loadWorkspace(adapter);
    await drain(pending);
    const loaded = await pending;
    expect(loaded!.warnings).toHaveLength(2);
    expect(loaded!.warnings[0]).toContain(slugs[0]!);
    expect(loaded!.warnings[1]).toContain(slugs[2]!);
  });

  it('persists each diagram\'s perspectives in its own file, and drops them with the diagram', async () => {
    const data = newWorkspace('Loja', { title: 'API', snapshot: scratch() });
    data.perspectives = { api: [{ id: 'riscos', name: 'Riscos', tags: ['risco:alto'] }] };
    const files = workspaceFiles(data);
    expect(JSON.parse(files['diagrams/api.perspectives.json']!)).toEqual({ version: 1, perspectives: [{ id: 'riscos', name: 'Riscos', tags: ['risco:alto'] }] });
    const loaded = await loadWorkspace(createMemoryAdapter(files));
    expect(loaded?.data.perspectives).toEqual(data.perspectives);
    expect(removeItem(data, 'diagram', 'api').perspectives).toEqual({});
    expect(workspaceFiles({ ...data, perspectives: { api: [] } })['diagrams/api.perspectives.json']).toBeUndefined();
  });

  it('loads a workspace whose perspectives file is broken, without them', async () => {
    const data = newWorkspace('Loja', { title: 'API', snapshot: scratch() });
    const files = { ...workspaceFiles(data), 'diagrams/api.perspectives.json': '{ não é json' };
    const loaded = await loadWorkspace(createMemoryAdapter(files));
    expect(loaded?.data.diagrams.api).toBeDefined();
    expect(loaded?.data.perspectives?.api ?? []).toEqual([]);
  });
});
