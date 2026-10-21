# Distribuição e operação

O código do produto inclui os módulos necessários para terceiros instalarem o Joinlet com suas próprias credenciais. Materiais internos e procedimentos específicos da operação ficam em um repositório privado separado, sem manter um segundo fork do aplicativo. Segredos reais e dados de clientes ficam fora de ambos os repositórios.

A preparação inicial seleciona arquivos atuais e cria uma história Git nova. O repositório de desenvolvimento antigo permanece privado; não se importam automaticamente seu histórico, branches, tags, IDE/MCP local, workspace de trabalho nem prompts da marca. O novo .arch contém apenas a arquitetura pública e evidências do produto.

A checagem de publicação recusa caminhos privados e symlinks no index. O workflow usa Gitleaks com binário verificado por SHA-256, em histórico e checkout, sem permitir supressões por comentários. Fixtures de redação usam exemplos explícitos. Essas verificações não identificam universalmente informações pessoais nem provam segurança semântica.

A licença de código é AGPL-3.0-only; assets e marca têm seus termos documentados. A configuração e os dados reais do operador não são licenciados/publicados por estar disponível o código. A operação comercial e planos pagos são trabalho separado do Beta implementado.
