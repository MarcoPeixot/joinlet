import type { DiagramModel } from '@strukt/core';
import { stableStringify } from './json';

export type FlowStep =
  | { kind?: 'message'; from: string; to: string; nth?: number; note?: string }
  | { kind: 'process'; node: string; note?: string }
  | { kind: 'choice' | 'parallel'; title?: string; branches: { title: string; steps: FlowStep[] }[]; note?: string }
  | { kind: 'goto'; diagram: string; flowId: string; note?: string };
export interface Flow { id: string; title: string; description?: string; steps: FlowStep[] }
export type FlowFrame = { steps: FlowStep[]; title?: string };

export const flowsPath = (slug: string) => `diagrams/${slug}.flows.json`;

function parseSteps(value: unknown, depth = 0): FlowStep[] {
  if (!Array.isArray(value) || depth > 6) return [];
  return value.slice(0, 500).flatMap((item): FlowStep[] => {
    if (!item || typeof item !== 'object') return [];
    const step = item as Record<string, unknown>;
    const note = typeof step.note === 'string' ? { note: step.note } : {};
    if (step.kind === 'process' && typeof step.node === 'string') return [{ kind: 'process', node: step.node, ...note }];
    if (step.kind === 'goto' && typeof step.diagram === 'string' && typeof step.flowId === 'string') return [{ kind: 'goto', diagram: step.diagram, flowId: step.flowId, ...note }];
    if (step.kind === 'choice' || step.kind === 'parallel') {
      const branches = Array.isArray(step.branches) ? step.branches.slice(0, 8).flatMap((raw): { title: string; steps: FlowStep[] }[] => {
        if (!raw || typeof raw !== 'object') return [];
        const branch = raw as Record<string, unknown>;
        return typeof branch.title === 'string' ? [{ title: branch.title, steps: parseSteps(branch.steps, depth + 1) }] : [];
      }) : [];
      return branches.length ? [{ kind: step.kind, ...(typeof step.title === 'string' ? { title: step.title } : {}), branches, ...note }] : [];
    }
    if ((step.kind === undefined || step.kind === 'message') && typeof step.from === 'string' && typeof step.to === 'string') {
      return [{ ...(step.kind === 'message' ? { kind: 'message' as const } : {}), from: step.from, to: step.to, ...(Number.isInteger(step.nth) && (step.nth as number) > 0 ? { nth: step.nth as number } : {}), ...note }];
    }
    return [];
  });
}

export function parseFlows(text: string | null): Flow[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item): Flow[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) || seen.has(value.id) || typeof value.title !== 'string') return [];
    seen.add(value.id);
    const steps = parseSteps(value.steps);
    return [{ id: value.id, title: value.title, ...(typeof value.description === 'string' ? { description: value.description } : {}), steps }];
  });
}

export const printFlows = (flows: readonly Flow[]) => stableStringify(flows);

export function flowEdge(model: DiagramModel, step: FlowStep): string | null {
  if (!('from' in step)) return null;
  return model.edges.filter((edge) => edge.from === step.from && edge.to === step.to)[(step.nth ?? 1) - 1]?.id ?? null;
}

export function renameFlowSteps(flows: readonly Flow[], from: string, to: string): Flow[] {
  const rename = (step: FlowStep): FlowStep => {
    if ('from' in step) return { ...step, from: step.from === from ? to : step.from, to: step.to === from ? to : step.to };
    if (step.kind === 'process') return { ...step, node: step.node === from ? to : step.node };
    if (step.kind === 'choice' || step.kind === 'parallel') return { ...step, branches: step.branches.map((branch) => ({ ...branch, steps: branch.steps.map(rename) })) };
    return step;
  };
  return flows.map((flow) => ({ ...flow, steps: flow.steps.map(rename) }));
}

export function flowStepIssue(model: DiagramModel, step: FlowStep, flows: Readonly<Record<string, readonly Flow[]>> = {}): string | null {
  if ('from' in step) return flowEdge(model, step) ? null : 'Conexão ausente';
  if (step.kind === 'process') return Object.hasOwn(model.elements, step.node) ? null : 'Componente ausente';
  if (step.kind === 'goto') return flows[step.diagram]?.some((flow) => flow.id === step.flowId) ? null : 'Fluxo de destino ausente';
  for (const branch of step.branches) {
    if (!branch.steps.length) return `Ramo ${branch.title} vazio`;
    const issue = branch.steps.map((nested) => flowStepIssue(model, nested, flows)).find(Boolean);
    if (issue) return `${branch.title}: ${issue}`;
  }
  return null;
}

export function flowFrames(flow: Flow, selectedBranches: Readonly<Record<number, number>> = {}): FlowFrame[] {
  const expand = (steps: readonly FlowStep[], topLevel = false): FlowFrame[] => steps.flatMap((step, index): FlowFrame[] => {
    if (step.kind === 'choice') {
      const branch = step.branches[selectedBranches[topLevel ? index : -1] ?? 0] ?? step.branches[0];
      return branch ? expand(branch.steps).map((frame) => ({ ...frame, title: step.title ? `${step.title} · ${branch.title}` : branch.title })) : [];
    }
    if (step.kind === 'parallel') {
      const paths = step.branches.map((branch) => expand(branch.steps));
      const count = Math.max(0, ...paths.map((path) => path.length));
      return Array.from({ length: count }, (_, i) => ({ steps: paths.flatMap((path) => path[i]?.steps ?? []), title: step.title ?? 'Em paralelo' }));
    }
    return [{ steps: [step] }];
  });
  return expand(flow.steps, true);
}
