import { uiText } from '../i18n';
import { COMPATIBLE_PROVIDERS } from '@strukt/core';
export const PROVIDER = {
  gemini: { ...COMPATIBLE_PROVIDERS.gemini, blurb: uiText("Conecte o Google AI Studio e escolha modelos Gemini para seu workspace."), placeholder: uiText("Cole sua API key"), mark: 'G', color: '#4285f4' },
  deepseek: { ...COMPATIBLE_PROVIDERS.deepseek, blurb: uiText("Conecte sua conta DeepSeek e escolha o modelo para cada tarefa."), placeholder: uiText("Cole sua API key"), mark: 'DS', color: '#4d6bfe' },
  groq: { ...COMPATIBLE_PROVIDERS.groq, blurb: uiText("Conecte a Groq para usar modelos abertos com inferência rápida."), placeholder: uiText("Cole sua API key"), mark: 'GQ', color: '#f55036' },
  mistral: { ...COMPATIBLE_PROVIDERS.mistral, blurb: uiText("Conecte os modelos da Mistral AI com a sua própria chave."), placeholder: uiText("Cole sua API key"), mark: 'M', color: '#ff7000' },

  anthropic: {
    name: 'Anthropic',
    blurb: uiText("Claude direto da Anthropic. Sonnet 5 edita e documenta; Opus 5.5 gera do zero."),
    placeholder: 'sk-ant-…',
    env: 'ANTHROPIC_API_KEY',
    mark: 'A',
    color: '#d97757',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    name: 'OpenRouter',
    blurb: uiText("Centenas de modelos com uma chave só. Escolha abaixo qual modelo faz cada tarefa."),
    placeholder: 'sk-or-v1-…',
    env: 'OPENROUTER_API_KEY',
    mark: 'OR',
    color: '#2563eb',
    keysUrl: 'https://openrouter.ai/keys',
  },
  opencodego: {
    name: 'OpenCode Go',
    blurb: uiText("Use a API key da sua assinatura Go ou Go Plus. Escolha um modelo compatível do plano para cada tarefa."),
    placeholder: uiText("Cole sua API key do OpenCode Go"),
    env: 'OPENCODE_GO_API_KEY',
    mark: 'GO',
    color: '#2563eb',
    keysUrl: 'https://opencode.ai/auth',
  },
  opencode: {
    name: 'OpenCode Zen',
    blurb: uiText("Conecte sua API key do OpenCode e escolha um modelo de chat para editar, gerar e documentar."),
    placeholder: uiText("Cole sua API key do OpenCode"),
    env: 'OPENCODE_API_KEY',
    mark: 'OC',
    color: '#334155',
    keysUrl: 'https://opencode.ai/auth',
  },
  openai: {
    name: uiText("Compatível com OpenAI"),
    blurb: uiText("OpenAI, Groq, Together, Ollama ou LM Studio: qualquer servidor com /chat/completions. Em servidores locais a chave é opcional."),
    placeholder: 'sk-… (opcional)',
    env: 'OPENAI_API_KEY',
    mark: 'AI',
    color: '#4a5568',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
} as const;

