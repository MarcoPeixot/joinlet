import type { ChecklistState } from './checklistState';

export type OnboardingSurface = 'first-run' | 'start' | 'checklist' | null;

export interface OnboardingContext {
  /** The note over the pristine sample is up (see useFirstRunVisible). */
  firstRun: boolean;
  /** An empty diagram is open: the canvas shows its "Descreva sua arquitetura" card. */
  emptyDiagram: boolean;
  checklist: Pick<ChecklistState, 'hidden'>;
}

/**
 * One onboarding surface at a time: the note over the pristine sample first, then the start card of an empty
 * diagram (it offers the same first steps), and "Primeiros passos" only once neither is up and while not hidden.
 */
export function onboardingSurface({ firstRun, emptyDiagram, checklist }: OnboardingContext): OnboardingSurface {
  if (firstRun) return 'first-run';
  if (emptyDiagram) return 'start';
  return checklist.hidden ? null : 'checklist';
}
