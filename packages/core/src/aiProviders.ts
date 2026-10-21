/** Named connections use fixed endpoints; keys never cross between providers. */
export const COMPATIBLE_PROVIDERS = {
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', model: 'gemini-3.8-flash', keysUrl: 'https://aistudio.google.com/apikey' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', env: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', keysUrl: 'https://platform.deepseek.com/api_keys' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', model: 'openai/gpt-oss-20b', keysUrl: 'https://console.groq.com/keys' },
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY', model: 'mistral-small-latest', keysUrl: 'https://console.mistral.ai/api-keys' },
} as const;
export type CompatibleProviderId = keyof typeof COMPATIBLE_PROVIDERS;
export const COMPATIBLE_PROVIDER_IDS = Object.keys(COMPATIBLE_PROVIDERS) as CompatibleProviderId[];
export const AI_PROVIDER_IDS = ['anthropic', 'openrouter', 'openai', 'opencode', 'opencodego', ...COMPATIBLE_PROVIDER_IDS] as const;
export type AiProviderId = typeof AI_PROVIDER_IDS[number];
export const isAiProvider = (id: unknown): id is AiProviderId => typeof id === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(id);
export const isCompatibleProvider = (id: unknown): id is CompatibleProviderId => typeof id === 'string' && Object.hasOwn(COMPATIBLE_PROVIDERS, id);
