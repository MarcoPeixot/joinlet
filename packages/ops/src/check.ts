import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import type { AiOp } from './schema';
import { validateToolInput } from './schema';

export type AiMode = 'edit' | 'generate';

type Resolved = { ok: true; ops: DiagramOp[]; origin: number[] } | { ok: false; error: string };

/**
 * AI ops → DiagramOps. Edge references resolve against the diagram *before* the batch and those ops run
 * first (as in diffModels), so a rename or removal earlier in the batch cannot change the ids they use.
 * `origin[i]` is the AI's index of op i, for error messages.
 */
export function toDiagramOps(ops: readonly AiOp[], current: DiagramModel): Resolved {
  const edgeOps: [DiagramOp, number][] = [];
  const rest: [DiagramOp, number][] = [];
  for (const [index, op] of ops.entries()) {
    if (op.op !== 'update_edge' && op.op !== 'remove_edge') {
      rest.push([op, index]);
      continue;
    }
    const parallel = current.edges.filter((e) => e.from === op.from && e.to === op.to);
    const nth = op.nth ?? 1;
    const edge = parallel[nth - 1];
    if (!edge) {
      const reversed = current.edges.some((e) => e.from === op.to && e.to === op.from);
      const hint = reversed ? ` Existe "${op.to}" → "${op.from}": troque from e to.` : '';
      return {
        ok: false,
        error: `Operação ${index + 1} (${op.op}): não há ${nth > 1 ? `${nth}ª ` : ''}conexão de "${op.from}" para "${op.to}" no diagrama.${hint} Cite conexões pelos nomes como estão em <diagrama>; conexões novas recebem seta e rótulo no connect.`,
      };
    }
    edgeOps.push([op.op === 'update_edge' ? { op: 'update_edge', edgeId: edge.id, set: op.set } : { op: 'remove_edge', edgeId: edge.id }, index]);
  }
  const ordered = [...edgeOps, ...rest];
  return { ok: true, ops: ordered.map(([op]) => op), origin: ordered.map(([, index]) => index) };
}

type Check = { ok: true; ops: DiagramOp[]; summary: string } | { ok: false; error: string };

/** Removes every top-level element (and so everything): generate mode replaces the whole diagram. */
export function clearOps(model: DiagramModel): DiagramOp[] {
  return model.order.filter((id) => !model.elements[id]?.parentId).map((id) => ({ op: 'remove', id }));
}

/** Schema check + applyOps on the real model: the error text goes back to Claude as an is_error tool_result. */
export function checkProposal(input: unknown, mode: AiMode, current: DiagramModel): Check {
  const shape = validateToolInput(input);
  if (!shape.ok) return shape;
  const target = mode === 'generate' ? { ...emptyModel(), style: { ...current.style } } : current;
  const resolved = toDiagramOps(shape.ops, target);
  if (!resolved.ok) return resolved;
  const ops = mode === 'generate' ? [...clearOps(current), ...resolved.ops] : resolved.ops;
  try {
    const trial = applyOps(target, resolved.ops);
    if (!trial.ok) {
      const index = resolved.origin[trial.error.opIndex] ?? trial.error.opIndex;
      return {
        ok: false,
        error: `Operação ${index + 1} (${shape.ops[index]?.op}): ${trial.error.message} Nenhuma operação foi aplicada; corrija e envie o lote completo de novo.`,
      };
    }
    const full = applyOps(current, ops);
    if (!full.ok) return { ok: false, error: full.error.message };
  } catch (err) {
    return { ok: false, error: `Lote inválido: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, ops, summary: shape.summary.trim() };
}
