# Funcionamento do Joinlet

O editor, API local, backend hospedável, CLI, MCP e extensão compartilham modelo, operações e formato de workspace. Posições visuais são separadas do significado.

Local: IndexedDB ou pasta; a API local acrescenta filesystem/Git, IA e integrações. Ela não deve ser exposta como substituto do backend hospedado. Navegador, API local, CLI, MCP e colaboração local usam self-hosted sem cotas comerciais de workspaces, diagramas ou participantes; isso não concede administração nem elimina limites técnicos.

Backend hospedável: Express oferece cadastro e autenticação por e-mail/senha, com GitHub opcional quando configurado, e guarda arquivos em SQLite por workspace. Yjs/WebSocket mantém colaboração, convites e permissões no servidor. O entrypoint remoto usa JOINLET_DEPLOYMENT_MODE=self-hosted por padrão; o operador da Cloud seleciona cloud explicitamente. As políticas de conta e do dono do workspace são determinadas no servidor e isoladas por requisição. Payloads, headers e arquivos não escolhem a política de implantação. O modo GitHub projeta alterações em branch e PR; não dispõe de checkout completo da codebase do cliente.

IA usa chave pessoal (BYOK). Hosted cifra configurações e limita providers. A Cloud possui Beta e administrador; self-hosted é uma política separada, sem identidade de administrador. Papéis, CSRF, autenticação, isolamento, revogação e limites de transporte/armazenamento continuam ativos. O backend pessoal ainda tem um workspace persistente por dono e limite técnico de 25 MB por workspace para contas não administradoras. Assinaturas pagas, múltiplas réplicas e vários workspaces pessoais Cloud por dono não fazem parte deste estado implementado.

O produto completo é AGPL-3.0-only, sem edição proprietária reservada; operação gerenciada é a oferta comercial. Não há fontes/importadores configurados. As evidências ancoram arquivos públicos; a verificação é parcial e não prova semântica arbitrária do código.

## Prévia pública sem conta

O operador pode servir o editor com a meta strukt-mode=browser-preview. Esse modo abre IndexedDB sem solicitar uma sessão remota, aplica a política Beta no navegador e permite um workspace sem conta. A tentativa de criar outro abre uma explicação de que contas e workspaces adicionais ainda não estão disponíveis. Diagramas seguem a política Beta; dados acima de um limite continuam legíveis e exportáveis. Local/self-hosted sem essa meta continua sem cotas comerciais.

A prévia informa que os dados ficam somente neste navegador/origem e recomenda exportação ZIP. Ela não cria conta anônima no servidor, sincronização online, credenciais compartilhadas ou sessão com acesso a dados hospedados. Login, IA remota, colaboração e métodos futuros de autenticação não são habilitados por essa meta. O modo remote existente continua exigindo sessão autenticada/autorizada.

## Métricas opcionais da instalação

O cliente aceita a configuração explícita joinlet-analytics=/telemetry e joinlet-analytics-source=site ou editor, inserida pelo operador no HTML. Sem essa configuração não há coleta. O visitante escolhe permitir ou recusar métricas; recusa não altera recursos. Do Not Track e Global Privacy Control bloqueiam envios. O identificador aleatório fica somente nesta origem, expira em até 90 dias e é removido ao recusar.

Os eventos permitidos são page_view, editor_ready, editor_activity, editor_edited, export_generated e workspace_limit_viewed. O payload contém somente evento, identificador, origem lógica e referência de origem de uma lista restrita. Não contém modelos, documentos, nomes, prompts, URLs de projetos, queries ou credenciais. Abrir o exemplo não conta como edição. Atividade exige interação recente e aba visível; envios são limitados e falhas não bloqueiam a aplicação. Exportação significa geração e solicitação de download, não confirmação de gravação no disco do visitante.

A instrumentação pública não dá acesso ao painel ou dados do operador. Coletor, autenticação administrativa, banco e relatórios pertencem à implantação separada do operador, fora deste repositório. Os números dependem da adesão à coleta e representam navegadores por origem, sem identificação garantida de pessoas ou união automática entre site e editor.

## Dependências de segurança

Markdown de workspaces e respostas de IA passa pela lista restrita de tags e atributos de apps/web/src/docs/markdown.ts. DOMPurify tem versão mínima 3.4.17 e o lockfile fixa essa correção. O backend hospedável usa ip-address 10.7.4 por override compatível, incluindo a dependência transitiva de express-rate-limit. Atualizar bibliotecas não habilita os serviços hospedados na prévia pública e não substitui a validação de permissões do servidor.

## Contas por senha

A primeira entrega hospedada permite cadastro, entrada, saída e troca de senha sem SMTP nem credenciais GitHub. Senhas preservam espaços, aceitam 15 a 128 caracteres e usam Argon2id assíncrono. Trocar senha incrementa a versão da conta e invalida suas sessões HTTP e conexões ao vivo. Cadastro repetido não substitui credenciais existentes; erros de login não distinguem endereço ausente de senha incorreta. O e-mail serve apenas de login, sem confirmação de titularidade. Confirmação, recuperação por e-mail e vínculo entre métodos não estão implementados nesta entrega.

IDs internos são independentes do GitHub. A migração versionada conserva IDs e propriedade dos dados legados, e privilégios administrativos dependem do subject GitHub verificado. A prévia antiga permanece em IndexedDB: a tela de login exporta ZIPs para importação manual no workspace online. Um snapshot restaurado deve passar pela ferramenta recovery antes de voltar à rede, invalidando sessões, autorizações e convites antigos.

A implantação concreta pertence à operação. O produto suporta somente a configuração fornecida pelo operador; código e testes locais não comprovam ativação oficial. Não há importadores configurados; a verificação arquitetural mantém cobertura parcial.

## Perfil e diretório de contas

A pessoa autenticada pode editar o próprio nome (1 a 80 caracteres) e enviar/remover foto, mantendo o e-mail de login. A tela recorta PNG/JPG/WebP de até 2 MB para PNG de 128 px; o servidor limita tamanho, estrutura raster e dimensões, recusando SVG e URLs externas. A mutação exige origem e CSRF da sessão e não aceita ID de outra conta. Nome e foto persistem em SQLite e backups. Sessões válidas consultam o nome atualizado sem encerrar o acesso.

A migração v2 adiciona avatar, data de cadastro e último login sem alterar proprietários, hashes ou configurações cifradas. Datas históricas desconhecidas ficam nulas. Novos cadastros e sessões por senha registram o relógio do servidor.

O backend oferece um diretório somente leitura em /api/internal/accounts, desabilitado sem JOINLET_ACCOUNT_DIRECTORY_TOKEN. Um painel operacional separado pode consultar essa rota pela rede privada com uma credencial dedicada, mantendo sua própria autenticação administrativa. O proxy público deve bloquear toda a família /api/internal. A projeção tem ID, nome, e-mail e confirmação, foto, métodos de login, datas conhecidas e contagem de workspaces hospedados, com busca literal e páginas de 25 contas. Senhas, tokens, configurações de IA e conteúdo de projetos ficam excluídos. O painel privado não faz parte do produto público; a verificação neste checkout cobre a projeção e as evidências públicas, sem importadores ou comprovação de implantação.
