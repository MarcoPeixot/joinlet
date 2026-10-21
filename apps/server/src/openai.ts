import type { AiClient, CreateOptions, CreateParams, Message, StreamEvent } from './anthropic';

/** An HTTP failure or invalid/incomplete provider response. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** How the provider is called in the pt-BR messages ("o <provider> recusou a chave"). */
    readonly provider: string = 'OpenRouter',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

type Json = Record<string, unknown>;
type Block = Json & { type?: string };

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

function checkedReply(value: unknown, label: string): Json {
  if (!isObject(value)) throw new ProviderError(502, 'A IA enviou uma resposta inválida.', label);
  if (value.error) {
    const detail = typeof value.error === 'string' ? value.error : isObject(value.error) ? value.error.message : null;
    throw new ProviderError(502, typeof detail === 'string' ? detail : 'O provider interrompeu a resposta.', label);
  }
  return value;
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[]).flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n')
      : '';

/** Anthropic messages → OpenAI-style chat messages (thinking dropped; tool_use → tool_calls; tool_result → `tool`). */
function toChatMessages(params: CreateParams): Json[] {
  const out: Json[] = [];
  const system = textOf(params.system);
  if (system) out.push({ role: 'system', content: system });
  for (const message of params.messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const blocks = message.content as Block[];
    if (message.role === 'assistant') {
      const text = textOf(blocks);
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const content = textOf(block.content);
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.is_error ? `Erro: ${content}` : content });
      }
    }
    const text = textOf(blocks);
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

/** Only what chat completions understand: thinking, betas, fallbacks, cache_control and output_config stay behind. */
function toChatRequest(params: CreateParams, strictTools: boolean, tokenField: TokenField): Json {
  const body: Json = { model: params.model, [tokenField]: params.max_tokens, messages: toChatMessages(params) };
  if (params.tools?.length) {
    body.tools = (params.tools as Block[]).map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema, ...(strictTools && tool.strict ? { strict: true } : {}) },
    }));
    const choice = params.tool_choice as Block | undefined;
    body.tool_choice = choice?.type === 'tool' ? { type: 'function', function: { name: choice.name } } : choice?.type === 'none' ? 'none' : 'auto';
    if (choice?.disable_parallel_tool_use) body.parallel_tool_calls = false;
  }
  return body;
}

const STOP: Record<string, Message['stop_reason']> = { tool_calls: 'tool_use', stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' };

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    // Handed to the schema check as is: the repair loop tells the model its arguments were not JSON.
    return raw;
  }
}

/** Chat completion → Anthropic message (text block, then one tool_use per tool call). */
function toMessage(reply: Json): Message {
  const choice = ((reply.choices as Json[] | undefined) ?? [])[0] ?? {};
  const message = (choice.message as Json | undefined) ?? {};
  const content: Json[] = [];
  if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  for (const call of (message.tool_calls as Json[] | undefined) ?? []) {
    const fn = (call.function as Json | undefined) ?? {};
    content.push({ type: 'tool_use', id: call.id, name: fn.name, input: parseArguments(fn.arguments) });
  }
  const usage = (reply.usage as Json | undefined) ?? {};
  return {
    id: String(reply.id ?? 'chat-completion'),
    type: 'message',
    role: 'assistant',
    model: String(reply.model ?? ''),
    content,
    stop_reason: STOP[String(choice.finish_reason)] ?? 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: Number(usage.prompt_tokens ?? 0), output_tokens: Number(usage.completion_tokens ?? 0) },
  } as unknown as Message;
}

/** OpenAI-style `{error: {message}}`, or Ollama's plain `{error: "…"}`; the status when the body says nothing. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const error = body?.error;
  if (typeof error === 'string' && error) return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : `HTTP ${res.status}`;
}

/** The `data:` payloads of a server-sent-events body, whole even when a chunk cuts a line in two. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) yield rest.slice(5).trim();
  } finally {
    // Closing a generator must also stop the HTTP body, not just unlock its reader.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type TokenField = 'max_tokens' | 'max_completion_tokens';

const MAX_BASE_URL = 300;

/**
 * The base URL of an OpenAI-compatible server as typed (`http://localhost:11434/v1`): http(s) only, no credentials,
 * query or fragment (a key in the URL would leak into logs and error messages), trailing slashes and a pasted
 * `/chat/completions` dropped. A pt-BR reason otherwise.
 */
export function normalizeBaseUrl(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string') return { error: 'O endereço precisa ser texto.' };
  const text = raw.trim();
  if (!text) return { error: 'O endereço do servidor está vazio.' };
  if (text.length > MAX_BASE_URL) return { error: 'O endereço é longo demais.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'Endereço inválido: use uma URL completa, como http://localhost:11434/v1.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'O endereço precisa começar com http:// ou https://.' };
  if (url.username || url.password) return { error: 'O endereço não pode ter usuário ou senha: use o campo de chave.' };
  if (url.search || url.hash) return { error: 'O endereço não pode ter parâmetros (?…) nem âncora (#…).' };
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `${url.origin}${path}`;
}

export interface ChatCompletionsOptions {
  /** Without the trailing slash (`normalizeBaseUrl`); requests go to `<baseUrl>/chat/completions`. */
  baseUrl: string;
  /** Optional: local servers (Ollama, LM Studio) take none. Sent as `Authorization: Bearer`. */
  apiKey?: string;
  /** How the provider is named in error messages. */
  label: string;
  /** Extra request headers (OpenRouter's `x-title`). */
  headers?: Record<string, string>;
  /** Sends `strict: true` on tools that ask for it (OpenRouter forwards it; OpenAI's strict mode wants a stricter schema than ours). */
  strictTools?: boolean;
  fetch?: typeof globalThis.fetch;
}

/**
 * The server's `AiClient` over any OpenAI-style chat completions endpoint: Anthropic-shaped requests go out as chat
 * completions and the replies come back as Anthropic messages, so the prompt, the strict tool and the repair loop stay
 * the same. A server that refuses `max_tokens` (OpenAI's newer models) is asked again with `max_completion_tokens`,
 * and remembered.
 */
export function createChatCompletionsClient({ baseUrl, apiKey, label, headers = {}, strictTools = false, fetch = globalThis.fetch }: ChatCompletionsOptions): AiClient {
  let tokenField: TokenField = 'max_tokens';
  // Provider-owned continuation metadata stays in this client, never in browser-visible messages.
  // Gemini requires thought signatures; DeepSeek reasoning models require reasoning_content on tool turns.
  const continuations = new Map<string, { extra?: unknown; reasoning?: string }>();
  const remember = (id: string, value: { extra?: unknown; reasoning?: string }) => {
    continuations.set(id, { ...continuations.get(id), ...value });
    if (continuations.size > 256) continuations.delete(continuations.keys().next().value!);
  };


  async function post(params: CreateParams, stream: boolean, signal: AbortSignal | undefined): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const body: Json = { ...toChatRequest(params, strictTools, tokenField), ...(stream ? { stream: true } : {}) };
      for (const message of body.messages as Json[]) {
        for (const call of (message.tool_calls as Json[] | undefined) ?? []) {
          const continuation = continuations.get(String(call.id));
          if (continuation?.extra) call.extra_content = continuation.extra;
          if (continuation?.reasoning !== undefined) message.reasoning_content = continuation.reasoning;
        }
      }
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        // A redirect would replay the request (and the key) somewhere the person did not choose.
        redirect: 'error',
        signal,
      });
      if (res.ok) return res;
      const message = await errorMessage(res);
      if (attempt === 0 && res.status === 400 && tokenField === 'max_tokens' && /max_completion_tokens/i.test(message)) {
        tokenField = 'max_completion_tokens';
        continue;
      }
      throw new ProviderError(res.status, message, label);
    }
  }

  return {
    beta: {
      messages: {
        async create(params: CreateParams, options?: CreateOptions): Promise<Message> {
          const res = await post(params, false, options?.signal);
          const reply = checkedReply(await res.json().catch(() => null), label);
          const choice = Array.isArray(reply.choices) ? reply.choices[0] : undefined;
          if (!isObject(choice) || !isObject(choice.message) || !Object.hasOwn(STOP, String(choice.finish_reason))) {
            throw new ProviderError(502, 'A IA não concluiu a resposta.', label);
          }
          const message = choice.message;
          for (const call of (message.tool_calls as Json[] | undefined) ?? []) {
            if (typeof call.id === 'string') remember(call.id, { ...(call.extra_content ? { extra: call.extra_content } : {}), ...(typeof message.reasoning_content === 'string' ? { reasoning: message.reasoning_content } : {}) });
          }
          return toMessage(reply);
        },
        /** Normalize text and tool arguments into the same block events as Anthropic. */
        async *stream(params: CreateParams, options?: CreateOptions): AsyncGenerator<StreamEvent> {
          const res = await post(params, true, options?.signal);
          if (!res.body) throw new ProviderError(502, 'A IA não devolveu uma resposta.', label);
          const startedTools = new Set<number>();
          const toolIds = new Map<number, string>();
          let reasoning = '';
          let finished = false;
          for await (const data of sseData(res.body)) {
            if (data === '[DONE]') break;
            let raw: unknown;
            try { raw = JSON.parse(data); } catch { throw new ProviderError(502, 'A IA enviou uma resposta inválida.', label); }
            const chunk = checkedReply(raw, label);
            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Json | undefined : undefined;
            if (!choice) continue;
            const delta = choice.delta as Json | undefined;
            if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
            const content = delta?.content;
            if (typeof content === 'string' && content) yield { type: 'content_block_delta', delta: { type: 'text_delta', text: content } };
            for (const call of (((choice.delta as Json | undefined)?.tool_calls as Json[] | undefined) ?? [])) {
              const index = Number(call.index ?? 0) + 1000;
              const fn = call.function as Json | undefined;
              if (typeof call.id === 'string') toolIds.set(index, call.id);
              const toolId = toolIds.get(index) ?? `call_${index}`;
              remember(toolId, { ...(call.extra_content ? { extra: call.extra_content } : {}), ...(reasoning ? { reasoning } : {}) });
              if (!startedTools.has(index)) {
                startedTools.add(index);
                yield { type: 'content_block_start', index, content_block: { type: 'tool_use', id: typeof call.id === 'string' ? call.id : `call_${index}`, name: String(fn?.name ?? ''), input: {} } };
              }
              if (typeof fn?.arguments === 'string') yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: fn.arguments } };
            }
            if (typeof choice.finish_reason === 'string') {
              if (!Object.hasOwn(STOP, choice.finish_reason)) throw new ProviderError(502, 'A IA não concluiu a resposta.', label);
              finished = true;
              yield { type: 'message_delta', delta: { stop_reason: STOP[choice.finish_reason] } };
            }
          }
          if (!finished) throw new ProviderError(502, 'A IA interrompeu a resposta antes de concluir. Tente novamente.', label);
        },
      },
    },
  };
}
