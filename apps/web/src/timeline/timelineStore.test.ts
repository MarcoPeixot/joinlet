import { orthogonalRouter } from '@strukt/layout';
import { createMemoryAdapter, createVersion, printVersion, versionPath } from '@strukt/workspace';
import { describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { COMPARE_LOCK, createVersionStore } from '../versions/versionStore';
import { createTimelineStore } from './timelineStore';

const TODAY = new Date(2026, 8, 24, 12, 0, 0);
const future = [
  { op: 'remove' as const, id: 'Kafka' },
  { op: 'add_node' as const, id: 'Auditoria', parentId: 'Dados' },
  { op: 'connect' as const, from: 'Pedidos', to: 'Auditoria' },
];

/** Past "Atual" (the example), "Hoje" (the example) and a planned state without Kafka and with Auditoria. */
async function setup(extra: { blocked?: () => string | null } = {}) {
  const diagram = createDiagramStore(exampleSnapshot());
  const adapter = createMemoryAdapter();
  let clock = Date.parse('2026-09-20T10:00:00.000Z');
  let ids = 0;
  const notify = vi.fn<(message: string) => void>();
  const versions = createVersionStore({ diagram, target: () => ({ slug: 'exemplo', storage: adapter }), router: orthogonalRouter, now: () => new Date(clock), newId: () => `v${++ids}`, notify, ...extra });
  await versions.getState().refresh();
  await versions.getState().save('Atual');
  clock += 3_600_000;
  diagram.getState().apply(future);
  await versions.getState().save('Sem Kafka', 'human', { stage: 'planejado', target: '2027-01-15' });
  diagram.getState().undo();
  const flushCode = vi.fn(async () => {});
  const timeline = createTimelineStore({ versions, diagram, now: () => TODAY, router: orthogonalRouter, notify, target: () => ({ slug: 'exemplo', storage: adapter }), flushCode });
  const [planned, atual] = versions.getState().entries;
  return { diagram, adapter, versions, timeline, notify, flushCode, planned: planned!, atual: atual! };
}

describe('timeline store', () => {
  it('selecting a planned point compares today with it: read-only canvas, what changes in words, the countdown', async () => {
    const { diagram, versions, timeline, planned } = await setup();
    await timeline.getState().toggle(planned.path);
    const { result, selected } = timeline.getState();
    expect(selected).toEqual([planned.path]);
    expect(result?.from.kind).toBe('today');
    expect(result?.to.entry?.path).toBe(planned.path);
    expect(result?.diff.lines.map((l) => `${l.kind}:${l.text}`)).toContain('added:Auditoria');
    expect(result?.diff.lines.map((l) => `${l.kind}:${l.text}`)).toContain('removed:Kafka');
    expect(result?.summary).toBe('2 adicionados e 3 removidos.');
    expect(result?.goal).toEqual({ date: '2027-01-15', days: 113 });
    expect(versions.getState().view?.preview).toBe(result?.diff.preview);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);
  });

  it('compares in the direction of time whichever point is chosen first', async () => {
    const { timeline, planned, atual } = await setup();
    await timeline.getState().toggle(planned.path);
    await timeline.getState().toggle(atual.path);
    const { result } = timeline.getState();
    expect(result?.from.entry?.path).toBe(atual.path);
    expect(result?.to.entry?.path).toBe(planned.path);
    expect(result?.applicable.map((p) => p.entry?.path)).toEqual([atual.path, planned.path]);
  });

  it('a past point compared with today shows what changed since', async () => {
    const { timeline, atual } = await setup();
    await timeline.getState().toggle(atual.path);
    const { result } = timeline.getState();
    expect(result?.from.entry?.path).toBe(atual.path);
    expect(result?.to.kind).toBe('today');
    expect(result?.diff.unchanged).toBe(true);
    expect(result?.summary).toBe('Sem mudanças no diagrama.');
    expect(result?.goal).toBeNull();
  });

  it('reads today from the diagram as it is after pending Código edits are committed', async () => {
    const { timeline, flushCode, planned } = await setup();
    await timeline.getState().toggle(planned.path);
    expect(flushCode).toHaveBeenCalled();
  });

  it('keeps two points at most: a third click replaces the older one; clicking a selected point removes it', async () => {
    const { timeline, versions, adapter, planned, atual } = await setup();
    const extra = createVersion(exampleSnapshot(), { id: 'z9', createdAt: '2026-09-21T00:00:00.000Z', message: 'Outra', author: 'human' });
    adapter.files.set(versionPath('exemplo', extra), printVersion(extra));
    await versions.getState().refresh();
    const other = versions.getState().entries.find((e) => e.version.id === 'z9')!;
    await timeline.getState().toggle(planned.path);
    await timeline.getState().toggle(atual.path);
    await timeline.getState().toggle(other.path);
    expect(timeline.getState().selected).toEqual([atual.path, other.path]);
    await timeline.getState().toggle(atual.path);
    expect(timeline.getState().selected).toEqual([other.path]);
  });

  it('today alone is not a comparison; no selection releases the canvas', async () => {
    const { diagram, versions, timeline, planned } = await setup();
    await timeline.getState().toggle('now');
    expect(timeline.getState()).toMatchObject({ selected: ['now'], result: null });
    expect(versions.getState().view).toBeNull();
    await timeline.getState().toggle(planned.path);
    expect(versions.getState().view).not.toBeNull();
    await timeline.getState().toggle(planned.path);
    await timeline.getState().toggle('now');
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().view).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('ignores keys that are not on the axis', async () => {
    const { timeline, versions } = await setup();
    await timeline.getState().toggle('versions/exemplo/nao-existe.json');
    await timeline.getState().toggle('__proto__');
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().view).toBeNull();
  });

  it('refuses a version whose JSON is broken, with a message, leaving the canvas free', async () => {
    const { diagram, adapter, versions, timeline, notify } = await setup();
    const broken = createVersion(exampleSnapshot(), { id: 'bad1', createdAt: '2026-09-22T00:00:00.000Z', message: 'Quebrada', author: 'human', stage: 'planejado' });
    adapter.files.set(versionPath('exemplo', broken), printVersion({ ...broken, json: '{"version": 1, "nodes": [' }));
    await versions.getState().refresh();
    const entry = versions.getState().entries.find((e) => e.version.id === 'bad1')!;
    await timeline.getState().toggle(entry.path);
    expect(timeline.getState()).toMatchObject({ selected: [], result: null, busy: false });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('não pode ser comparada'));
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('respects the exclusion with an AI draft: nothing is shown or locked', async () => {
    const { diagram, timeline, planned, notify } = await setup({ blocked: () => 'Aplique ou descarte a proposta da IA antes de comparar versões.' });
    await timeline.getState().toggle(planned.path);
    expect(notify).toHaveBeenCalledWith('Aplique ou descarte a proposta da IA antes de comparar versões.');
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('the last click wins when selections overlap while a version is still being read', async () => {
    const { timeline, adapter, planned, atual } = await setup();
    const read = adapter.read;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    adapter.read = async (path) => {
      if (path === planned.path && !held) {
        held = true;
        await gate;
      }
      return read(path);
    };
    const first = timeline.getState().toggle(planned.path);
    await vi.waitFor(() => expect(held).toBe(true));
    await timeline.getState().toggle(atual.path);
    release();
    await first;
    expect(timeline.getState().selected).toEqual([planned.path, atual.path]);
    expect(timeline.getState().result?.from.entry?.path).toBe(atual.path);
    expect(timeline.getState().result?.to.entry?.path).toBe(planned.path);
  });

  it('stop() ends the comparison it started, and only that one', async () => {
    const { diagram, versions, timeline, planned } = await setup();
    await timeline.getState().toggle(planned.path);
    timeline.getState().stop();
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().view).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
    diagram.getState().setReadOnly('Modo apresentação: saia para editar.');
    timeline.getState().stop();
    expect(diagram.getState().readOnly).toBe('Modo apresentação: saia para editar.');
  });

  it('lets go when another comparison takes the canvas, or when the comparison ends from outside', async () => {
    const { diagram, versions, timeline, planned, atual } = await setup();
    await timeline.getState().toggle(planned.path);
    await versions.getState().startCompare(atual);
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().compare?.entry.path).toBe(atual.path);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);
    versions.getState().stopCompare();

    await timeline.getState().toggle(planned.path);
    versions.getState().stopCompare();
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
  });

  it('drops the selection when the version list changes underneath it (another diagram, a removed file)', async () => {
    const { adapter, versions, timeline, planned } = await setup();
    await timeline.getState().toggle(planned.path);
    adapter.files.delete(planned.path);
    await versions.getState().refresh();
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().view).toBeNull();
  });

  it('"Aplicar este estado" restores the version as one undo step and records it', async () => {
    const { diagram, versions, timeline, planned } = await setup();
    const steps = diagram.getState().past.length;
    await timeline.getState().toggle(planned.path);
    expect(await timeline.getState().apply(planned.path)).toBe(true);
    expect(diagram.getState().model.elements.Kafka).toBeUndefined();
    expect(diagram.getState().model.elements.Auditoria).toBeDefined();
    expect(diagram.getState().past).toHaveLength(steps + 1);
    expect(diagram.getState().readOnly).toBeNull();
    expect(timeline.getState()).toMatchObject({ selected: [], result: null });
    expect(versions.getState().entries[0]!.version).toMatchObject({ message: expect.stringMatching(/^Restaurado de /) });
    expect(versions.getState().entries[0]!.version.stage).toBeUndefined();
    diagram.getState().undo();
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
  });

  it('"Aplicar este estado" for something already equal changes nothing and says so', async () => {
    const { diagram, timeline, atual, notify } = await setup();
    const before = diagram.getState().model;
    expect(await timeline.getState().apply(atual.path)).toBe(false);
    expect(notify).toHaveBeenCalledWith('O diagrama já está igual a esta versão.');
    expect(diagram.getState().model).toBe(before);
  });

  it('refuses to apply a key that is not a saved version', async () => {
    const { timeline } = await setup();
    expect(await timeline.getState().apply('now')).toBe(false);
    expect(await timeline.getState().apply('x')).toBe(false);
  });
});
