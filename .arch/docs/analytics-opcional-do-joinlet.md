# Analytics opcional do Joinlet

O produto envia métricas somente quando o operador habilita a meta joinlet-analytics=/telemetry e o visitante permite a versão 2 do consentimento. Instalações sem essa configuração não consultam o coletor. A recusa mantém os recursos disponíveis; DNT e Global Privacy Control bloqueiam eventos. Consentimentos v1 não autorizam as novas finalidades.

A coleta cobre landing, guias estáticos e editor. Um GET em /telemetry/consent consulta a preferência; POST com version e consent permite ou revoga. O coletor do operador mantém a preferência compartilhada apenas entre origens confiáveis, separada da autenticação administrativa. O navegador usa credentials=same-origin e um identificador aleatório por até 90 dias; não há fingerprinting nem identificadores de analytics nos links.

Eventos v2 têm version, event_id, event, visitor, source, referrer, page, guide, language e os campos utm_source, utm_medium e utm_campaign. kind, format, placement e duration são propriedades opcionais específicas. IDs de guias e posições de botões vêm do produto; campanhas e demais propriedades devem ser validadas pelo coletor. Conteúdo, nomes, caminhos, URL completa, query strings, prompts, credenciais e mensagens livres de erro não são enviados. Uma referência ausente não comprova tráfego direto.

A família de eventos inclui page_view, editor_cta_clicked, editor_ready, editor_activity, editor_edited, content_saved, save_failed, editor_failed, workspace_reopened, export_generated, export_failed e workspace_limit_viewed. Criar um item vazio e carregar o exemplo não são ativação. Uma interação recente pode marcar alteração de diagrama não vazio, documento com pelo menos 20 caracteres ou sketch com elemento; content_saved só ocorre após o salvador completar uma gravação efetiva sem pendências. Cancelamento, seed, arquivos inalterados e adaptador de memória não confirmam persistência. As regras são aproximações de uso significativo, não prova de valor percebido por uma pessoa.

Exportações registram formato e geração/solicitação de download ou cópia, sem afirmar que o arquivo foi guardado pelo usuário. Reabrir um workspace existente é um sinal separado de voltar a criar. Falhas usam categorias fixas sem mensagem ou caminho.

O cliente serializa envios e tenta até três vezes com o mesmo event_id. A revogação cancela envios ainda não iniciados. O coletor deve deduplicar, aplicar limites, proteger o acesso a relatórios e distinguir eventos recebidos de eventos entregues. Dados de localização, quando o operador oferece esse enriquecimento, são estimativas derivadas no servidor; o cliente não fornece país/cidade e o IP não entra no payload do produto.

Os números representam navegadores consentidos, não população total nem identidade de pessoas entre dispositivos. Sessões, atribuição, coortes e política de retenção pertencem ao coletor configurado pelo operador. Não há reconstrução de geografia ou eventos anteriores à instrumentação.

## Validação e cobertura

Testes exercitam recusa, expiração, migração de consentimento, controles de privacidade, reenvio com o mesmo ID, ausência de conteúdo no payload, documentação e persistência após edição real. O salvador tem regressão para cancelamento, arquivos inalterados e erro. Arquivos centrais: apps/web/src/analytics/client.ts, apps/web/src/analytics/docs.ts, apps/web/src/workspace/workspace.ts e packages/workspace/src/saver.ts. Não há importadores configurados em .arch/sources.json; evidências ancoradas e verify não demonstram equivalência semântica de todo o código.
