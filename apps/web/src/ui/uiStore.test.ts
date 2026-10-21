import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeStorage(initial: Record<string, string> = {}, blocked = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (blocked) throw new Error('storage blocked');
  };
  return {
    data,
    api: {
      getItem: (key: string) => (guard(), data.get(key) ?? null),
      setItem: (key: string, value: string) => (guard(), void data.set(key, value)),
    },
  };
}

/** uiStore reads the saved preferences when the module loads. */
async function freshUi() {
  vi.resetModules();
  return import('./uiStore');
}

afterEach(() => vi.unstubAllGlobals());

describe('"Animar fluxo" preference (per visitor, not diagram data)', () => {
  it('starts off and is remembered in localStorage["strukt:flow"]', async () => {
    const { data, api } = fakeStorage();
    vi.stubGlobal('localStorage', api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().flowAnimation).toBe(false);
    ui.toggleFlowAnimation();
    expect(ui.uiStore.getState().flowAnimation).toBe(true);
    expect(data.get('strukt:flow')).toBe('on');
    ui.setFlowAnimation(false);
    expect(ui.uiStore.getState().flowAnimation).toBe(false);
    expect(data.get('strukt:flow')).toBe('off');
  });

  it('comes back on after a reload when it was left on', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:flow': 'on' }).api);
    expect((await freshUi()).uiStore.getState().flowAnimation).toBe(true);
  });

  it('still toggles for the session when storage is blocked', async () => {
    vi.stubGlobal('localStorage', fakeStorage({}, true).api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().flowAnimation).toBe(false);
    ui.toggleFlowAnimation();
    expect(ui.uiStore.getState().flowAnimation).toBe(true);
  });
});

describe('theme preference', () => {
  it('defaults to light (paper) when nothing is saved, even if the OS is dark', async () => {
    vi.stubGlobal('localStorage', fakeStorage().api);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {} }));
    const ui = await freshUi();
    expect(ui.uiStore.getState()).toMatchObject({ themePref: 'light', theme: 'light' });
  });

  it('keeps an explicit "system" choice and follows the OS', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:theme': 'system' }).api);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    const ui = await freshUi();
    expect(ui.uiStore.getState()).toMatchObject({ themePref: 'system', theme: 'light' });
  });

  it('keeps an explicit dark choice', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:theme': 'dark' }).api);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    expect((await freshUi()).uiStore.getState()).toMatchObject({ themePref: 'dark', theme: 'dark' });
  });

  it('saves the preference in localStorage["strukt:theme"]; contrast resolves to the dark base', async () => {
    const { data, api } = fakeStorage();
    vi.stubGlobal('localStorage', api);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    const ui = await freshUi();
    ui.setTheme('contrast');
    expect(ui.uiStore.getState()).toMatchObject({ themePref: 'contrast', theme: 'dark' });
    expect(data.get('strukt:theme')).toBe('contrast');
    ui.setTheme('light');
    expect(ui.uiStore.getState().theme).toBe('light');
  });

  it('follows the OS only while on "system"', async () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:theme': 'system' }).api);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_: string, fn: typeof listener) => (listener = fn) }));
    const ui = await freshUi();
    listener?.({ matches: true });
    expect(ui.uiStore.getState().theme).toBe('dark');
    ui.setTheme('light');
    listener?.({ matches: true });
    expect(ui.uiStore.getState().theme).toBe('light');
  });

  it('ignores blocked storage and unknown saved values', async () => {
    vi.stubGlobal('localStorage', fakeStorage({}, true).api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().themePref).toBe('light');
    expect(() => ui.setTheme('dark')).not.toThrow();
  });
});

describe('accent preference', () => {
  it('defaults to lime, is remembered in localStorage["strukt:accent"] and survives blocked storage', async () => {
    const { data, api } = fakeStorage();
    vi.stubGlobal('localStorage', api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().accent).toBe('lime');
    ui.setAccent('emerald');
    expect(ui.uiStore.getState().accent).toBe('emerald');
    expect(data.get('strukt:accent')).toBe('emerald');
    vi.stubGlobal('localStorage', fakeStorage({}, true).api);
    const blocked = await freshUi();
    blocked.setAccent('amber');
    expect(blocked.uiStore.getState().accent).toBe('amber');
  });
  it('restores a saved accent and ignores junk', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:accent': 'graphite' }).api);
    expect((await freshUi()).uiStore.getState().accent).toBe('graphite');
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:accent': 'nope' }).api);
    expect((await freshUi()).uiStore.getState().accent).toBe('lime');
  });
});

describe('sidebar sections folded by the visitor', () => {
  it('starts all open, folds and unfolds one section and remembers it', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage.api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().closedSections).toEqual([]);
    ui.toggleSection('doc');
    expect(ui.uiStore.getState().closedSections).toEqual(['doc']);
    expect(storage.data.get('strukt:sections')).toBe('doc');
    ui.toggleSection('doc');
    expect(ui.uiStore.getState().closedSections).toEqual([]);
    expect(storage.data.get('strukt:sections')).toBe('');
  });

  it('reads the saved choice, ignoring unknown kinds', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:sections': 'diagram,bogus,sketch' }).api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().closedSections).toEqual(['diagram', 'sketch']);
  });

  it('still works for the session when storage is blocked', async () => {
    vi.stubGlobal('localStorage', fakeStorage({}, true).api);
    const ui = await freshUi();
    ui.toggleSection('sketch');
    expect(ui.uiStore.getState().closedSections).toEqual(['sketch']);
  });
});

describe('sidebar folders folded by the visitor', () => {
  it('folds and unfolds a folder by kind and path and remembers it', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage.api);
    const ui = await freshUi();
    expect(ui.uiStore.getState().closedFolders).toEqual([]);
    ui.toggleFolder('diagram', 'Backend/Dados');
    expect(ui.uiStore.getState().closedFolders).toEqual(['diagram:Backend/Dados']);
    expect(JSON.parse(storage.data.get('strukt:folders-closed')!)).toEqual(['diagram:Backend/Dados']);
    ui.toggleFolder('diagram', 'Backend/Dados');
    expect(ui.uiStore.getState().closedFolders).toEqual([]);
  });

  it('reads the saved list defensively', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:folders-closed': '{"a":1}' }).api);
    expect((await freshUi()).uiStore.getState().closedFolders).toEqual([]);
    vi.stubGlobal('localStorage', fakeStorage({ 'strukt:folders-closed': '["doc:Guias", 7, "x"]' }).api);
    expect((await freshUi()).uiStore.getState().closedFolders).toEqual(['doc:Guias']);
  });
});
