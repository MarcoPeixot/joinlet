import Anthropic from '@anthropic-ai/sdk';
import type { AiClient, CreateOptions, CreateParams, Message, StreamEvent } from './anthropic';
import { ProviderError, createChatCompletionsClient } from './openai';

export const OPENCODE_API = 'https://opencode.ai/inference/openai/v1';
export const OPENCODE_MODELS = 'https://opencode.ai/inference/v1/models';
export const DEFAULT_OPENCODE_MODEL = 'big-pickle';

/** Models documented by OpenCode for Chat Completions (other families use different protocols). */
export function isOpenCodeChatModel(id: string): boolean {
  return /^(big-pickle|qwen3\.8-max|(?:glm-|kimi-|minimax-|deepseek-|mistral-).+|(?:beam|ll-alpha|space-bunny|longcat|exo|mimo-|nemotron).*-free)$/.test(id);
}
export function createOpenCodeClient({ apiKey, fetch = globalThis.fetch }: { apiKey: string; fetch?: typeof globalThis.fetch }) {
  return createChatCompletionsClient({ baseUrl: OPENCODE_API, apiKey, label: 'OpenCode Zen', fetch });
}

export const OPENCODE_GO_API = 'https://opencode.ai/inference/go/openai/v1';
export const OPENCODE_GO_MODELS = 'https://opencode.ai/inference/go/v1/models';
export const DEFAULT_OPENCODE_GO_MODEL = 'glm-5.3-flash';
/** Go routes some families through Messages, even when Zen uses Chat Completions. */
export function openCodeGoProtocol(id: string): 'chat' | 'messages' | null {
  if (/^(claude-haiku-5-5|qwen3\.(?:6-plus|7-(?:plus|max)|8-(?:max|flash))|minimax-m3)$/.test(id)) return 'messages';
  if (/^(glm-5\.[123](?:-flash)?|kimi-k(?:2\.(?:6|7-code)|3)|deepseek-v4(?:\.1-flash|-pro)|mimo-v2\.(?:5|6)(?:-flash|-pro)?|hy3|hy4-preview|space-bunny|longcat-(?:2\.0|2\.5-preview-free)|step-5-preview|beam-free|minimax-m2\.(?:5|7))$/.test(id)) return 'chat';
  return null;
}

/** A request-scoped client: its stable conversation header also follows repair/retry calls. */
export function createOpenCodeGoClient({ apiKey, sessionId, fetch = globalThis.fetch }: { apiKey: string; sessionId: string; fetch?: typeof globalThis.fetch }): AiClient {
  const headers = { 'user-agent': 'Joinlet/0.1', 'x-opencode-session': sessionId };
  const chat = createChatCompletionsClient({ baseUrl: OPENCODE_GO_API, apiKey, label: 'OpenCode Go', headers, fetch });
  const messages: AiClient = new Anthropic({ apiKey, authToken: null, baseURL: 'https://opencode.ai/inference/go/anthropic', defaultHeaders: headers, fetch, maxRetries: 1, timeout: 240_000 });
  const pick = (model: string) => {
    const protocol = openCodeGoProtocol(model);
    if (!protocol) throw new ProviderError(400, 'Modelo incompatível com a conexão OpenCode Go.', 'OpenCode Go');
    return protocol === 'messages' ? messages : chat;
  };
  const fail = (error: unknown): never => {
    if (error instanceof Anthropic.APIError) throw new ProviderError(error.status ?? 502, error.message, 'OpenCode Go');
    throw error;
  };
  return { beta: { messages: {
    async create(params: CreateParams, options?: CreateOptions): Promise<Message> {
      try { return await pick(params.model).beta.messages.create(params, options); } catch (error) { return fail(error); }
    },
    async *stream(params: CreateParams, options?: CreateOptions): AsyncGenerator<StreamEvent> {
      try { yield* pick(params.model).beta.messages.stream!(params, options); } catch (error) { fail(error); }
    },
  } } };
}
