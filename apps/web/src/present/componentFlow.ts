import { uiText } from '../i18n';
import { descendantsOf } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import type { ReachDirection } from '../diagram/focus';
import type { PresentationStep } from './steps';

/** Breadth-first layers of the drawn graph: branches run together, cycles never repeat indefinitely. */
export function componentFlow(model: DiagramModel, origin: string, direction: ReachDirection): PresentationStep[] {
  const element = model.elements[origin];
  if (!element) return [];
  const initial = element.kind === 'group' ? [origin, ...descendantsOf(model, origin)] : [origin];
  const seen = new Set(initial);
  let frontier = new Set(initial);
  const label = element.label || origin;
  const steps: PresentationStep[] = [{ title: label, focus: initial, edges: [], note: uiText("Ponto de partida") }];
  const used = new Set<string>();
  for (let hop = 1; frontier.size && hop < 200; hop++) {
    const edges = model.edges.filter(edge => !used.has(edge.id) && frontier.has(direction === 'downstream' ? edge.from : edge.to));
    if (!edges.length) break;
    const next = new Set<string>();
    const focus = new Set<string>();
    for (const edge of edges) {
      used.add(edge.id);
      focus.add(edge.from); focus.add(edge.to);
      const id = direction === 'downstream' ? edge.to : edge.from;
      if (!seen.has(id)) { seen.add(id); next.add(id); }
    }
    steps.push({ title: uiText("Fluxo de {0}", [label]), focus: [...focus], edges: edges.map(edge => edge.id), note: edges.map(edge => edge.label || `${model.elements[edge.from]?.label || edge.from} → ${model.elements[edge.to]?.label || edge.to}`).join(' · ') });
    frontier = next;
  }
  if (steps.length === 1) steps[0]!.note = uiText("Nenhuma conexão neste sentido.");
  return steps;
}
