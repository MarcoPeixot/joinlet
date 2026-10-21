import { uiText } from '../i18n';
import { buildTimeline, readVersion, versionSnapshot } from '@strukt/workspace';
import type { DiagramSnapshot, StorageAdapter, Timeline, TimelinePoint } from '@strukt/workspace';
import type { EdgeRouter } from '@strukt/layout';
import { createStore } from 'zustand/vanilla';
import type { DiagramStore } from '../state/diagramStore';
import { loadEraserRouter } from '../state/eraserRouter';
import type { CompareView, VersionStore } from '../versions/versionStore';
import { diffStates, summarizeLines } from './compare';
import type { TimelineDiff } from './compare';

/** What two points of the axis come to: the diff drawn on the canvas, in words, and the goal it leads to. */
export interface TimelineResult {
  /** The earlier point and the later one: the diff always reads in the direction of time. */
  from: TimelinePoint;
  to: TimelinePoint;
  diff: TimelineDiff;
  summary: string;
  /** The saved versions among the two ("Aplicar este estado" can restore each). */
  applicable: TimelinePoint[];
  /** The goal date (and days left) of the later planned/transition point, if it has one. */
  goal: { date: string; days: number } | null;
}

export interface TimelineState {
  /** Keys of the chosen points (`now` or a version path), at most two, oldest choice first. */
  selected: string[];
  result: TimelineResult | null;
  /** A comparison is being read and drawn. */
  busy: boolean;
  /** Chooses or unchooses a point; two points (or one against today) show their diff on the canvas. */
  toggle: (key: string) => Promise<void>;
  /** Drops the selection and releases the canvas (only a comparison this store started). */
  stop: () => void;
  /** "Aplicar este estado": restores a saved version into the open diagram (the existing restore: one undo step). */
  apply: (key: string) => Promise<boolean>;
}

export interface TimelineDeps {
  versions: VersionStore;
  diagram: DiagramStore;
  target: () => { slug: string | null; storage: StorageAdapter | null };
  /** Commits pending edits of the Código editor, so "hoje" includes them. */
  flushCode?: () => Promise<void>;
  router?: EdgeRouter;
  now?: () => Date;
  notify?: (message: string) => void;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The time axis of the open diagram: pick two points, see the diff between them on the canvas. */
export function createTimelineStore(deps: TimelineDeps) {
  const now = deps.now ?? (() => new Date());
  const notify = deps.notify ?? (() => {});
  const axis = (): Timeline => buildTimeline(deps.versions.getState().entries, now());

  return createStore<TimelineState>()((set, get) => {
    // Generation counter: a read that finishes after a newer choice must not draw.
    let seq = 0;
    // The view this store put on the canvas (null while it has none, and while it is replacing one).
    let ours: CompareView | null = null;

    const release = () => {
      const view = ours;
      ours = null;
      if (view && deps.versions.getState().view === view) deps.versions.getState().stopCompare();
    };
    const reset = () => {
      seq++;
      release();
      set({ selected: [], result: null, busy: false });
    };

    async function snapshotOf(point: TimelinePoint): Promise<{ ok: true; snapshot: DiagramSnapshot } | { ok: false; error: string }> {
      if (point.kind === 'today') {
        const { model, layout } = deps.diagram.getState();
        return { ok: true, snapshot: { model, layout } };
      }
      const { storage } = deps.target();
      const full = storage && point.entry ? await readVersion(storage, point.entry.path).catch(() => null) : null;
      if (!full) return { ok: false, error: uiText("Não foi possível ler esta versão: o arquivo mudou ou foi removido.") };
      const { snapshot, diagnostics } = versionSnapshot(full);
      const error = diagnostics.find((d) => d.severity === 'error');
      if (error) return { ok: false, error: uiText("Esta versão tem erros no código (linha {0}: {1}) e não pode ser comparada.", [error.line, error.message]) };
      return { ok: true, snapshot };
    }

    async function show(): Promise<void> {
      const mine = ++seq;
      const { selected } = get();
      if (selected.length === 0 || (selected.length === 1 && selected[0] === 'now')) {
        release();
        set({ result: null, busy: false });
        return;
      }
      const timeline = axis();
      const keys = selected.length === 1 ? [selected[0]!, 'now'] : selected;
      const order = (key: string) => timeline.points.findIndex((p) => p.key === key);
      const [from, to] = keys.map((key) => timeline.points[order(key)]!).sort((a, b) => order(a.key) - order(b.key)) as [TimelinePoint, TimelinePoint];
      set({ busy: true });
      await deps.flushCode?.();
      if (mine !== seq) return;
      const [a, b, router] = await Promise.all([snapshotOf(from), snapshotOf(to), deps.router ?? loadEraserRouter()]);
      if (mine !== seq) return;
      const failed = !a.ok ? a : !b.ok ? b : null;
      if (failed) {
        notify(failed.error);
        reset();
        return;
      }
      const diff = diffStates((a as { snapshot: DiagramSnapshot }).snapshot, (b as { snapshot: DiagramSnapshot }).snapshot, router);
      const view: CompareView = { preview: diff.preview, oldLayout: diff.oldLayout };
      ours = null; // `present` replaces our own view: the subscription below must not read that as someone else taking the canvas
      if (!deps.versions.getState().present(view)) {
        reset();
        return;
      }
      ours = deps.versions.getState().view;
      const later = [from, to].reverse().find((p) => p.kind === 'version' && p.stage !== 'atual' && p.date !== null);
      set({
        busy: false,
        result: {
          from,
          to,
          diff,
          summary: summarizeLines(diff.counts),
          applicable: [from, to].filter((p) => p.kind === 'version'),
          goal: later ? { date: later.date!, days: later.days! } : null,
        },
      });
    }

    // Someone else took the canvas (another comparison, the AI panel) or ended ours; or the list changed under the selection.
    deps.versions.subscribe((state, prev) => {
      if (ours && state.view !== ours) {
        seq++;
        ours = null;
        set({ selected: [], result: null, busy: false });
        return;
      }
      if (state.entries !== prev.entries || state.diagram !== prev.diagram) {
        const keys = new Set(axis().points.map((p) => p.key));
        if (get().selected.some((key) => !keys.has(key))) reset();
      }
    });

    return {
      selected: [],
      result: null,
      busy: false,

      async toggle(key) {
        if (!axis().points.some((p) => p.key === key)) return;
        const { selected } = get();
        set({ selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected.slice(-1), key] });
        await show();
      },

      stop: reset,

      async apply(key) {
        const point = axis().points.find((p) => p.key === key);
        if (!point?.entry) return false;
        reset();
        await deps.versions.getState().startCompare(point.entry);
        if (!deps.versions.getState().compare) return false;
        return deps.versions.getState().restore();
      },
    };
  });
}

export type TimelineStore = ReturnType<typeof createTimelineStore>;
