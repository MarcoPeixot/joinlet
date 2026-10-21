import { applyOps, emptyModel } from '@strukt/core';
import * as json from '@strukt/json';
import { exampleSnapshot } from '../samples/example';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_RUN_KEY, firstRunSeen, isPristineSample, markFirstRunSeen, resetFirstRunMemory, shouldShowFirstRun } from './firstRun';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetFirstRunMemory();
});

describe('first-run flag', () => {
  it('is unseen until marked, and persists in localStorage', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    expect(firstRunSeen()).toBe(false);
    markFirstRunSeen();
    expect(storage.data.get(FIRST_RUN_KEY)).toBe('seen');
    resetFirstRunMemory();
    expect(firstRunSeen()).toBe(true);
  });

  it('still works for the session when storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(firstRunSeen()).toBe(false);
    expect(() => markFirstRunSeen()).not.toThrow();
    expect(firstRunSeen()).toBe(true);
  });

  it('works when localStorage is absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(firstRunSeen()).toBe(false);
    markFirstRunSeen();
    expect(firstRunSeen()).toBe(true);
  });
});

describe('shouldShowFirstRun', () => {
  const sample = () => exampleSnapshot().model;
  const edited = () => {
    const r = applyOps(sample(), [{ op: 'add_node', id: 'Novo', kind: 'service' } as never]);
    if (!r.ok) throw new Error(r.error.message);
    return r.model;
  };
  const base = { slug: 'exemplo', model: sample(), flag: false, isSampleWorkspace: true };

  it('recognises the pristine sample only', () => {
    expect(isPristineSample(sample())).toBe(true);
    expect(isPristineSample(edited())).toBe(false);
  });
  it('shows for the pristine sample without the flag', () => {
    expect(shouldShowFirstRun(base)).toBe(true);
  });
  it('hides once flagged, on other slugs, edited samples, user diagrams named Exemplo and folder workspaces', () => {
    expect(shouldShowFirstRun({ ...base, flag: true })).toBe(false);
    expect(shouldShowFirstRun({ ...base, slug: 'outro' })).toBe(false);
    expect(shouldShowFirstRun({ ...base, model: edited() })).toBe(false);
    expect(shouldShowFirstRun({ ...base, model: emptyModel() })).toBe(false);
    expect(shouldShowFirstRun({ ...base, isSampleWorkspace: false })).toBe(false);
  });
  it('never shows an edited sample even when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(shouldShowFirstRun({ ...base, model: edited(), flag: firstRunSeen() })).toBe(false);
  });
});

describe('isPristineSample cost', () => {
  it('prints JSON at most once per model reference, and never for a model of another size', () => {
    const print = vi.spyOn(json, 'printDiagramJson');
    const sample = exampleSnapshot().model;
    isPristineSample(sample); // may print the sample itself once (cached for later)
    const before = print.mock.calls.length;
    for (let i = 0; i < 50; i += 1) isPristineSample(sample);
    expect(print.mock.calls.length).toBe(before);

    const grown = applyOps(sample, [{ op: 'add_node', id: 'ZZ-extra' }]);
    if (!grown.ok) throw new Error(grown.error.message);
    const bigger = grown.model;
    for (let i = 0; i < 50; i += 1) expect(isPristineSample(bigger)).toBe(false);
    expect(print.mock.calls.length).toBe(before);
    print.mockRestore();
  });
});
