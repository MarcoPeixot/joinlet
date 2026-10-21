import { applyOps, emptyModel } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirs, connectClient, isErrorOf, manifestOf, tempDir, textOf, writeArch } from './testing';
import { openMcpWorkspace } from './workspace';

afterEach(cleanupDirs);

const diagram = (() => {
  const result = applyOps(emptyModel(), [
    { op: 'add_node', id: 'Usuário' }, { op: 'add_group', id: 'Sistema' }, { op: 'add_node', id: 'API', parentId: 'Sistema', tech: 'Node' },
    { op: 'add_node', id: 'DB', parentId: 'Sistema', tech: 'Postgres' }, { op: 'connect', from: 'Usuário', to: 'API' }, { op: 'connect', from: 'API', to: 'DB' },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  return printDiagramJson(result.model);
})();
const shared = { version: 1, entities: { u: { id: 'u', tags: ['nivel:contexto'] }, s: { id: 's', tags: ['nivel:contexto'] }, a: { id: 'a', tags: ['nivel:container', 'risco:alto'] }, d: { id: 'd', tags: ['nivel:container'] } }, views: { a: { Usuário: 'u', Sistema: 's', API: 'a', DB: 'd' } } };

async function open(extra: Record<string, string> = {}) {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }]),
    'diagrams/a.strukt.json': diagram,
    'diagrams/b.strukt.json': diagram,
    'model.json': JSON.stringify(shared),
    'diagrams/a.perspectives.json': JSON.stringify({ version: 1, perspectives: [{ id: 'riscos', name: 'Riscos', tags: ['risco:alto'] }] }),
    ...extra,
  });
  const ws = await openMcpWorkspace(root);
  if ('error' in ws) throw new Error(ws.error);
  return ws;
}

const call = async (args: Record<string, unknown>, extra?: Record<string, string>) => {
  const { client, close } = await connectClient(await open(extra));
  try {
    return await client.callTool({ name: 'get_perspectives', arguments: args });
  } finally {
    await close();
  }
};

describe('get_perspectives', () => {
  it('is listed among the tools', async () => {
    const { client, close } = await connectClient(await open());
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('get_perspectives');
    await close();
  });

  it('lists a diagram\'s saved and C4 perspectives and its levels', async () => {
    const result = await call({ diagram: 'a' });
    expect(isErrorOf(result)).toBe(false);
    const body = JSON.parse(textOf(result));
    expect(body.perspectives.map((item: { id: string; builtin: boolean }) => [item.id, item.builtin])).toEqual([['riscos', false], ['c4-contexto', true], ['c4-containers', true], ['c4-componentes', true]]);
    expect(body.perspectives[0].shows).toEqual({ shown: 1, of: 3 });
    expect(body.levels).toEqual({ Usuário: 'contexto', Sistema: 'contexto', API: 'container', DB: 'container' });
  });

  it('says what a perspective shows: elements, collapsed groups and the connections it leaves', async () => {
    const body = JSON.parse(textOf(await call({ diagram: 'a', perspective: 'c4-contexto' })));
    expect(body.shown.ids.sort()).toEqual(['Sistema', 'Usuário']);
    expect(body.hidden.ids.sort()).toEqual(['API', 'DB']);
    expect(body.collapsedGroups.ids).toEqual(['Sistema']);
    expect(body.connections).toEqual([{ from: 'Usuário', to: 'Sistema' }]);
  });

  it('summarizes every diagram without an argument', async () => {
    const body = JSON.parse(textOf(await call({})));
    expect(body.map((item: { diagram: string }) => item.diagram)).toEqual(['a', 'b']);
    expect(body[0].perspectives[0]).toEqual({ id: 'riscos', name: 'Riscos', builtin: false });
    expect(body[1].perspectives.map((item: { id: string }) => item.id)).toEqual(['c4-contexto', 'c4-containers', 'c4-componentes']);
    expect(body[0].leveled).toBe(4);
  });

  it('refuses unknown diagrams and perspectives with a useful message, whatever the name', async () => {
    for (const name of ['nope', 'constructor', '__proto__']) {
      const result = await call({ diagram: name });
      expect(isErrorOf(result)).toBe(true);
      expect(textOf(result)).toContain('não encontrado');
    }
    const result = await call({ diagram: 'a', perspective: 'constructor' });
    expect(isErrorOf(result)).toBe(true);
    expect(textOf(result)).toContain('riscos');
  });

  it('copes with a broken perspectives file', async () => {
    const body = JSON.parse(textOf(await call({ diagram: 'a' }, { 'diagrams/a.perspectives.json': '{ quebrado' })));
    expect(body.perspectives.map((item: { id: string }) => item.id)).toEqual(['c4-contexto', 'c4-containers', 'c4-componentes']);
  });
});
