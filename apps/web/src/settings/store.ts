import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { settingsApi } from './client';
import { isBrowserGuest, isBrowserPreview } from './publicAccess';
import type { OpenRouterModel, ProviderId, SettingsPatch, SettingsView } from './client';

export type SettingsSection = 'general' | 'plan' | 'workspace' | 'ai' | 'integrations' | 'shortcuts' | 'github';
export type TestResult = { ok: boolean; detail: string } | 'running';

interface SettingsState {
  open: boolean;
  section: SettingsSection;
  editingProvider: ProviderId | null;
  /** The server's view (null until loaded, or while the server is down). */
  view: SettingsView | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  tests: Partial<Record<ProviderId, TestResult>>;
  models: OpenRouterModel[] | null;
  modelsError: string | null;
}

export const settingsStore = createStore<SettingsState>()(() => ({
  open: false,
  section: 'general',
  editingProvider: null,
  view: null,
  loading: false,
  error: null,
  saving: false,
  tests: {},
  models: null,
  modelsError: null,
}));

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

export async function refreshSettings(): Promise<void> {
  if (isBrowserPreview() || isBrowserGuest()) {
    settingsStore.setState({ view: null, loading: false, error: null });
    return;
  }
  settingsStore.setState({ loading: true });
  const res = await settingsApi.get();
  settingsStore.setState(res.ok ? { view: res.value, loading: false, error: null } : { loading: false, error: res.error });
}

/** ⌘, the gear, the ⌘K command, or the AI composer's "modo offline" chip (straight to the AI section). */
export function openSettings(section?: SettingsSection, provider?: ProviderId): void {
  settingsStore.setState((s) => ({ open: true, section: section ?? s.section, ...(provider ? { editingProvider: provider } : {}), tests: {} }));
  void refreshSettings();
}

export function closeSettings(): void {
  settingsStore.setState({ open: false });
}

/** Sends a change; returns the pt-BR error, or null once the server took it (the view refreshes). */
export async function saveSettings(patch: SettingsPatch): Promise<string | null> {
  settingsStore.setState({ saving: true });
  const res = await settingsApi.save(patch);
  settingsStore.setState(res.ok ? { saving: false, view: res.value, error: null, tests: {} } : { saving: false });
  return res.ok ? null : res.error;
}

export async function testProvider(id: ProviderId): Promise<void> {
  settingsStore.setState((s) => ({ tests: { ...s.tests, [id]: 'running' } }));
  const res = await settingsApi.test(id);
  const result = res.ok ? res.value : { ok: false, detail: res.error };
  settingsStore.setState((s) => ({ tests: { ...s.tests, [id]: result } }));
}

export async function loadOpenRouterModels(): Promise<void> {
  if (settingsStore.getState().models) return;
  const res = await settingsApi.models();
  settingsStore.setState(res.ok ? { models: res.value.models, modelsError: null } : { modelsError: res.error });
}
