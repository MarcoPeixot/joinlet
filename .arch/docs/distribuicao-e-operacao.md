# Distribuição e operação

O produto público contém os módulos necessários à instalação com credenciais próprias. O repositório operacional privado guarda procedimentos e decisões de release, sem manter um segundo fork da aplicação. Segredos reais e dados de clientes ficam fora de ambos.

O snapshot público inicial usa uma história Git nova, sem transportar histórico, IDE/MCP local, workspace interno, pesquisas ou prompts da marca. O .arch público descreve o produto e suas evidências; não configura importadores.

A checagem do index recusa caminhos privados, symlinks, submódulos, backups aninhados, arquivos de chave/configuração, arquivos compactados, sidecars de banco e variantes de caixa. A checagem não identifica o conteúdo semântico de qualquer arquivo.

O workflow executa Gitleaks com binário verificado por SHA-256, configuração explícita externa e caminho de ignore novo. Configurações de exclusão, .gitleaksignore e comentários do repositório não podem ocultar achados. Testes de regressão usam tokens sintéticos gerados localmente e também conferem o histórico após apagar o arquivo de teste. Não há validação desses tokens com providers externos.

A imagem fixa a base Bun por digest e inclui licença, avisos de terceiros e referência ao código correspondente. A promoção oficial deve usar contexto de git archive do SHA revisado e digest imutável da imagem, evitando arquivos locais ignorados. A procedência do build é um controle separado de labels de imagem.

Os workflows atuais somente validam; não publicam imagens, não fazem deploy e não recebem credenciais de produção. O fluxo completo de homologação/promoção está proposto em Release do Joinlet. CODEOWNERS não substitui proteções habilitadas no GitHub; a disponibilidade em repositórios privados depende do plano.

A licença original preparada é AGPL-3.0-only, com termos de assets e marca separados. Cobrança e planos pagos continuam fora do Beta/Admin implementado.
