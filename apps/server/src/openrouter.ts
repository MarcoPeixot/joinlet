import type { AiClient } from './anthropic';
import { createChatCompletionsClient } from './openai';

export { ProviderError } from './openai';

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';

/** The server's `AiClient` over OpenRouter: the shared chat completions adapter with OpenRouter's address, title header and strict tools. */
export function createOpenRouterClient({ apiKey, fetch = globalThis.fetch }: { apiKey: string; fetch?: typeof globalThis.fetch }): AiClient {
  return createChatCompletionsClient({ baseUrl: OPENROUTER_API, apiKey, label: 'OpenRouter', strictTools: true, headers: { 'x-title': 'Joinlet' }, fetch });
}
