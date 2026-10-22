# Funcionamento do Joinlet

O editor, API local, backend hospedável, CLI, MCP e extensão compartilham modelo, operações e formato de workspace. Posições visuais são separadas do significado.

Local: IndexedDB ou pasta; a API local acrescenta filesystem/Git, IA e integrações. Ela não deve ser exposta como substituto do backend hospedado. Navegador, API local, CLI, MCP e colaboração local usam self-hosted sem cotas comerciais de workspaces, diagramas ou participantes; isso não concede administração nem elimina limites técnicos.

Backend hospedável: Express autentica pelo GitHub e guarda arquivos em SQLite por workspace. Yjs/WebSocket mantém colaboração, convites e permissões no servidor. O entrypoint remoto usa JOINLET_DEPLOYMENT_MODE=self-hosted por padrão; o operador da Cloud seleciona cloud explicitamente. As políticas de conta e do dono do workspace são determinadas no servidor e isoladas por requisição. Payloads, headers e arquivos não escolhem a política de implantação. O modo GitHub projeta alterações em branch e PR; não dispõe de checkout completo da codebase do cliente.

IA usa chave pessoal (BYOK). Hosted cifra configurações e limita providers. A Cloud possui Beta e administrador; self-hosted é uma política separada, sem identidade de administrador. Papéis, CSRF, autenticação, isolamento, revogação e limites de transporte/armazenamento continuam ativos. O backend pessoal ainda tem um workspace persistente por dono e limite técnico de 25 MB por workspace para contas não administradoras. Assinaturas pagas, múltiplas réplicas e vários workspaces pessoais Cloud por dono não fazem parte deste estado implementado.

O produto completo é AGPL-3.0-only, sem edição proprietária reservada; operação gerenciada é a oferta comercial. Não há fontes/importadores configurados. As evidências ancoram arquivos públicos; a verificação é parcial e não prova semântica arbitrária do código.

## Prévia pública sem conta

O operador pode servir o editor com a meta strukt-mode=browser-preview. Esse modo abre IndexedDB sem solicitar uma sessão remota, aplica a política Beta no navegador e permite um workspace sem conta. A tentativa de criar outro abre uma explicação de que contas e workspaces adicionais ainda não estão disponíveis. Diagramas seguem a política Beta; dados acima de um limite continuam legíveis e exportáveis. Local/self-hosted sem essa meta continua sem cotas comerciais.

A prévia informa que os dados ficam somente neste navegador/origem e recomenda exportação ZIP. Ela não cria conta anônima no servidor, sincronização online, credenciais compartilhadas ou sessão com acesso a dados hospedados. Login, IA remota, colaboração e métodos futuros de autenticação não são habilitados por essa meta. O modo remote existente continua exigindo sessão autenticada/autorizada.
