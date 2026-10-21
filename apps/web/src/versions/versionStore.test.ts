import { orthogonalRouter } from '@strukt/layout';
import { createMemoryAdapter, createVersion, parseVersion, printVersion, versionPath } from '@strukt/workspace';
import type { Flow, StorageAdapter } from '@strukt/workspace';
import { describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { restoredMessage } from './labels';
import { COMPARE_LOCK, createVersionStore } from './versionStore';
import type { VersionDeps } from './versionStore';

function setup(extra: Partial<VersionDeps> = {}) {
  const diagram = createDiagramStore(exampleSnapshot());
  const adapter = createMemoryAdapter();
  let clock = Date.parse('2026-09-23T14:00:00.000Z');
  let ids = 0;
  const notify = vi.fn<(message: string) => void>();
  const versions = createVersionStore({
    diagram,
    target: () => ({ slug: 'exemplo', storage: adapter }),
    router: orthogonalRouter,
    now: () => new Date(clock),
    newId: () => `v${++ids}`,
    notify,
    ...extra,
  });
  const later = (minutes: number) => void (clock += minutes * 60_000);
  return { diagram, adapter, versions, notify, later };
}

const removeKafka = [{ op: 'remove' as const, id: 'Kafka' }];

describe('version store', () => {
  it('keeps an in-flight save in its original workspace when the next project uses the same slug', async () => {
    const original = createMemoryAdapter();
    const next = createMemoryAdapter();
    let storage: StorageAdapter = original;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const write = original.write;
    original.write = vi.fn(async (path, text) => { await gate; await write(path, text); });
    const { versions } = setup({ target: () => ({ slug: 'exemplo', storage }) });
    await versions.getState().refresh();
    const saving = versions.getState().save('Projeto original');
    await vi.waitFor(() => expect(original.write).toHaveBeenCalled());
    storage = next;
    await versions.getState().refresh();
    release();
    expect(await saving).toBe(true);
    expect(versions.getState().entries).toEqual([]);
    expect(next.files.size).toBe(0);
    expect([...original.files.values()].some((text) => text.includes('Projeto original'))).toBe(true);
  });
  it('saves versions of the open diagram and lists them newest first', async () => {
    const { diagram, adapter, versions, later } = setup();
    await versions.getState().refresh();
    expect(versions.getState()).toMatchObject({ diagram: 'exemplo', entries: [], status: 'idle' });
    expect(await versions.getState().save('  Primeira  ')).toBe(true);
    later(1);
    diagram.getState().apply(removeKafka);
    expect(await versions.getState().save('Sem Kafka')).toBe(true);
    expect(versions.getState().entries.map((e) => e.version.message)).toEqual(['Sem Kafka', 'Primeira']);
    expect([...adapter.files.keys()].sort()).toEqual(['versions/exemplo/20260923T140000000Z-v1.json', 'versions/exemplo/20260923T140100000Z-v2.json', 'versions/exemplo/index.json']);
    const first = parseVersion(adapter.files.get('versions/exemplo/20260923T140000000Z-v1.json')!)!;
    expect(first).toMatchObject({ author: 'human', createdAt: '2026-09-23T14:00:00.000Z' });
    expect(first.json).toContain('"icon": "kafka"');

    const reread = createVersionStore({ diagram: createDiagramStore(), target: () => ({ slug: 'exemplo', storage: adapter }) });
    await reread.getState().refresh();
    expect(reread.getState().entries.map((e) => e.version.message)).toEqual(['Sem Kafka', 'Primeira']);
  });

  it('commits pending Código edits before saving, and records who saved', async () => {
    const { diagram, versions, adapter } = setup({ flushCode: async () => void diagram.getState().apply([{ op: 'add_node', id: 'Log' }]) });
    await versions.getState().save('Da IA', 'ai');
    const [text] = [...adapter.files.values()];
    expect(parseVersion(text!)).toMatchObject({ author: 'ai', message: 'Da IA' });
    expect(parseVersion(text!)!.json).toContain('"Log"');
  });

  it('saves and restores guided flows even when the diagram itself is unchanged', async () => {
    let flows: Flow[] = [{ id: 'f', title: 'Original', steps: [{ from: 'Web App', to: 'API Gateway' }] }];
    const { versions } = setup({ flows: () => flows, restoreFlows: (_slug, next) => { flows = next; } });
    await versions.getState().refresh();
    await versions.getState().save('Com fluxo');
    flows = [];
    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(await versions.getState().restore()).toBe(true);
    expect(flows[0]?.title).toBe('Original');
  });

  it('reports failed writes and missing diagrams without adding anything', async () => {
    const { adapter, versions, notify } = setup();
    adapter.write = () => Promise.reject(new Error('disco cheio'));
    await versions.getState().refresh();
    expect(await versions.getState().save('x')).toBe(false);
    expect(notify).toHaveBeenCalledWith('Não foi possível salvar a versão: disco cheio');
    expect(versions.getState().entries).toEqual([]);
    const none = setup({ target: () => ({ slug: null, storage: null }) });
    expect(await none.versions.getState().save('x')).toBe(false);
    expect(none.notify).toHaveBeenCalledWith('Abra um diagrama para salvar uma versão.');
  });

  it('lists only the open diagram and skips files that are not versions', async () => {
    const { adapter, versions, notify } = setup();
    const other = createVersion(exampleSnapshot(), { id: 'x1', createdAt: '2026-09-01T00:00:00.000Z', message: 'Outro', author: 'human' });
    adapter.files.set(versionPath('outro', other), printVersion(other));
    adapter.files.set('versions/exemplo/quebrado.json', '{');
    await versions.getState().refresh();
    expect(versions.getState().entries).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Um arquivo de versão inválido foi ignorado: versions/exemplo/quebrado.json.');
  });

  it('compares read-only: the diagram is locked, nothing changes, leaving unlocks', async () => {
    const { diagram, versions } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Com Kafka');
    diagram.getState().apply(removeKafka);
    const before = diagram.getState();
    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);
    expect(versions.getState().compare?.lines).toEqual([
      { kind: 'added', text: 'Kafka' },
      { kind: 'added', text: 'Pedidos → Kafka: eventos' },
      { kind: 'added', text: 'Kafka → Pagamentos' },
    ]);
    expect(diagram.getState().apply([{ op: 'add_node', id: 'X' }])).toBe(false);
    expect(diagram.getState().lastError).toBe(COMPARE_LOCK);
    versions.getState().stopCompare();
    expect(diagram.getState()).toMatchObject({ readOnly: null, model: before.model, past: before.past });
  });

  it('restores as one undo step and records "Restaurado de …"', async () => {
    const { diagram, versions, notify } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Com Kafka');
    const saved = versions.getState().entries[0]!;
    diagram.getState().apply(removeKafka, { 'API Gateway': { x: 400, y: 160 } });
    const steps = diagram.getState().past.length;
    await versions.getState().startCompare(saved);
    expect(await versions.getState().restore()).toBe(true);
    expect(diagram.getState()).toMatchObject({ readOnly: null });
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
    expect(diagram.getState().layout.nodes['API Gateway']).toEqual({ x: 330, y: 160 });
    expect(diagram.getState().past).toHaveLength(steps + 1);
    expect(versions.getState()).toMatchObject({ compare: null });
    expect(versions.getState().entries.map((e) => e.version.message)).toEqual([restoredMessage(saved.version), 'Com Kafka']);
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Versão de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} restaurada\. ⌘Z desfaz\.$/));
    diagram.getState().undo();
    expect(diagram.getState().model.elements.Kafka).toBeUndefined();
  });

  it('does not restore a version equal to the diagram', async () => {
    const { versions, notify } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Igual');
    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(versions.getState().compare?.plan.unchanged).toBe(true);
    expect(await versions.getState().restore()).toBe(false);
    expect(notify).toHaveBeenCalledWith('O diagrama já está igual a esta versão.');
    expect(versions.getState().entries).toHaveLength(1);
  });

  it('refuses to compare while another preview holds the diagram, and closing the panel ends a comparison', async () => {
    const blocked = setup({ blocked: () => 'Aplique ou descarte a proposta da IA antes de comparar versões.' });
    await blocked.versions.getState().refresh();
    await blocked.versions.getState().save('x');
    await blocked.versions.getState().startCompare(blocked.versions.getState().entries[0]!);
    expect(blocked.versions.getState().compare).toBeNull();
    expect(blocked.notify).toHaveBeenCalledWith('Aplique ou descarte a proposta da IA antes de comparar versões.');

    const { diagram, versions } = setup();
    versions.getState().setOpen(true);
    await versions.getState().refresh();
    await versions.getState().save('x');
    await versions.getState().startCompare(versions.getState().entries[0]!);
    versions.getState().setOpen(false);
    expect(versions.getState()).toMatchObject({ open: false, compare: null });
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('cancels a comparison that is still starting when something ends it before flushing finishes', async () => {
    let flush = async () => {};
    let releaseFlush: (() => void) | null = null;
    const { diagram, versions } = setup({ flushCode: () => flush() });
    await versions.getState().refresh();
    await versions.getState().save('x');
    const entry = versions.getState().entries[0]!;

    flush = () => new Promise<void>((resolve) => void (releaseFlush = resolve));
    const starting = versions.getState().startCompare(entry);
    versions.getState().setOpen(false); // closes the panel while startCompare is still awaiting flushCode
    releaseFlush!();
    await starting;

    expect(versions.getState().compare).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('still compares when a same-diagram refresh replaced the entry objects while flushing', async () => {
    let flush = async () => {};
    let releaseFlush: (() => void) | null = null;
    const { diagram, versions } = setup({ flushCode: () => flush() });
    await versions.getState().refresh();
    await versions.getState().save('x');
    const entry = versions.getState().entries[0]!;

    flush = () => new Promise<void>((resolve) => void (releaseFlush = resolve));
    const starting = versions.getState().startCompare(entry);
    await versions.getState().refresh(); // same paths, new objects
    expect(versions.getState().entries[0]).not.toBe(entry);
    releaseFlush!();
    await starting;

    expect(versions.getState().compare?.entry.path).toBe(entry.path);
    expect(versions.getState().compare?.entry).toBe(versions.getState().entries[0]);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);
  });

  it('re-checks the AI-draft block after flushing, and reports its message rather than the raw lock', async () => {
    let flush = async () => {};
    let releaseFlush: (() => void) | null = null;
    let blockedReason: string | null = null;
    const { diagram, versions, notify } = setup({ flushCode: () => flush(), blocked: () => blockedReason });
    await versions.getState().refresh();
    await versions.getState().save('x');
    const entry = versions.getState().entries[0]!;

    flush = () => new Promise<void>((resolve) => void (releaseFlush = resolve));
    const starting = versions.getState().startCompare(entry);
    blockedReason = 'Aplique ou descarte a proposta da IA antes de comparar versões.';
    diagram.getState().setReadOnly('Revise a proposta da IA: aplique ou descarte antes de editar.');
    releaseFlush!();
    await starting;

    expect(versions.getState().compare).toBeNull();
    expect(notify).toHaveBeenCalledWith('Aplique ou descarte a proposta da IA antes de comparar versões.');
    expect(notify).not.toHaveBeenCalledWith('Revise a proposta da IA: aplique ou descarte antes de editar.');
  });

  it('clears the version list synchronously as soon as a different diagram is requested', async () => {
    let target: { slug: string | null; storage: StorageAdapter | null } = { slug: 'exemplo', storage: null };
    const { adapter, versions } = setup({ target: () => target });
    target = { slug: 'exemplo', storage: adapter };
    await versions.getState().refresh();
    await versions.getState().save('x');
    expect(versions.getState().entries).toHaveLength(1);

    target = { slug: 'outro', storage: adapter };
    const pending = versions.getState().refresh();
    expect(versions.getState().entries).toEqual([]); // cleared immediately, not only once the listing resolves
    await pending;
  });

  it('refuses to compare an entry that no longer belongs to the open diagram after a switch', async () => {
    let target: { slug: string | null; storage: StorageAdapter | null } = { slug: 'exemplo', storage: null };
    const { diagram, adapter, versions } = setup({ target: () => target });
    target = { slug: 'exemplo', storage: adapter };
    await versions.getState().refresh();
    await versions.getState().save('Do exemplo');
    const staleEntry = versions.getState().entries[0]!;

    target = { slug: 'outro', storage: adapter };
    await versions.getState().refresh();
    expect(versions.getState().entries).toEqual([]);

    await versions.getState().startCompare(staleEntry);
    expect(versions.getState().compare).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('a stale refresh does not clobber a fresher one when the diagram is switched away and back (A→B→A)', async () => {
    const adapter = createMemoryAdapter();
    const va1 = createVersion(exampleSnapshot(), { id: 'a1', createdAt: '2026-09-01T00:00:00.000Z', message: 'A1', author: 'human' });
    const vb = createVersion(exampleSnapshot(), { id: 'b1', createdAt: '2026-09-02T00:00:00.000Z', message: 'B1', author: 'human' });
    adapter.files.set(versionPath('a', va1), printVersion(va1));
    adapter.files.set(versionPath('b', vb), printVersion(vb));

    let target: { slug: string | null; storage: StorageAdapter | null } = { slug: 'a', storage: adapter };
    const { versions } = setup({ target: () => target });

    let release: (() => void) | null = null;
    const originalList = adapter.list.bind(adapter);
    let trapped = false;
    adapter.list = () => {
      if (trapped) return originalList();
      trapped = true;
      const captured = originalList(); // freezes the listing to just "A1"
      return new Promise((resolve) => void (release = () => resolve(captured)));
    };

    const stale = versions.getState().refresh(); // A, paused mid-read (has only seen "A1")
    // A second version lands on "a" while call 1 is still paused, so a stale overwrite is observable.
    const va2 = createVersion(exampleSnapshot(), { id: 'a2', createdAt: '2026-09-03T00:00:00.000Z', message: 'A2', author: 'human' });
    adapter.files.set(versionPath('a', va2), printVersion(va2));

    target = { slug: 'b', storage: adapter };
    await versions.getState().refresh(); // B, completes
    target = { slug: 'a', storage: adapter };
    await versions.getState().refresh(); // A again, a fresh (unpaused) read: sees both A1 and A2
    expect(versions.getState().entries.map((e) => e.version.message)).toEqual(['A2', 'A1']);

    release!(); // let the very first, now-stale A read (which only ever saw A1) finish
    await stale;
    expect(versions.getState()).toMatchObject({ diagram: 'a', status: 'idle' });
    expect(versions.getState().entries.map((e) => e.version.message)).toEqual(['A2', 'A1']); // not clobbered back down to just A1
  });

  it('does not erase an entry saved while a refresh is still reading storage', async () => {
    const { versions, adapter } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Primeira');

    let release: (() => void) | null = null;
    const originalList = adapter.list.bind(adapter);
    let held = false;
    adapter.list = () => {
      if (held) return originalList(); // writeVersion's own listing is not the refresh's
      held = true;
      const captured = originalList(); // freezes the listing before "Segunda" is written
      return new Promise((resolve) => void (release = () => resolve(captured)));
    };

    const refreshing = versions.getState().refresh();
    await versions.getState().save('Segunda');
    release!();
    await refreshing;

    expect(versions.getState().entries.map((e) => e.version.message)).toEqual(['Segunda', 'Primeira']);
  });

  it('keeps the diagram restored even when recording "Restaurado de" fails, in one combined toast', async () => {
    const { diagram, versions, notify, adapter } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Com Kafka');
    const saved = versions.getState().entries[0]!;
    diagram.getState().apply(removeKafka);
    await versions.getState().startCompare(saved);
    adapter.write = () => Promise.reject(new Error('disco cheio'));

    expect(await versions.getState().restore()).toBe(true);
    expect(diagram.getState().readOnly).toBeNull();
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
    expect(versions.getState().entries).toEqual([saved]); // no phantom "Restaurado de" entry was recorded
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Versão de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} restaurada \(⌘Z desfaz\), mas não foi possível registrar a versão: disco cheio$/));
  });

  it('stopCompare leaves a lock it did not set in place', async () => {
    const { diagram, versions } = setup();
    await versions.getState().refresh();
    await versions.getState().save('x');
    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);

    diagram.getState().setReadOnly('Outro bloqueio.'); // some other actor took the lock over
    versions.getState().stopCompare();
    expect(versions.getState().compare).toBeNull();
    expect(diagram.getState().readOnly).toBe('Outro bloqueio.');
  });

  it('refuses to start a comparison while some other lock holds the diagram, and leaves that lock in place', async () => {
    const { diagram, versions, notify } = setup();
    await versions.getState().refresh();
    await versions.getState().save('x');
    diagram.getState().setReadOnly('Outro bloqueio.');

    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(versions.getState().compare).toBeNull();
    expect(diagram.getState().readOnly).toBe('Outro bloqueio.');
    expect(notify).toHaveBeenCalledWith('Outro bloqueio.');
  });

  it('refuses to restore when the diagram changed since the comparison started', async () => {
    const { diagram, versions, notify } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Com Kafka');
    const saved = versions.getState().entries[0]!;
    diagram.getState().apply(removeKafka);
    await versions.getState().startCompare(saved);

    // Simulate the model changing through some path the compare lock does not guard (e.g. a reload).
    diagram.setState({ model: exampleSnapshot().model });
    expect(await versions.getState().restore()).toBe(false);
    expect(notify).toHaveBeenCalledWith('O diagrama mudou durante a comparação. Compare de novo.');
  });

  it('refuses to compare a version whose JSON has errors, without locking the diagram', async () => {
    const { diagram, adapter, versions, notify } = setup();
    const broken = createVersion(exampleSnapshot(), { id: 'bad1', createdAt: '2026-09-10T00:00:00.000Z', message: 'Quebrada', author: 'human' });
    adapter.files.set(versionPath('exemplo', broken), printVersion({ ...broken, json: '{"version": 1, "nodes": [' }));
    await versions.getState().refresh();
    const entry = versions.getState().entries[0]!;

    await versions.getState().startCompare(entry);
    expect(versions.getState().compare).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('não pode ser comparada'));
  });

  it('resets status after a failed read, and does not touch the diagram lock', async () => {
    const { diagram, adapter, versions, notify } = setup();
    adapter.list = () => Promise.reject(new Error('disco cheio'));
    await versions.getState().refresh();
    expect(versions.getState().status).toBe('idle');
    expect(notify).toHaveBeenCalledWith('Não foi possível ler as versões: disco cheio');
    expect(diagram.getState().readOnly).toBeNull();
  });
});

describe('version store: planned states and the shared diff view', () => {
  const view = (versions: ReturnType<typeof setup>['versions']) => ({ preview: versions.getState().compare!.plan.preview });

  it('saves a planned version with its goal, and plain saves stay free of stage and target', async () => {
    const { adapter, versions, later } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Hoje');
    later(1);
    expect(await versions.getState().save('Sem monolito', 'human', { stage: 'planejado', target: '2027-03-15' })).toBe(true);
    const files = [...adapter.files.entries()].filter(([path]) => !path.endsWith('index.json'));
    const [plain, planned] = files.map(([, text]) => JSON.parse(text));
    expect(plain).not.toHaveProperty('stage');
    expect(planned).toMatchObject({ stage: 'planejado', target: '2027-03-15', message: 'Sem monolito' });
    expect(versions.getState().entries[0]!.version).toMatchObject({ stage: 'planejado', target: '2027-03-15' });
  });

  it('opens and closes the "Planejar estado futuro" dialog', () => {
    const { versions } = setup();
    expect(versions.getState().planDialogOpen).toBe(false);
    versions.getState().setPlanDialogOpen(true);
    expect(versions.getState().planDialogOpen).toBe(true);
  });

  it('draws a version comparison through the same view the timeline uses', async () => {
    const { diagram, versions } = setup();
    await versions.getState().refresh();
    await versions.getState().save('Com Kafka');
    diagram.getState().apply(removeKafka);
    await versions.getState().startCompare(versions.getState().entries[0]!);
    expect(versions.getState().view).toEqual(view(versions));
    versions.getState().stopCompare();
    expect(versions.getState().view).toBeNull();
  });

  it('presents a view built elsewhere under the compare lock, and leaving releases it', () => {
    const { diagram, versions } = setup();
    const preview = { base: diagram.getState().model, next: diagram.getState().model, layout: diagram.getState().layout, changes: { elements: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] }, renamed: {}, style: false } };
    expect(versions.getState().present({ preview })).toBe(true);
    expect(versions.getState().view?.preview).toBe(preview);
    expect(diagram.getState().readOnly).toBe(COMPARE_LOCK);
    expect(diagram.getState().apply([{ op: 'add_node', id: 'X' }])).toBe(false);
    versions.getState().stopCompare();
    expect(versions.getState().view).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('refuses to present while an AI draft or another lock holds the diagram, and keeps the other lock', () => {
    const blocked = setup({ blocked: () => 'Aplique ou descarte a proposta da IA antes de comparar versões.' });
    const preview = { base: blocked.diagram.getState().model, next: blocked.diagram.getState().model, layout: blocked.diagram.getState().layout, changes: { elements: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] }, renamed: {}, style: false } };
    expect(blocked.versions.getState().present({ preview })).toBe(false);
    expect(blocked.notify).toHaveBeenCalledWith('Aplique ou descarte a proposta da IA antes de comparar versões.');

    const locked = setup();
    locked.diagram.getState().setReadOnly('Modo apresentação: saia para editar.');
    expect(locked.versions.getState().present({ preview })).toBe(false);
    expect(locked.notify).toHaveBeenCalledWith('Modo apresentação: saia para editar.');
    locked.versions.getState().stopCompare();
    expect(locked.diagram.getState().readOnly).toBe('Modo apresentação: saia para editar.');
  });

  it('a presented view cancels a comparison that was still starting', async () => {
    let release: (() => void) | null = null;
    let flush = async () => {};
    const { diagram, versions } = setup({ flushCode: () => flush() });
    await versions.getState().refresh();
    await versions.getState().save('x');
    const entry = versions.getState().entries[0]!;
    flush = () => new Promise<void>((resolve) => void (release = resolve));
    const starting = versions.getState().startCompare(entry);
    const model = diagram.getState().model;
    const preview = { base: model, next: model, layout: diagram.getState().layout, changes: { elements: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] }, renamed: {}, style: false } };
    expect(versions.getState().present({ preview })).toBe(true);
    release!();
    await starting;
    expect(versions.getState().compare).toBeNull();
    expect(versions.getState().view?.preview).toBe(preview);
  });
});
