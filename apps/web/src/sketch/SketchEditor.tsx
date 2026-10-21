import { getLocale } from '../i18n';
import { registerSketch } from './registry';
import { isViewOnly } from '../workspace/boot';
import { CaptureUpdateAction, Excalidraw, getSceneVersion, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { own } from '@strukt/core';
import { useEffect, useMemo, useRef } from 'react';
import type { Theme } from '../ui/theme';
import { workspace } from '../workspace/appWorkspace';

/** The app already saves, exports and themes: the canvas keeps only what edits the sketch itself. */
const UI_OPTIONS: ExcalidrawProps['UIOptions'] = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
};

type Change = Parameters<NonNullable<ExcalidrawProps['onChange']>>;

function initialScene(text: string | undefined): ExcalidrawInitialDataState | null {
  if (!text) return null;
  try {
    const scene = JSON.parse(text) as ExcalidrawInitialDataState;
    return { elements: scene.elements ?? [], appState: scene.appState ?? {}, files: scene.files ?? {} };
  } catch {
    return null;
  }
}

/** What is worth saving: element versions, embedded files and the background (not selection, scroll or zoom). */
function signature(elements: readonly { version: number; versionNonce: number }[], files: object, background: unknown): string {
  return `${getSceneVersion(elements as never)}|${Object.keys(files).length}|${String(background ?? '#ffffff')}`;
}

/**
 * Excalidraw (MIT) for a sketch item, loaded on demand. onChange fires on every pointer move, so the
 * scene is serialized to `.excalidraw` only 300 ms after the last real change, and when leaving.
 */
export default function SketchEditor({ slug, theme }: { slug: string; theme: Theme }) {
  // `own()`, not `sketches[slug]`: a sketch named "constructor" (a valid slug) would otherwise
  // resolve to Object.prototype.constructor instead of reading as missing (a fresh scene).
  const initial = useMemo(() => {
    const data = workspace.store.getState().data;
    return initialScene(data ? own(data.sketches, slug) : undefined);
  }, [slug]);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const saved = useRef(signature((initial?.elements ?? []) as never, initial?.files ?? {}, initial?.appState?.viewBackgroundColor));
  const pending = useRef<Change | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Writes `pending` (if any) through `workspace.setSketch` and clears it; shared by the debounce timer and `save`. */
  const flush = () => {
    const change = pending.current;
    pending.current = null;
    if (change) workspace.setSketch(slug, serializeAsJSON(change[0], change[1], change[2], 'local'));
  };

  useEffect(() => {
    const save = () => {
      clearTimeout(timer.current);
      flush();
    };
    const off = workspace.onBeforeSwitch(save);
    const unregister = registerSketch(slug, save, (ids) => {
      const drawing = api.current;
      if (!drawing) return;
      const selected = new Set(ids);
      const elements = drawing.getSceneElements().filter((el) => !selected.size || selected.has(el.id) || (el.type === 'text' && el.containerId && selected.has(el.containerId)));
      if (elements.length) drawing.scrollToContent(elements, { fitToContent: true, animate: false, maxZoom: 1, canvasOffsets: { top: 132, bottom: 72, left: 48, right: 48 } });
    });
    const unsubscribe = workspace.store.subscribe((state, previous) => {
      const next = state.data?.sketches[slug];
      if (!next || next === previous.data?.sketches[slug]) return;
      const scene = initialScene(next);
      if (!scene || !api.current) return;
      const sig = signature((scene.elements ?? []) as never, scene.files ?? {}, scene.appState?.viewBackgroundColor);
      if (sig === saved.current) return;
      clearTimeout(timer.current);
      pending.current = null;
      saved.current = sig;
      api.current.updateScene({ elements: scene.elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    });
    return () => {
      off();
      unregister();
      unsubscribe();
      save();
    };
  }, [slug]);

  const onChange: ExcalidrawProps['onChange'] = (elements, appState, files) => {
    const next = signature(elements, files, appState.viewBackgroundColor);
    if (next === saved.current) return;
    saved.current = next;
    pending.current = [elements, appState, files];
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-canvas">
      <Excalidraw excalidrawAPI={(value) => { api.current = value; }} viewModeEnabled={isViewOnly()} initialData={initial} onChange={onChange} theme={theme} UIOptions={UI_OPTIONS} langCode={getLocale()} />
    </div>
  );
}
