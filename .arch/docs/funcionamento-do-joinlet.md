# Funcionamento do Joinlet

O editor, API local, backend hospedável, CLI, MCP e extensão compartilham modelo, operações e formato de workspace. Posições visuais são separadas do significado.

Local: IndexedDB ou pasta; a API local acrescenta filesystem/Git, IA e integrações. Ela não deve ser exposta como substituto do backend hospedado.

Cloud: Express autentica pelo GitHub e guarda arquivos em SQLite por workspace. Yjs/WebSocket mantém colaboração, com convites e permissões no servidor. O modo GitHub projeta alterações em branch e PR; não dispõe de um checkout completo da codebase do cliente.

IA usa chave pessoal (BYOK). Hosted cifra configurações e limita providers. A política implementada distingue Beta de administrador. Assinaturas pagas, múltiplas réplicas e vários workspaces Cloud por dono não fazem parte deste estado implementado.

Não há fontes/importadores configurados. As evidências ancoram arquivos públicos; a verificação é parcial e não prova semântica arbitrária do código.
