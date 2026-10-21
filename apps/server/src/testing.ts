import type { AiClient, CreateOptions, CreateParams, Message } from './anthropic';

/** Test helpers: fake Anthropic replies (no network). Not a test file itself. */
export function message(content: unknown[], extra: Record<string, unknown> = {}): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  } as unknown as Message;
}

export const toolUse = (input: unknown, id = 'toolu_1') => ({ type: 'tool_use', id, name: 'apply_diagram_ops', input });

/** Replies in order and records a deep copy of every request, alongside the `options` (e.g. `signal`) it got. No network. */
export function fakeClient(...replies: (Message | Error)[]) {
  const calls: CreateParams[] = [];
  const options: (CreateOptions | undefined)[] = [];
  const client: AiClient = {
    beta: {
      messages: {
        async create(params, opts) {
          calls.push(structuredClone(params));
          options.push(opts);
          const next = replies.shift();
          if (!next) throw new Error('fake client: no reply left');
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
  return { client, calls, options };
}
