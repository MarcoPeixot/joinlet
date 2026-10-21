import { applyOps, emptyModel, semanticView } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import type { DiagramSnapshot } from './diagram';
import { createMemoryAdapter, readFiles } from './storage';
import type { StorageAdapter } from './storage';
import {
  createVersion, listVersions, parseVersion, printVersion, readVersion, removeVersions, versionPath, versionSnapshot, writeVersion,
} from './versions';

function snapshot(ops: DiagramOp[], nodes: DiagramSnapshot['layout']['nodes']): DiagramSnapshot {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes, edges: {} } };
}

const shop = snapshot(
  [
    { op: 'add_group', id: 'Serviços', color: 'purple' },
    { op: 'add_node', id: 'API', icon: 'nginx' },
    { op: 'add_node', id: 'Pedidos', parentId: 'Serviços', tech: 'Node.js' },
    { op: 'connect', from: 'API', to: 'Pedidos', label: 'HTTPS' },
  ],
  { API: { x: 10.4, y: 20.6, w: 180 }, Pedidos: { x: 300, y: 20 }, Fantasma: { x: 1, y: 1 } },
);

const meta = { id: 'a1b2c3d4', createdAt: '2026-09-23T14:05:09.123Z', message: 'Antes do Redis', author: 'human' as const };

describe('versions', () => {
  it('snapshots the canonical JSON and the positions of existing elements', () => {
    const version = createVersion(shop, meta);
    expect(version).toEqual({
      ...meta,
      json: [
        '{',
        '  "$schema": "./strukt.schema.json",',
        '  "version": 1,',
        '  "nodes": [',
        '    {',
        '      "id": "Serviços",',
        '      "type": "group",',
        '      "color": "purple",',
        '      "children": [',
        '        {',
        '          "id": "Pedidos",',
        '          "tech": "Node.js"',
        '        }',
        '      ]',
        '    },',
        '    {',
        '      "id": "API",',
        '      "icon": "nginx"',
        '    }',
        '  ],',
        '  "connections": [',
        '    {',
        '      "from": "API",',
        '      "to": "Pedidos",',
        '      "label": "HTTPS"',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
      layout: { API: { x: 10, y: 21, w: 180 }, Pedidos: { x: 300, y: 20 } },
    });
  });

  it('names files by time and id, so they sort by date and are valid everywhere', () => {
    expect(versionPath('loja', meta)).toBe('versions/loja/20260923T140509123Z-a1b2c3d4.json');
  });

  it('prints sorted JSON and parses it back into the same diagram', () => {
    const version = createVersion(shop, meta);
    const text = printVersion(version);
    expect(text.indexOf('"author"')).toBeLessThan(text.indexOf('"createdAt"'));
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseVersion(text)).toEqual(version);
    const { snapshot: back, diagnostics } = versionSnapshot(version);
    expect(diagnostics).toEqual([]);
    expect(semanticView(back.model)).toEqual(semanticView(shop.model));
    expect(back.layout).toEqual({ nodes: { API: { x: 10, y: 21, w: 180 }, Pedidos: { x: 300, y: 20 } }, edges: {} });
  });

  it('rejects files that are not versions and tolerates missing message/author', () => {
    expect(parseVersion('{')).toBeNull();
    expect(parseVersion('[]')).toBeNull();
    expect(parseVersion(JSON.stringify({ ...meta, id: '../x', json: '{}' }))).toBeNull();
    expect(parseVersion(JSON.stringify({ ...meta, createdAt: 'ontem', json: '{}' }))).toBeNull();
    expect(parseVersion(JSON.stringify({ ...meta, json: 3 }))).toBeNull();
    const fallback = parseVersion(JSON.stringify({ id: 'x1', createdAt: meta.createdAt, json: '{"version":1,"nodes":[{"id":"A"}]}', author: 'robô' }));
    expect(fallback).toMatchObject({ id: 'x1', message: '', author: 'human', layout: {} });
    expect(fallback!.json).toBe('{"version":1,"nodes":[{"id":"A"}]}');
    expect(parseVersion(JSON.stringify({ id: 'x1', createdAt: meta.createdAt, author: 'agent', json: '{}' }))?.author).toBe('agent');
  });

  it('reads a legacy version with dsl and converts it on the fly', () => {
    const legacy = '{"id":"x1","createdAt":"2026-09-23T14:05:09.123Z","dsl":"A > B\\n","author":"ai","layout":{"A":{"x":1,"y":2}}}';
    const version = parseVersion(legacy)!;
    expect(version.json).toContain('"from": "A"');
    expect(version.author).toBe('ai');
    const { snapshot, diagnostics } = versionSnapshot(version);
    expect(diagnostics).toEqual([]);
    expect(snapshot.model.edges[0]).toMatchObject({ from: 'A', to: 'B' });
    expect(snapshot.layout.nodes).toEqual({ A: { x: 1, y: 2 } });
  });

  it('never lets ids from a version file reach a prototype', () => {
    const text = '{"id":"x1","createdAt":"2026-09-23T14:05:09.123Z","json":"{\\"version\\":1,\\"nodes\\":[{\\"id\\":\\"A\\"}]}","layout":{"__proto__":{"x":1,"y":1},"A":{"x":2,"y":2}}}';
    const version = parseVersion(text)!;
    expect(Object.keys(version.layout)).toEqual(['A']);
    expect(Object.getPrototypeOf(version.layout)).toBe(Object.prototype);
  });

  it('writes, lists newest first and skips files that are not versions', async () => {
    const adapter = createMemoryAdapter({
      'versions/loja/lixo.json': 'nada',
      'versions/loja-2/20260101T000000000Z-zz.json': printVersion(createVersion(shop, { ...meta, id: 'zz' })),
      'versions/loja/sub/20260101T000000000Z-yy.json': printVersion(createVersion(shop, { ...meta, id: 'yy' })),
    });
    const older = await writeVersion(adapter, 'loja', createVersion(shop, meta));
    const newer = await writeVersion(adapter, 'loja', createVersion(shop, { ...meta, id: 'e5f6', createdAt: '2026-09-23T15:00:00.000Z', author: 'ai' }));
    expect(older.path).toBe('versions/loja/20260923T140509123Z-a1b2c3d4.json');
    const { entries, skipped } = await listVersions(adapter, 'loja');
    expect(entries.map((e) => e.path)).toEqual([newer.path, older.path]);
    expect(entries[0]!.version.author).toBe('ai');
    expect(skipped).toEqual(['versions/loja/lixo.json']);
  });

  it('lists versions saved in the same millisecond by path, descending, the same way every time', async () => {
    const adapter = createMemoryAdapter();
    const at = '2026-09-23T14:05:09.123Z';
    await writeVersion(adapter, 'loja', createVersion(shop, { ...meta, id: 'aaaaaaaa', createdAt: at }));
    await writeVersion(adapter, 'loja', createVersion(shop, { ...meta, id: 'bbbbbbbb', createdAt: at }));
    const ids = async () => (await listVersions(adapter, 'loja')).entries.map((entry) => entry.version.id);
    expect(await ids()).toEqual(['bbbbbbbb', 'aaaaaaaa']);
    expect(await ids()).toEqual(['bbbbbbbb', 'aaaaaaaa']);
  });

  it('removes every file of a diagram and nothing else', async () => {
    const adapter = createMemoryAdapter({ 'versions/loja-2/a.json': '{}', 'diagrams/loja.strukt.json': 'A\n' });
    await writeVersion(adapter, 'loja', createVersion(shop, meta));
    expect(await removeVersions(adapter, 'loja')).toBe(2);
    expect([...adapter.files.keys()].sort()).toEqual(['diagrams/loja.strukt.json', 'versions/loja-2/a.json']);
  });
});

describe('version stage and target', () => {
  const planned = { ...meta, id: 'plan1', stage: 'planejado' as const, target: '2027-03-15', message: 'Sem monolito' };

  it('prints a plain version exactly as before and a planned one with stage and target', () => {
    const plain = printVersion(createVersion(shop, meta));
    expect(plain).not.toContain('"stage"');
    expect(plain).not.toContain('"target"');
    const text = printVersion(createVersion(shop, planned));
    expect(text.indexOf('"message"')).toBeLessThan(text.indexOf('"stage"'));
    expect(text.indexOf('"stage"')).toBeLessThan(text.indexOf('"target"'));
    expect(parseVersion(text)).toMatchObject({ stage: 'planejado', target: '2027-03-15' });
  });

  it('reads files written before stages existed (and by agents) as current versions', () => {
    const old = parseVersion(printVersion(createVersion(shop, meta)))!;
    expect(old.stage).toBeUndefined();
    expect(old.target).toBeUndefined();
    const legacy = parseVersion('{"id":"x1","createdAt":"2026-09-23T14:05:09.123Z","dsl":"A > B\\n","author":"ai"}')!;
    expect(legacy.stage).toBeUndefined();
    const agent = parseVersion(JSON.stringify({ ...JSON.parse(printVersion(createVersion(shop, meta))), stage: 'transicao', target: '2027-01-31T12:00:00Z', author: 'agent' }))!;
    expect(agent).toMatchObject({ stage: 'transição', target: '2027-01-31', author: 'agent' });
  });

  it('keeps a version readable when its stage or target is hostile or invalid', () => {
    const base = JSON.parse(printVersion(createVersion(shop, meta)));
    const read = (extra: object) => parseVersion(JSON.stringify({ ...base, ...extra }))!;
    expect(read({ stage: 'futuro', target: '2027-03-15' })).not.toHaveProperty('stage');
    expect(read({ stage: 'planejado', target: '2027-02-30' })).toMatchObject({ stage: 'planejado' });
    expect(read({ stage: 'planejado', target: '2027-02-30' })).not.toHaveProperty('target');
    expect(read({ stage: 7, target: { a: 1 } })).not.toHaveProperty('stage');
    expect(read({ stage: 'atual', target: '2027-03-15' })).not.toHaveProperty('target');
    expect(read({ stage: '__proto__' }).id).toBe('a1b2c3d4');
  });

  it('carries stage and target through write, index and list, and rebuilds them from the files', async () => {
    const adapter = createMemoryAdapter();
    const now = await writeVersion(adapter, 'loja', createVersion(shop, meta));
    const future = await writeVersion(adapter, 'loja', createVersion(shop, { ...planned, createdAt: '2026-09-24T10:00:00.000Z' }));
    expect(future.version).toMatchObject({ stage: 'planejado', target: '2027-03-15' });
    const index = JSON.parse(adapter.files.get('versions/loja/index.json')!);
    expect(index[0]).not.toHaveProperty('stage');
    expect(index[1]).toMatchObject({ stage: 'planejado', target: '2027-03-15' });
    const listed = (await listVersions(adapter, 'loja')).entries;
    expect(listed.map((e) => e.version.stage)).toEqual(['planejado', undefined]);
    expect(listed[1]!.path).toBe(now.path);

    adapter.files.delete('versions/loja/index.json');
    const rebuilt = (await listVersions(adapter, 'loja')).entries.find((e) => e.version.id === 'plan1')!;
    expect(rebuilt.version).toMatchObject({ stage: 'planejado', target: '2027-03-15' });
  });

  it('ignores a hostile stage in the index file', async () => {
    const adapter = createMemoryAdapter();
    await writeVersion(adapter, 'loja', createVersion(shop, meta));
    const file = '20260923T140509123Z-a1b2c3d4.json';
    adapter.files.set('versions/loja/index.json', JSON.stringify([{ id: 'a1b2c3d4', createdAt: meta.createdAt, message: '', author: 'human', file, stage: 'planejado', target: 'sempre' }]));
    const [entry] = (await listVersions(adapter, 'loja')).entries;
    expect(entry!.version.stage).toBe('planejado');
    expect(entry!.version).not.toHaveProperty('target');
  });
});

describe('versions index', () => {
  const indexPath = 'versions/loja/index.json';
  const counting = (adapter: StorageAdapter) => {
    const reads: string[] = [];
    return { reads, adapter: { ...adapter, read: async (path: string) => { reads.push(path); return adapter.read(path); } } as StorageAdapter };
  };
  const at = (minute: number, id: string) => ({ ...meta, id, createdAt: `2026-09-23T14:0${minute}:00.000Z`, message: `v${id}` });

  it('writeVersion maintains versions/<slug>/index.json with id, createdAt, message, author and file', async () => {
    const adapter = createMemoryAdapter();
    const a = await writeVersion(adapter, 'loja', createVersion(shop, at(1, 'aaaa')));
    await writeVersion(adapter, 'loja', createVersion(shop, { ...at(2, 'bbbb'), author: 'agent' }));
    const index = JSON.parse(adapter.files.get(indexPath)!);
    expect(index).toEqual([
      { id: 'aaaa', createdAt: '2026-09-23T14:01:00.000Z', message: 'vaaaa', author: 'human', file: a.path.split('/').pop() },
      { id: 'bbbb', createdAt: '2026-09-23T14:02:00.000Z', message: 'vbbbb', author: 'agent', file: '20260923T140200000Z-bbbb.json' },
    ]);
  });

  it('lists from the index without opening any version body', async () => {
    const adapter = createMemoryAdapter();
    await writeVersion(adapter, 'loja', createVersion(shop, at(1, 'aaaa')));
    await writeVersion(adapter, 'loja', createVersion(shop, at(2, 'bbbb')));
    const spy = counting(adapter);
    const { entries, skipped } = await listVersions(spy.adapter, 'loja');
    expect(entries.map((e) => e.version.id)).toEqual(['bbbb', 'aaaa']);
    expect(entries[0]!.path).toBe('versions/loja/20260923T140200000Z-bbbb.json');
    expect(skipped).toEqual([]);
    expect(spy.reads).toEqual([indexPath]);
    const full = await readVersion(spy.adapter, entries[1]!.path);
    expect(full?.json).toBe(createVersion(shop, at(1, 'aaaa')).json);
  });

  it('rebuilds a missing index from the directory (legacy dsl versions included) without writing', async () => {
    const legacy = JSON.stringify({ id: 'old1', createdAt: '2026-01-01T00:00:00.000Z', message: 'antiga', author: 'human', dsl: 'API\n', layout: {} });
    const adapter = createMemoryAdapter({
      'versions/loja/20260101T000000000Z-old1.json': legacy,
      'versions/loja/20260923T140100000Z-aaaa.json': printVersion(createVersion(shop, at(1, 'aaaa'))),
      'versions/loja/lixo.json': 'nada',
    });
    const { entries, skipped } = await listVersions(adapter, 'loja');
    expect(entries.map((e) => e.version.id)).toEqual(['aaaa', 'old1']);
    expect(skipped).toEqual(['versions/loja/lixo.json']);
    expect(adapter.files.has(indexPath)).toBe(false);
    expect((await readVersion(adapter, 'versions/loja/20260101T000000000Z-old1.json'))?.json).toContain('"API"');
  });

  it('rebuilds a corrupt index and a stale one in memory, never dropping versions or writing', async () => {
    const adapter = createMemoryAdapter();
    await writeVersion(adapter, 'loja', createVersion(shop, at(1, 'aaaa')));
    adapter.files.set(indexPath, '{ nope');
    expect((await listVersions(adapter, 'loja')).entries.map((e) => e.version.id)).toEqual(['aaaa']);
    expect(adapter.files.get(indexPath)).toBe('{ nope');

    // an agent/checkout adds a version file without touching the index, and another file vanishes
    adapter.files.set('versions/loja/20260923T140300000Z-cccc.json', printVersion(createVersion(shop, at(3, 'cccc'))));
    const spy = counting(adapter);
    expect((await listVersions(spy.adapter, 'loja')).entries.map((e) => e.version.id)).toEqual(['cccc', 'aaaa']);
    expect(spy.reads).toContain('versions/loja/20260923T140300000Z-cccc.json');
    adapter.files.delete('versions/loja/20260923T140100000Z-aaaa.json');
    expect((await listVersions(adapter, 'loja')).entries.map((e) => e.version.id)).toEqual(['cccc']);
  });

  it('listVersions performs zero writes on legacy versions without an index; writeVersion then produces a complete index', async () => {
    const legacy = (id: string, day: string) => JSON.stringify({ id, createdAt: `2026-01-${day}T00:00:00.000Z`, message: id, author: 'human', dsl: 'API\n', layout: {} });
    const adapter = createMemoryAdapter({
      'versions/loja/20260101T000000000Z-old1.json': legacy('old1', '01'),
      'versions/loja/20260102T000000000Z-old2.json': legacy('old2', '02'),
    });
    const writes: string[] = [];
    const spied = { ...adapter, write: async (path: string, text: string) => { writes.push(path); return adapter.write(path, text); }, remove: async (path: string) => { writes.push(path); return adapter.remove(path); } } as StorageAdapter;
    expect((await listVersions(spied, 'loja')).entries.map((e) => e.version.id)).toEqual(['old2', 'old1']);
    expect(writes).toEqual([]);
    await writeVersion(spied, 'loja', createVersion(shop, at(1, 'aaaa')));
    expect(JSON.parse(adapter.files.get(indexPath)!).map((r: { id: string }) => r.id)).toEqual(['old1', 'old2', 'aaaa']);
  });

  it('ignores hostile index entries and keeps the index file out of the version list and removal covers it', async () => {
    const adapter = createMemoryAdapter();
    await writeVersion(adapter, 'loja', createVersion(shop, at(1, 'aaaa')));
    adapter.files.set(indexPath, JSON.stringify([{ id: '__proto__', createdAt: 'x', message: 1, file: '../x.json' }, { id: 'aaaa', createdAt: 'x' }]));
    const { entries, skipped } = await listVersions(adapter, 'loja');
    expect(entries.map((e) => e.version.id)).toEqual(['aaaa']);
    expect(skipped).toEqual([]);
    expect(await removeVersions(adapter, 'loja')).toBe(2);
    expect(adapter.files.has(indexPath)).toBe(false);
  });
});

describe('readFiles', () => {
  it('reads the files that pass the filter, and a file named __proto__ stays a plain key', async () => {
    const initial = Object.fromEntries([['versions/a/1.json', '1'], ['context/llms.txt', '# x'], ['strukt.json', '{}'], ['__proto__', 'x']]);
    const files = await readFiles(createMemoryAdapter(initial), (path) => path !== 'strukt.json');
    expect(Object.keys(files).sort()).toEqual(['__proto__', 'context/llms.txt', 'versions/a/1.json']);
    expect(Object.hasOwn(files, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(files)).toBe(Object.prototype);
  });
});
