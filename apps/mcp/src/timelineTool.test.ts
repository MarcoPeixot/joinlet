import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyModel } from '@strukt/core';
import { createVersion, printVersion, versionPath } from '@strukt/workspace';
import type { Version } from '@strukt/workspace';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirs, connectClient, diagramJson, isErrorOf, manifestOf, tempDir, textOf, writeArch } from './testing';
import { openMcpWorkspace } from './workspace';

afterEach(cleanupDirs);

const snapshot = { model: emptyModel(), layout: { nodes: {}, edges: {} } };
const dayOffset = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function versionFile(slug: string, meta: Omit<Version, 'json' | 'layout'>): Record<string, string> {
  return { [versionPath(slug, meta)]: printVersion(createVersion(snapshot, meta)) };
}

async function open(extra: Record<string, string> = {}) {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }]),
    'diagrams/a.strukt.json': diagramJson('API'),
    'diagrams/b.strukt.json': diagramJson('Web'),
    ...extra,
  });
  const ws = await openMcpWorkspace(root);
  if ('error' in ws) throw new Error(ws.error);
  return { ws, root };
}

const parse = (result: unknown) => JSON.parse(textOf(result as never));

describe('get_timeline', () => {
  it('is listed, and an empty diagram has only today', async () => {
    const { ws } = await open();
    const { client, close } = await connectClient(ws);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('get_timeline');
    const out = parse(await client.callTool({ name: 'get_timeline', arguments: { diagram: 'a' } }));
    expect(out.diagrams).toHaveLength(1);
    expect(out.diagrams[0]).toMatchObject({ diagram: 'a', nextGoal: null });
    expect(out.diagrams[0].points).toEqual([expect.objectContaining({ kind: 'today', stage: 'atual', daysFromToday: 0 })]);
    await close();
  });

  it('lays versions written by humans, agents and the CLI on one ordered axis, with goals and countdown', async () => {
    const { ws } = await open({
      ...versionFile('a', { id: 'old1', createdAt: '2026-01-10T10:00:00.000Z', message: 'Antiga', author: 'human' }),
      ...versionFile('a', { id: 'plan1', createdAt: '2026-02-01T10:00:00.000Z', message: 'Sem monolito', author: 'agent', stage: 'planejado', target: dayOffset(30) }),
      ...versionFile('a', { id: 'step1', createdAt: '2026-02-02T10:00:00.000Z', message: 'Passo 1', author: 'agent', stage: 'transição', target: dayOffset(10) }),
      ...versionFile('a', { id: 'late1', createdAt: '2026-02-03T10:00:00.000Z', message: 'Vencida', author: 'human', stage: 'planejado', target: dayOffset(-5) }),
      ...versionFile('a', { id: 'free1', createdAt: '2026-02-04T10:00:00.000Z', message: 'Sem data', author: 'human', stage: 'planejado' }),
      ...versionFile('b', { id: 'bb1', createdAt: '2026-03-01T10:00:00.000Z', message: 'Outro diagrama', author: 'human' }),
    });
    const { client, close } = await connectClient(ws);
    const out = parse(await client.callTool({ name: 'get_timeline', arguments: { diagram: 'a' } }));
    const [timeline] = out.diagrams;
    expect(timeline.points.map((p: { id?: string; kind: string }) => p.id ?? p.kind)).toEqual(['old1', 'today', 'late1', 'step1', 'plan1', 'free1']);
    expect(timeline.points.map((p: { daysFromToday: number | null }) => p.daysFromToday)).toEqual([expect.any(Number), 0, -5, 10, 30, null]);
    expect(timeline.points[2]).toMatchObject({ overdue: true, stage: 'planejado', target: dayOffset(-5) });
    expect(timeline.points[3]).toMatchObject({ stage: 'transição', author: 'agent', message: 'Passo 1' });
    expect(timeline.nextGoal).toMatchObject({ id: 'step1', daysFromToday: 10 });
    expect(out.today).toBe(dayOffset(0));
    await close();
  });

  it('answers for every diagram without an argument, and can narrow to a stage', async () => {
    const { ws } = await open({ ...versionFile('a', { id: 'plan1', createdAt: '2026-02-01T10:00:00.000Z', message: 'P', author: 'human', stage: 'planejado', target: dayOffset(3) }), ...versionFile('b', { id: 'bb1', createdAt: '2026-03-01T10:00:00.000Z', message: 'Passado', author: 'human' }) });
    const { client, close } = await connectClient(ws);
    const all = parse(await client.callTool({ name: 'get_timeline', arguments: {} }));
    expect(all.diagrams.map((d: { diagram: string }) => d.diagram)).toEqual(['a', 'b']);
    const planned = parse(await client.callTool({ name: 'get_timeline', arguments: { stage: 'planejado' } }));
    expect(planned.diagrams[0].points.map((p: { id?: string }) => p.id)).toEqual(['plan1']);
    expect(planned.diagrams[1].points).toEqual([]);
    expect(isErrorOf(await client.callTool({ name: 'get_timeline', arguments: { stage: 'futuro' } }))).toBe(true);
    expect(isErrorOf(await client.callTool({ name: 'get_timeline', arguments: { diagram: 'nope' } }))).toBe(true);
    await close();
  });

  it('survives hostile and invalid version metadata on disk', async () => {
    const good = createVersion(snapshot, { id: 'x1', createdAt: '2026-02-01T10:00:00.000Z', message: 'Hostil', author: 'agent' });
    const raw = (extra: object) => JSON.stringify({ ...JSON.parse(printVersion(good)), ...extra });
    const { ws } = await open({
      'versions/a/20260201T100000000Z-x1.json': raw({ stage: 'planejado', target: '2027-02-30' }),
      'versions/a/20260202T100000000Z-x2.json': raw({ id: 'x2', stage: '__proto__', target: { a: 1 } }),
      'versions/a/20260203T100000000Z-x3.json': raw({ id: 'x3', stage: 'planejado', target: 20270101 }),
    });
    const { client, close } = await connectClient(ws);
    const out = parse(await client.callTool({ name: 'get_timeline', arguments: { diagram: 'a' } }));
    const byId = Object.fromEntries(out.diagrams[0].points.filter((p: { id?: string }) => p.id).map((p: { id: string }) => [p.id, p]));
    expect(byId.x1).toMatchObject({ stage: 'planejado', target: null, daysFromToday: null });
    expect(byId.x2).toMatchObject({ stage: 'atual', target: null });
    expect(byId.x3).toMatchObject({ stage: 'planejado', target: null });
    await close();
  });
});

describe('save_version with a stage', () => {
  it('saves a planned version with its goal, and refuses an invalid one without writing', async () => {
    const { ws } = await open();
    const { client, close } = await connectClient(ws);
    const saved = await client.callTool({ name: 'save_version', arguments: { diagram: 'a', message: 'Alvo Q4', stage: 'planejado', target: '2027-03-15' } });
    expect(isErrorOf(saved), textOf(saved)).toBe(false);
    const [file] = (await ws.adapter.list()).filter((path) => path.startsWith('versions/a/') && !path.endsWith('index.json'));
    expect(JSON.parse(await readFile(join(ws.archDir, file!), 'utf8'))).toMatchObject({ stage: 'planejado', target: '2027-03-15', author: 'agent' });

    const bad = await client.callTool({ name: 'save_version', arguments: { diagram: 'a', message: 'x', stage: 'planejado', target: '2027-02-30' } });
    expect(isErrorOf(bad)).toBe(true);
    expect(textOf(bad)).toContain('Meta inválida');
    const withoutStage = await client.callTool({ name: 'save_version', arguments: { diagram: 'a', message: 'x', target: '2027-03-15' } });
    expect(isErrorOf(withoutStage)).toBe(true);
    expect((await ws.adapter.list()).filter((path) => path.startsWith('versions/a/') && !path.endsWith('index.json'))).toHaveLength(1);
    await close();
  });
});
