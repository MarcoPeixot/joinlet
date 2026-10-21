import { isAiProvider } from './aiProviders';
import type { AiProviderId } from './aiProviders';
export interface ChatModelChoice {
  provider: AiProviderId;
  model: string;
}

/** Request-scoped model selection; never includes keys or provider URLs. */
export function readChatModel(raw: unknown): ChatModelChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isAiProvider(value.provider) || typeof value.model !== 'string' || !value.model || value.model.length > 200 || /\s|[\x00-\x1f]/.test(value.model)) return null;
  return { provider: value.provider as ChatModelChoice['provider'], model: value.model };
}
