import type Anthropic from '@anthropic-ai/sdk';

export type Message = Anthropic.Beta.Messages.BetaMessage;
export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type Tool = Anthropic.Beta.Messages.BetaTool;
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;

/** The `options` every call forwards: compatible with the real SDK's `RequestOptions` (it also takes a `signal`). */
export interface CreateOptions {
  signal?: AbortSignal;
}

/** The slice of the Anthropic SDK the server uses: `new Anthropic()` in main.ts, a fake in tests (no network). */
/** What a text stream yields: the raw events the SDK's `MessageStream` iterates (only text deltas and the stop reason are read). */
export interface StreamEvent {
  search?: import('@strukt/core').ChatSearchActivity;
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string; input?: unknown };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null };
}

export interface AiClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: CreateOptions): Promise<Message>;
      /** Optional: the answer as it is written (the SDK has it; OpenRouter's adapter implements it). */
      stream?(params: CreateParams, options?: CreateOptions): AsyncIterable<StreamEvent>;
    };
  };
}

/** The model each job runs on; the active provider supplies them (OpenRouter's come from Configurações). */
export interface Models {
  edit: string;
  generate: string;
  doc: string;
}

/** Spec §10: Sonnet edits and writes docs; Opus 5.5 generates whole diagrams. */
export const MODELS = { edit: 'claude-sonnet-5', generate: 'claude-opus-5-5', doc: 'claude-sonnet-5' } as const satisfies Models;
