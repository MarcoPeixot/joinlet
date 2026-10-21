import { uiText } from '../i18n';
import type { DiagramModel } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { exampleSnapshot } from '../samples/example';

/** The sample diagram the workspace is born with (workspace/boot.ts). */
export const SAMPLE_SLUG = uiText("exemplo");

export const FIRST_RUN_KEY = 'strukt:first-run';

/** Session fallback for when storage is blocked: the chip must still stay dismissed until reload. */
let memorySeen = false;

export function resetFirstRunMemory(): void {
  memorySeen = false;
}

export function firstRunSeen(): boolean {
  if (memorySeen) return true;
  try {
    return globalThis.localStorage?.getItem(FIRST_RUN_KEY) === 'seen';
  } catch {
    return false;
  }
}

export function markFirstRunSeen(): void {
  memorySeen = true;
  try {
    globalThis.localStorage?.setItem(FIRST_RUN_KEY, 'seen');
  } catch {
    // dismissed for this session only
  }
}

let sample: { json: string; size: number } | null = null;
const verdicts = new WeakMap<DiagramModel, boolean>();

/**
 * The model is structurally the canonical sample (canonical JSON equality). Called from a store selector on every
 * change: a different element count answers without printing, and models are immutable, so the verdict is cached by reference.
 */
export function isPristineSample(model: DiagramModel): boolean {
  const known = verdicts.get(model);
  if (known !== undefined) return known;
  if (!sample) {
    const base = exampleSnapshot().model;
    sample = { json: printDiagramJson(base), size: base.order.length };
  }
  const pristine = model.order.length === sample.size && printDiagramJson(model) === sample.json;
  verdicts.set(model, pristine);
  return pristine;
}

export interface FirstRunContext {
  slug: string | null;
  model: DiagramModel;
  flag: boolean;
  /** Only the built-in browser workspace can prove "exemplo" is our sample. */
  isSampleWorkspace: boolean;
}

export function shouldShowFirstRun({ slug, model, flag, isSampleWorkspace }: FirstRunContext): boolean {
  return !flag && isSampleWorkspace && slug === SAMPLE_SLUG && isPristineSample(model);
}
