import { uiText } from '../i18n';
import { descendantsOf, own } from '@strukt/core';
import type { DiagramModel, ID } from '@strukt/core';
import { flowEdge, flowFrames, flowStepIssue } from '@strukt/workspace';
import type { Flow, FlowStep } from '@strukt/workspace';

export interface PresentationStep {
  title: string;
  /** Elements drawn at full strength; the camera frames them. */
  focus: ID[];
  /** Connections drawn at full strength. */
  edges?: string[];
  /** Plain text shown under the title. */
  note?: string;
}

export const MAX_STEPS = 200;

const labelOf = (model: DiagramModel, id: ID) => own(model.elements, id)?.label ?? id;

function edgesAmong(model: DiagramModel, ids: ReadonlySet<ID>): string[] {
  return model.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => edge.id);
}

function flowStepView(model: DiagramModel, step: FlowStep): { title: string; focus: ID[]; edges: string[]; note?: string } | null {
  if (flowStepIssue(model, step)) return null;
  if ('from' in step) {
    const edge = flowEdge(model, step);
    const note = step.note ?? model.edges.find((item) => item.id === edge)?.label;
    return { title: `${labelOf(model, step.from)} → ${labelOf(model, step.to)}`, focus: step.from === step.to ? [step.from] : [step.from, step.to], edges: edge ? [edge] : [], ...(note ? { note } : {}) };
  }
  if (step.kind === 'process') return { title: uiText("Processo em {0}", [labelOf(model, step.node)]), focus: [step.node], edges: [], ...(step.note ? { note: step.note } : {}) };
  return null;
}

function fromFlows(model: DiagramModel, flows: readonly Flow[]): PresentationStep[] {
  const steps: PresentationStep[] = [];
  for (const flow of flows) {
    for (const frame of flowFrames(flow)) {
      const views = frame.steps.flatMap((step) => flowStepView(model, step) ?? []);
      if (!views.length) continue;
      const focus = [...new Set(views.flatMap((view) => view.focus))];
      const edges = [...new Set(views.flatMap((view) => view.edges))];
      const title = views.length === 1 ? views[0]!.title : (frame.title ?? views.map((view) => view.title).join(' · '));
      const note = views.find((view) => view.note)?.note;
      steps.push({ title: flows.length > 1 ? `${flow.title}: ${title}` : title, focus, ...(edges.length ? { edges } : {}), ...(note ? { note } : {}) });
      if (steps.length >= MAX_STEPS) return steps;
    }
  }
  return steps;
}

function fromGroups(model: DiagramModel): PresentationStep[] {
  const all = new Set(model.order);
  const steps: PresentationStep[] = [{ title: uiText("Visão geral"), focus: [...model.order], ...(model.edges.length ? { edges: edgesAmong(model, all) } : {}) }];
  const covered = new Set<ID>();
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (el?.kind !== 'group' || (el.parentId && own(model.elements, el.parentId))) continue;
    const inside = new Set([id, ...descendantsOf(model, id)]);
    for (const member of inside) covered.add(member);
    const edges = edgesAmong(model, inside);
    steps.push({ title: el.label ?? el.id, focus: model.order.filter((other) => inside.has(other)), ...(edges.length ? { edges } : {}), ...(el.description ? { note: el.description } : {}) });
  }
  const rest = model.order.filter((id) => !covered.has(id));
  if (steps.length > 1 && rest.length) {
    const edges = edgesAmong(model, new Set(rest));
    steps.push({ title: uiText("Outros"), focus: rest, ...(edges.length ? { edges } : {}) });
  }
  return steps.slice(0, MAX_STEPS);
}

/**
 * The walk-through of a diagram: the guided flows when it has usable ones (a broken step is skipped), otherwise an
 * overview followed by each root group and whatever sits outside groups. Pure and deterministic.
 */
export function buildPresentationSteps(model: DiagramModel, flows: readonly Flow[] = []): PresentationStep[] {
  const guided = fromFlows(model, flows);
  return guided.length ? guided : fromGroups(model);
}
