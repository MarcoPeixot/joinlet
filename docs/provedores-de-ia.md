# Provedores de IA do Joinlet

Em Configurações › IA e providers, cada conexão nomeada mantém chave e modelos separados. Gemini, DeepSeek, Groq e Mistral AI usam o adaptador Chat Completions existente, com endpoint fixo. Anthropic, OpenRouter, OpenCode Go, OpenCode Zen e a conexão compatível com OpenAI continuam disponíveis. Ollama e LM Studio permanecem presets desta última.

Conectar salva a chave no servidor e ativa a conexão. Testar consulta `/models`, sem geração paga. A lista de modelos vem do serviço; também é possível informar o ID manualmente. Use um modelo de chat com suporte a ferramentas. O modelo de edição é o padrão; geração e documentação podem usar outro modelo ou herdar o de edição. No chat, a escolha é por conversa e não muda o padrão global.

| Conexão | Variável opcional no servidor | API |
| --- | --- | --- |
| Google Gemini | GEMINI_API_KEY | https://generativelanguage.googleapis.com/v1beta/openai |
| DeepSeek | DEEPSEEK_API_KEY | https://api.deepseek.com |
| Groq | GROQ_API_KEY | https://api.groq.com/openai/v1 |
| Mistral AI | MISTRAL_API_KEY | https://api.mistral.ai/v1 |

Variáveis têm prioridade sobre chaves salvas, como nas conexões anteriores. Os arquivos existentes continuam sendo lidos. `/api/settings` só retorna status e a dica com os últimos quatro caracteres. O catálogo dos novos provedores usa `/api/settings/openai-models?provider=<id>`; a seleção é validada antes da chamada. Não é aceito um endpoint arbitrário por esse parâmetro. Requisições não seguem redirecionamentos.

O adaptador mantém metadados de continuação de ferramentas em memória no cliente do provedor: assinaturas de pensamento do Gemini e reasoning_content de respostas que o exigem. Isso permite turnos de ferramentas/reparo sem expor esses metadados no navegador. Não são arquivos de workspace ou credenciais.

## Fontes verificadas

- [Compatibilidade OpenAI do Gemini](https://ai.google.dev/gemini-api/docs/openai)
- [Primeira chamada DeepSeek](https://api-docs.deepseek.com/)
- [API Groq](https://console.groq.com/docs/overview)
- [API Mistral](https://docs.mistral.ai/api)

## Logos e ilustrações

SVGs em `apps/web/public/brand/providers/`: Anthropic, Gemini, DeepSeek, Mistral, OpenCode e OpenRouter vêm do Simple Icons instalado no projeto. OpenAI vem de `@iconify-json/logos`; Groq vem de [Lobe Icons](https://unpkg.com/@lobehub/icons-static-svg/icons/groq.svg). As marcas usam a cor do texto para manter legibilidade nos dois temas. Indicam conexões disponíveis, não endosso ou clientes.

As três novas poses de Jo foram geradas pela ferramenta integrada image_gen; prompts e caminhos estão em `apps/web/public/brand/JO-PROMPTS.md`. A landing usa movimento reduzido, pausa explícita e uma única lista acessível de provedores.

## Validação

Testes locais cobrem persistência, isolamento de chaves, modelos por tarefa, troca por conversa, recusas da API, catálogos e metadados de ferramentas. As respostas dos provedores são simuladas nos testes; a validação com uma conta real ocorre no botão Testar conexão, usando a chave informada pela pessoa.
