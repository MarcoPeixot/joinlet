import type { DiagramOp } from '@strukt/core';
import { parseDiagramJson } from '@strukt/json';
import { TOOL_INPUT_SCHEMA, TOOL_NAME, checkProposal } from '@strukt/ops';
import { MODELS } from './anthropic';
import type { AiClient, CreateParams, MessageParam, Models, Tool, ToolUseBlock } from './anthropic';
import { DIAGRAM_SYSTEM_PROMPT, NO_TOOL_CALL_NUDGE, diagramUserPrompt } from './prompt';
import type { AiMode, DiagramRequest } from './prompt';

export const DIAGRAM_TOOL: Tool = {
  name: TOOL_NAME,
  description:
    'Aplica um lote de operações (DiagramOp) ao diagrama. Chame sempre que for alterar ou gerar o diagrama; o lote é atômico e mostrado como proposta antes de ser aplicado.',
  strict: true,
  input_schema: TOOL_INPUT_SCHEMA,
};

/** Repair turns after the first answer: at most 3 calls per request. */
export const MAX_REPAIRS = 2;

export type Failure = { ok: false; status: 400 | 422 | 502; error: string };
export type Proposal = { ok: true; ops: DiagramOp[]; summary: string; model: string };

/**
 * Request for one turn. Opus 5.5 rejects forced tool_choice and disabled thinking, so both models run with
 * tool_choice auto (+ the prompt asking for the call), strict tool input and adaptive thinking with an
 * explicit effort. The cache breakpoint on the system block covers tools + system (render order).
 */
export function diagramParams(mode: AiMode, messages: MessageParam[], models: Models = MODELS): CreateParams {
  const params: CreateParams = {
    model: models[mode],
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: mode === 'generate' ? 'medium' : 'high' },
    system: [{ type: 'text', text: DIAGRAM_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [DIAGRAM_TOOL],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages,
  };
  // Opus 5.5 safety classifiers can decline benign requests: let the API retry on its recommended fallback.
  if (mode === 'generate') return { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  return params;
}

/** Instruction → validated ops, with up to MAX_REPAIRS repair turns (spec §10). */
export async function proposeOps(client: AiClient, request: DiagramRequest, signal?: AbortSignal, models: Models = MODELS): Promise<Proposal | Failure> {
  const parsed = parseDiagramJson(request.json);
  const syntax = parsed.diagnostics.find((d) => d.severity === 'error');
  if (syntax) return { ok: false, status: 400, error: `O diagrama tem erro na linha ${syntax.line}: ${syntax.message}` };
  const current = parsed.model;
  const messages: MessageParam[] = [{ role: 'user', content: diagramUserPrompt(request, current) }];
  let lastError = 'a IA não chamou a ferramenta.';
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    // The deadline (or an abandoned client) can fire between turns: stop before spending a repair call on it.
    if (signal?.aborted) throw signal.reason;
    const response = await client.beta.messages.create(diagramParams(request.mode, [...messages], models), { signal });
    if (response.stop_reason === 'refusal') return { ok: false, status: 422, error: 'A IA recusou este pedido. Reformule a instrução.' };
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, status: 502, error: 'A resposta da IA ficou longa demais e foi cortada. Peça uma mudança menor.' };
    }
    // Append-only history, thinking blocks included and unchanged (preserved thinking on Opus 5.5).
    messages.push({ role: 'assistant', content: response.content });
    const call = response.content.find((block): block is ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME);
    if (!call) {
      lastError = 'a IA não chamou a ferramenta.';
      messages.push({ role: 'user', content: NO_TOOL_CALL_NUDGE });
      continue;
    }
    const check = checkProposal(call.input, request.mode, current);
    if (check.ok) return { ok: true, ops: check.ops, summary: check.summary, model: response.model };
    lastError = check.error;
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: check.error }] });
  }
  return { ok: false, status: 502, error: `A IA não conseguiu propor operações válidas. Último erro: ${lastError}` };
}
