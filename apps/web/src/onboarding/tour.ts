import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface TourStep {
  /** Matches a `data-tour="…"` attribute on an existing element. */
  target: string;
  title: string;
  text: string;
  side: 'top' | 'right' | 'bottom' | 'left';
}

export const TOUR_STEPS: readonly TourStep[] = [
  { target: 'canvas', title: uiText("O canvas"), text: uiText("Clique duas vezes para criar um nó e arraste de um nó a outro para conectar."), side: 'top' },
  { target: 'ai', title: uiText("IA (⌘J)"), text: uiText("Descreva uma mudança em uma frase; a IA propõe e você decide se aplica."), side: 'top' },
  { target: 'palette', title: uiText("Comandos (⌘K)"), text: uiText("Tudo o que o Joinlet faz está na paleta: busque uma ação ou salte para um item."), side: 'bottom' },
  { target: 'code', title: uiText("Código"), text: uiText("O diagrama também é JSON. Edite o texto e o canvas acompanha, ou cole um diagrama pronto."), side: 'bottom' },
];

/** `step` is the index into TOUR_STEPS while the tour runs, null otherwise. */
export const tourStore = createStore<{ step: number | null }>()(() => ({ step: null }));

export function useTour<T>(selector: (state: { step: number | null }) => T): T {
  return useStore(tourStore, selector);
}

export const startTour = (): void => tourStore.setState({ step: 0 });
export const stopTour = (): void => tourStore.setState({ step: null });

export function nextTourStep(): void {
  const { step } = tourStore.getState();
  if (step === null) return;
  tourStore.setState({ step: step + 1 < TOUR_STEPS.length ? step + 1 : null });
}
