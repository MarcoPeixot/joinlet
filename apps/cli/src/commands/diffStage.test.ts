import { applyOps, emptyModel } from '@strukt/core';
import { createVersion, writeVersion } from '@strukt/workspace';
import type { DiagramSnapshot, Version } from '@strukt/workspace';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, fakeRunner, manifestOf, tempDir, writeArch } from '../testing';
import { parseArgs } from '../args';
import { runDiff } from './diff';

afterEach(cleanupDirs);

const snapshotOf = (ids: string[]): DiagramSnapshot => {
  const result = applyOps(emptyModel(), ids.map((id) => ({ op: 'add_node' as const, id })));
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: {}, edges: {} } };
};

async function workspaceWith(versions: { ids: string[]; meta: Omit<Version, 'json' | 'layout'> }[]): Promise<string> {
  const root = await tempDir();
  await writeArch(root, { 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]), 'diagrams/a.strukt.json': diagramJson('API', 'DB') });
  const opened = await openWorkspaceAt(root);
  if (!opened) throw new Error('workspace');
  for (const { ids, meta } of versions) await writeVersion(opened.adapter, 'a', createVersion(snapshotOf(ids), meta));
  return root;
}

const meta = (id: string, extra: Partial<Version> = {}): Omit<Version, 'json' | 'layout'> => ({ id, createdAt: `2026-02-0${id.length}T10:00:00.000Z`, message: id, author: 'human', ...extra });

describe('joinlet diff --stage', () => {
  it('compares the diagram on disk with its planned version', async () => {
    const root = await workspaceWith([{ ids: ['API', 'DB', 'Cache'], meta: meta('p1', { stage: 'planejado', target: '2099-01-01' }) }]);
    const out = fakeIo();
    expect(await runDiff(argsOf('diff', '--stage', 'planejado', '--dir', root), out, fakeRunner({}))).toBe(0);
    expect(out.outText).toContain('Comparando "árvore de trabalho" → "planejado"');
    expect(out.outText).toContain('+ Cache');
  });

  it('picks the nearest goal that is still ahead', async () => {
    const root = await workspaceWith([
      { ids: ['API', 'DB', 'Perto'], meta: meta('near', { stage: 'planejado', target: '2098-01-01' }) },
      { ids: ['API', 'DB', 'Longe'], meta: meta('farr', { stage: 'planejado', target: '2099-01-01' }) },
      { ids: ['API', 'DB', 'Vencida'], meta: meta('old', { stage: 'planejado', target: '2020-01-01' }) },
    ]);
    const out = fakeIo();
    await runDiff(argsOf('diff', '--stage', 'planejado', '--dir', root), out, fakeRunner({}));
    expect(out.outText).toContain('+ Perto');
    expect(out.outText).not.toContain('Longe');
    expect(out.outText).not.toContain('Vencida');
  });

  it('accepts the stage without an accent, and "atual" compares with the newest current version', async () => {
    const root = await workspaceWith([
      { ids: ['API', 'DB', 'Passo'], meta: meta('t1', { stage: 'transição', target: '2099-01-01' }) },
      { ids: ['API'], meta: meta('a1') },
    ]);
    const transition = fakeIo();
    await runDiff(argsOf('diff', '--stage', 'transicao', '--dir', root), transition, fakeRunner({}));
    expect(transition.outText).toContain('→ "transição"');
    expect(transition.outText).toContain('+ Passo');
    const current = fakeIo();
    await runDiff(argsOf('diff', '--stage', 'atual', '--dir', root), current, fakeRunner({}));
    expect(current.outText).toContain('+ DB');
  });

  it('prints JSON and Markdown like the ref diff', async () => {
    const root = await workspaceWith([{ ids: ['API', 'DB', 'Cache'], meta: meta('p1', { stage: 'planejado' }) }]);
    const json = fakeIo();
    await runDiff(argsOf('diff', '--stage', 'planejado', '--json', '--dir', root), json, fakeRunner({}));
    expect(JSON.parse(json.outText).diagrams[0].changes.elements.added).toEqual(['Cache']);
    const markdown = fakeIo();
    await runDiff(argsOf('diff', '--stage', 'planejado', '--markdown', '--dir', root), markdown, fakeRunner({}));
    expect(markdown.outText).toContain('Adicionados: `Cache`');
  });

  it('exits 2 with a message when nothing has that stage', async () => {
    const root = await workspaceWith([{ ids: ['API'], meta: meta('a1') }]);
    const out = fakeIo();
    expect(await runDiff(argsOf('diff', '--stage', 'planejado', '--dir', root), out, fakeRunner({}))).toBe(2);
    expect(out.errText).toContain('Nenhuma versão com estágio "planejado"');
  });

  it('stops with a message when the chosen version has errors in its JSON', async () => {
    const root = await workspaceWith([{ ids: ['API', 'DB', 'Cache'], meta: meta('p1', { stage: 'planejado', target: '2099-01-01' }) }]);
    const out = fakeIo();
    expect(await runDiff(argsOf('diff', '--stage', 'planejado', '--dir', root), out, fakeRunner({}))).toBe(0);
    const opened = await openWorkspaceAt(root);
    const broken = { ...createVersion(snapshotOf(['X']), meta('bad', { stage: 'planejado', target: '2098-01-01' })), json: '{"version": 1, "nodes": [' };
    await opened!.adapter.write('versions/a/20260101T000000000Z-bad.json', JSON.stringify(broken));
    const again = fakeIo();
    expect(await runDiff(argsOf('diff', '--stage', 'planejado', '--dir', root), again, fakeRunner({}))).toBe(2);
    expect(again.errText).toContain('erros');
  });
});

describe('--stage arguments', () => {
  it('only belongs to diff, takes a valid stage and does not mix with refs', () => {
    expect(parseArgs(['diff', '--stage', 'planejado'])).toMatchObject({ stage: 'planejado', refs: [] });
    expect(parseArgs(['diff', '--stage=transicao'])).toMatchObject({ stage: 'transicao' });
    expect(parseArgs(['check', '--stage', 'planejado'])).toEqual({ error: 'A opção --stage só vale para o comando diff.' });
    expect(parseArgs(['diff', '--stage', 'futuro'])).toEqual({ error: 'Estágio inválido: "futuro". Use atual, transição ou planejado.' });
    expect(parseArgs(['diff', 'main', '--stage', 'planejado'])).toEqual({ error: 'A opção --stage compara o diagrama atual com um estágio: não combine com refs do git.' });
    expect(parseArgs(['diff', '--stage'])).toEqual({ error: 'A opção --stage precisa de um valor.' });
  });

  it('keeps the ref behaviour untouched', () => {
    expect(parseArgs(['diff', 'main', 'feature'])).toMatchObject({ refs: ['main', 'feature'] });
    expect(parseArgs(['diff'])).toMatchObject({ refs: [] });
  });
});
