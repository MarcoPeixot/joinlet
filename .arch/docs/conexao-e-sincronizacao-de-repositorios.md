# Conexão e sincronização de repositórios

Implementação disponível no código. A ativação do serviço oficial e a homologação com GitHub real dependem do operador; os testes locais não comprovam publicação em produção.

## Conectar uma pasta

Execute `joinlet connect [pasta]` ou `joinlet connect --dir /caminho/do/projeto`. O conector abre o editor local sem conta. O botão **Conectar pasta** usa um seletor nativo quando a API local está disponível. Na Cloud autenticada, **Conectar computador** gera um código de dez minutos: execute o comando apresentado e mantenha o processo aberto. Depois, **Escolher pasta** abre o seletor no computador pareado. A comunicação privilegiada sai do conector para a origem autenticada; a Cloud não chama localhost.

`joinlet init --dir /projeto` prepara `.arch`; `joinlet watch --dir /projeto` acompanha alterações. `joinlet sync --check` diagnostica sem escrever e retorna código diferente de zero se existirem mudanças ou análises pendentes. `joinlet context` e `joinlet verify --strict` continuam compatíveis.

Pastas sem Git são aceitas. O diagnóstico informa Git, branch, upstream, alterações locais e divergência remota. Quando possível faz fetch, sem pull, merge ou git init local automático. Falhas de rede deixam a atualidade remota desconhecida.

O acesso direto por File System Access no navegador continua disponível como modalidade limitada: não executa Git nem acompanha mudanças em segundo plano. O workspace anterior permanece no catálogo local; no hosted, sua projeção é arquivada antes de conectar. Importar seu conteúdo exige ação explícita.

## Núcleo compartilhado

`packages/workspace/src/repository/` define contratos de leitor imutável, configuração, tarefa, cobertura, fatos, propostas e análise. Contratos consumidos pelo frontend não importam filesystem. Leitores locais usam índice incremental e Git; o worker usa árvores e blobs GitHub fixados por SHA e cache por conteúdo. Nenhum comando ou script do repositório GitHub é executado.

O inventário respeita exclusões técnicas, arquivos sensíveis e regras Git; pastas sem Git respeitam `.gitignore`. Limites de arquivos, bytes, tamanho de entrada e chamadas de IA são explícitos em `.arch/repository.json`. Arquivos binários, grandes, ilegíveis e limites atingidos aparecem como pendências. A cobertura é parcial: importadores e evidências não demonstram toda a semântica de um programa.

Sem `.arch`, cria manifesto, visão geral, documentação inicial com índice dos documentos encontrados, posições e evidências ancoradas. Com `.arch`, valida antes de escrever e preserva arquivos inválidos para reparo. Importadores Terraform, Kubernetes, OpenAPI, D2, Mermaid, LikeC4 e Structurizr são cadastrados em `sources.json`. A base gerenciada fica em `repository-state.json`, além da base dos importadores em `sync.json`.

A extração determinística agrupa por módulo/responsabilidade, manifestos e imports reconhecidos. BYOK pode refinar fatos existentes com trechos verificáveis. Novas interpretações sem sustentação suficiente viram propostas para revisão; uma referência apenas ao nome do arquivo não valida uma relação. Sem IA ou com falha de provider, a inicialização determinística termina com análise semântica pendente. Respostas são cacheadas por conteúdo/configuração fora do Git; credenciais nunca entram em `.arch`.

## Atualização e conflitos

Eventos de criação, alteração, remoção e troca de branch são agrupados. O índice reutiliza arquivos inalterados; a análise valida novamente a revisão antes de aplicar. A mesclagem preserva IDs, posições, estilos, notas e explicações manuais. Documentos gerados só são substituídos quando ainda correspondem à base gerada; explicações autorais divergentes pedem revisão. Uma mudança sem impacto arquitetural não reescreve o modelo.

Editor, MCP e sincronizador usam gravação por lote com versões esperadas. Filesystem prepara arquivos temporários e mantém journal fora do Git para recuperar interrupções sem sobrescrever edições externas. SQLite aplica o lote em transação. A Cloud mantém uma fila durável de gravações para conectores ausentes e não declara essas alterações gravadas na pasta. Reabrir o conector reutiliza o pareamento salvo; revogar a conexão invalida seu token.

O editor acompanha a revisão da análise por eventos e consulta periódica. Alterações pendentes no editor impedem recarga destrutiva e apresentam revisão externa. Edições estruturais no diagrama são arquitetura desejada: `get_implementation_plan` encaminha sua implementação ao agente; não há reescrita arbitrária da aplicação.

## GitHub e worker

A autorização GitHub começa no editor e fica vinculada à sessão Joinlet existente, inclusive por senha. Não cria nem mescla contas pelo e-mail. Seleciona repositório e branch, preservando o ID do workspace, documentos arquivados e convites.

O worker separado compartilha SQLite com a API. Fila durável tem deduplicação, lease recuperável e uma execução ativa por conexão. Webhooks com HMAC e reconciliação periódica acompanham somente a branch selecionada. Atualiza uma branch de trabalho `strukt/shared-*` e um PR por conexão; publica modelo, posições, documentos e contexto em um lote. Verifica as revisões do código e da Cloud antes de publicar. Incorpora avanços da origem via API GitHub, sem force push; conflito exige revisão.

`analyzedRevision` identifica o SHA analisado e `persistedRevision` o commit publicado. O painel diferencia análise pendente, revisão, conflito, desconexão e publicação/gravação pendente. Consultas MCP com acesso a fontes usam o mesmo diagnóstico; `request_repository_sync` solicita trabalho e devolve o estado/identificador. Sessões legadas sem leitor autorizado continuam declarando essa limitação.

## Distribuição e validação

`bun run build:connector` produz binário da plataforma, `elk-worker.js`, editor web e avisos de licença em `dist/connectors/`; mantenha esses arquivos juntos. `bun scripts/build-connector.ts --all` prepara os demais alvos. O worker inicia com `bun run start:repository-worker`; `deploy/compose.yml` fornece processo separado, volume persistente e sem listener próprio. Credenciais operacionais, pairing, cache, journal e banco ficam fora do Git.

Testes cobrem Git real temporário, leitura incremental, mudanças concorrentes, evidências inventadas, IA controlada, HTTP/SQLite reais, o processo CLI pareado, reinício/revogação e GitHub simulado com commits idempotentes e um PR. O teste de navegador usa backend e Git reais e verifica uma dependência aparecendo no editor sem reconectar. A homologação externa com GitHub e credenciais reais continua sendo uma etapa operacional antes da ativação oficial.

A colaboração projeta edições do editor para o mesmo lote com versões esperadas e informa a fila de publicação/gravação. Salas abertas reconciliam revisões SQLite produzidas por outro processo, permitindo receber resultados do worker. Testes com WebSocket real cobrem ambos os sentidos. A análise incremental persiste hashes de arquivos já analisados e preserva propostas pendentes: no cenário de 1.200 arquivos, uma alteração exigiu uma leitura e uma chamada de IA contendo apenas o arquivo alterado. Arquivos de arquitetura também usam cache por revisão; configurações de provider diferentes invalidam a análise.

## Verificação desta implementação

No checkout de desenvolvimento em 24/10/2026: 4.240 testes passaram com `bun run --sequential --filter '*' test`; tipos, build e verificação do tamanho dos chunks passaram. A execução sequencial evita disputa de CPU nos testes com limites de tempo. Os 12 testes de navegador selecionados passaram, incluindo o backend/Git reais e compatibilidade do fluxo anterior. A medição incremental está no teste de 1.200 arquivos.

O pacote compilado macOS ARM64 passou no processo de conexão real: código para Cloud, HTTP e WebSocket para filesystem, retomada sem novo pairing, revogação e atualização de uma sala por mudança externa no SQLite. O processo separado do worker iniciou e encerrou corretamente. GitHub e OAuth foram simulados; não houve teste com credenciais operacionais reais. Pacotes macOS x64, Linux x64/ARM64 e Windows x64 foram compilados e empacotados, sem comprovação de execução nativa nesses sistemas.

`docker compose config --no-env-resolution --quiet` validou a configuração de exemplo. Cinco arquivos tar.gz têm checksums SHA-256; ficam em `dist/connectors/`, fora do Git. A imagem não foi implantada nesta sessão. A checagem de caminhos e o scan do histórico e das fontes atuais passaram. O scan que inclui bundles gerados também identifica o identificador público já distribuído pelo Excalidraw; sua origem foi conferida na dependência, sem supressão do scanner. Esses scans não demonstram ausência universal de informações pessoais.

`joinlet sync`, `joinlet context` e `joinlet verify --strict` passaram na arquitetura do produto. A cobertura permanece parcial: o próprio checkout tem diagramas autorais e evidências ancoradas, sem fontes importáveis cadastradas; isso não equivale à análise de toda a semântica do código. A homologação externa com um repositório descartável e a ativação oficial permanecem etapas operacionais do responsável pela instalação.

## Inicialização concorrente da instalação

API, worker e colaboração abrem o mesmo SQLite com `busy_timeout=5000` antes de habilitar WAL e executar as migrações. A configuração compartilhada também repete a habilitação de WAL, com espera limitada, quando SQLite retorna BUSY sem chamar o busy handler; isso evita que dois processos iniciando juntos encerrem por uma disputa transitória. O teste de integração `repositoryStartupSmoke.ts` inicia os entrypoints reais da API e do worker simultaneamente em três bancos novos, faz cadastro/login por HTTP, reinicia ambos e confirma que a sessão e o workspace persistiram. Não usa mocks de autenticação, banco ou processos. O teste é parte da suíte remota.

## Colaboração no percurso Cloud com conector

O adaptador hospedado apresenta o rótulo Joinlet Cloud, sem incluir o identificador privado do workspace. O canvas e os documentos reconhecem essa origem e abrem as salas de colaboração autenticadas. Diagramas aguardam o estado inicial da sala antes de aceitar edições; as alterações seguem pelo CRDT e pela outbox do conector. A projeção de arquivos atualiza a sala aberta sem exigir reconexão. Testes de regressão incluem a origem Cloud na proteção contra gravações REST paralelas e verificam a associação da sessão ao armazenamento.

Quando o endpoint de análise informa ausência de provider, o conector mantém a inicialização determinística e apresenta análise semântica pendente, sem confundir esse caso com falha de crédito ou de rede. O teste de integração do processo pareado verifica essa resposta.

Na conferência manual do percurso Cloud → pareamento → pasta em uma instalação local, o conector criou a arquitetura do projeto descartável. Um módulo novo chegou à pasta e ao SQLite hospedado em cerca de 1,5 segundo; sua remoção chegou em cerca de 1,3 segundo e atualizou o canvas aberto sem reconexão. Uma mudança de rótulo feita no navegador chegou ao JSON da pasta e foi desfeita pelo editor. Um comentário no código exigiu uma leitura de fonte e não regravou o modelo. Os arquivos de teste foram restaurados, sem gravações pendentes. Essas medidas são observações do ambiente local, sem promessa de latência geral nem comprovação de implantação oficial ou de análise semântica sem provider.

## Nomes e origem dos documentos gerados

A inicialização nomeia a visão geral e o documento com o nome do workspace: em português, “Visão geral — projeto” e “Arquitetura — projeto”; em inglês, “Overview — project” e “Architecture — project”. O idioma escolhido na conexão é persistido em `repository.json`; trocar o idioma de outro visitante não traduz arquivos compartilhados automaticamente. CLI e conector local usam o idioma do sistema na primeira inicialização. Pareamento e vínculo GitHub transmitem a escolha do editor; códigos de pareamento existentes continuam válidos após a migração do SQLite.

Os identificadores técnicos `repository` e `repository-architecture` permanecem estáveis. Títulos genéricos antigos são atualizados somente quando existe uma base gerenciada e o título ainda corresponde ao gerado. Títulos personalizados são preservados. O documento inicial é uma composição determinística dos primeiros parágrafos de um README reconhecido, dos módulos extraídos e dos caminhos da documentação encontrada. Seu texto explica a geração automática pelo Joinlet e identifica o README usado. A composição não depende de IA. Texto alterado manualmente é preservado para revisão.

## Workspaces, pasta e agentes

Contas Cloud têm catálogo de vários workspaces; cada conexão e tarefa pertence ao workspace escolhido na aba. A autorização GitHub registra o workspace no estado OAuth e retorna a ele sem trocar a identidade da conta. Workspaces existentes, suas revisões e seus convites sobrevivem à migração da restrição anterior de um workspace por dono. A prévia sem conta conserva o limite de um.

Abrir pasta encaminha a seleção para o conector pareado no Cloud ou para o serviço nativo local. Sem conector, a interface apresenta as instruções de conexão; o comando permite seleção pelo mouse e cópia com ícone. A interface não apresenta mais a geração manual de contexto.

A preparação e sincronização mantêm AGENTS.md e CLAUDE.md com um bloco Joinlet que referencia os arquivos atualizados em .arch/context. Texto autoral fora do bloco permanece intacto e marcadores ambíguos exigem revisão. Na publicação GitHub, os dois arquivos entram no mesmo commit do lote. No inventário de arquitetura, essas duas entradas de agentes são excluídas para evitar realimentação do conteúdo gerado. A execução --check não grava esses arquivos. Não são criadas configurações de IDE nem credenciais no Git.

Testes de regressão cobrem migração de banco legado com sessão e convite ativos, criação e seleção por conta, isolamento de escritas e conexões, recusa de troca por convidados, CSRF, autorização GitHub em um segundo workspace e persistência dos dois arquivos de agente. O teste de navegador Cloud usa backend, SQLite, WebSocket e processo CLI reais; os testes da API GitHub usam respostas controladas. A homologação local não comprova implantação no serviço oficial.

O painel de conexão também abre no Overview e em workspaces sem diagramas. Ao iniciar um conector com --dir após parear mais de um projeto, as credenciais são selecionadas pela pasta. Cada conexão tem seu arquivo privado fora do Git; o arquivo legado conserva a última conexão usada. Uma pasta com vários vínculos requer escolha explícita por novo pareamento. Isso evita reutilizar o token do último projeto para sincronizar outra pasta. Pedidos de seleção de pasta são validados pelo workspace ativo e chegam somente ao conector correspondente.

## Organização da visão gerada

A geração diferencia módulos do projeto de bibliotecas importadas. A configuração `repository.json` aceita `view: "auto" | "modules" | "dependencies"`. O padrão automático usa módulos quando o inventário excede 24 componentes ou 60 relações; projetos pequenos continuam mostrando suas dependências diretamente. A visão por módulos agrupa diretórios como apps e packages, usa nomes curtos, tecnologias como legenda e caminhos nos detalhes e remove o rótulo repetitivo imports das ligações. Bibliotecas continuam documentadas em Dependências por módulo e podem ser visualizadas com a opção dependencies. Relações representam imports estáticos, não uma afirmação sobre a topologia de serviços em execução.

Imports de testes, fixtures e configurações de build não criam relações de runtime. Identificadores técnicos permanecem estáveis. Títulos personalizados, notas e alterações autorais seguem a mesclagem de três versões. Cada nível guarda suas posições; ao migrar uma base antiga sem referência confiável de layout, as posições são preservadas e a reorganização fica explícita. Novas vistas de módulos usam uma grade compacta dentro dos grupos.

O documento inicial prefere README na raiz e ignora badges, imagens, cabeçalhos e blocos de código ao selecionar a introdução. Um README de pacote ou extensão não substitui a descrição do produto quando há README na raiz. O contexto ordena as evidências para evitar regravações causadas só pela ordem das chaves JSON.

Diagnósticos --check, get_sync_status e get_implementation_plan não fazem chamadas de IA. Informam a análise pendente; a tarefa de sincronização executa o provider. Uma falha do provider interrompe as chamadas daquele lote, mantendo a preparação determinística e a cobertura parcial. Testes cobrem monorepo com bibliotecas, README concorrente, layouts entre níveis, instruções manuais, idempotência, chamadas de IA e renderização real do editor.

## Reconhecimento de tecnologias e ícones

A varredura determinística reconhece tecnologias pelos manifestos, imports e tipos de arquivo do próprio módulo. O catálogo compartilhado e seguro para navegador mapeia identificadores conhecidos aos ícones existentes do editor. Frameworks como React, Next.js, Vue, Hono e FastAPI têm prioridade sobre a linguagem; módulos TypeScript sem framework usam seu ícone. Entre linguagens, prevalece a quantidade de arquivos de fonte do módulo, para que um script auxiliar não defina a identidade do projeto. A legenda compacta combina tecnologia principal e linguagem; a lista completa fica nos detalhes e no documento. Bibliotecas reconhecidas, como Redis e PostgreSQL, recebem a marca correspondente na vista detalhada. Um cliente de dados não comprova um serviço implantado. Nomes de pastas e menções em README não são evidência de framework; configurações compartilhadas na raiz e dependências de módulos vizinhos não propagam suas tecnologias.

A extração reutiliza os arquivos já inventariados e fatos de importação, sem novas leituras, rede ou execução de código. Imports exclusivos de testes não definem a identidade do módulo. TypeScript e ferramentas de build podem ser reconhecidos em devDependencies, mas um React declarado apenas como dependência de testes não muda o ícone de uma API. Caminhos convencionais apps, packages e services distinguem módulos sem package.json, inclusive código Python. O documento gerado registra tecnologias, tecnologia principal e referências verificáveis.

Com provider configurado, a mesma chamada que interpreta responsabilidades recebe as tecnologias e evidências detectadas. A resposta pode refinar o rótulo e selecionar primaryTechnology entre as tecnologias já comprovadas daquele módulo, citando uma referência correspondente. A enumeração do contrato restringe os identificadores; o motor rejeita seleções inventadas ou apoiadas apenas no código de outro módulo. Não são aceitos SVGs ou ícones arbitrários vindos da IA. Inferências de novos componentes e relações continuam como propostas. A seleção é persistida e revalidada após reinício ou alteração de fontes, sem chamadas adicionais de IA apenas para ícones.

Ícones e tecnologias alterados manualmente são preservados pela mesma mesclagem de três versões usada nos demais campos. Testes cobrem isolamento de tecnologias por módulo, React/Next/TypeScript, APIs, bibliotecas, referências falsas, cache após reinício e atualização incremental com uma leitura. A verificação de ícones garante que todas as marcas reconhecidas estão no subconjunto distribuído, sem carregar o catálogo inteiro. O teste de navegador usa Git e backend reais e confere o SVG de React e a legenda TypeScript no canvas.

## Documentação existente, navegação e aprofundamento

A preparação importa os Markdown elegíveis (.md, .markdown e .mdx) respeitando Gitignore, exclusões, orçamento de inventário e os limites técnicos do workspace. AGENTS.md e CLAUDE.md gerenciados na raiz permanecem instruções do agente, fora da importação para evitar realimentação. Os documentos entram em pastas Repositório/Repository segundo o caminho de origem, dentro da profundidade suportada. ItemEntry.source é um caminho relativo opcional e portável, preservado no manifesto e na exportação. O corpo indica a origem e é uma projeção: editar a projeção não substitui o Markdown original. MDX é texto, nunca executado.

repository-state.json.knowledge mantém caminho → slug, hashes de base e metadados gerados. O estado não duplica todo o texto Markdown. Mudanças de fonte atualizam projeções não editadas; textos, títulos, pastas e exclusões manuais são preservados. Renomeações inequívocas por conteúdo mantêm slugs. Fontes indisponíveis conservam a projeção e geram pendência; conflitos não viram sincronização completa. Diagramas gerados e o documento inicial ficam em Arquitetura/Architecture; pastas autorais e movimentos posteriores, inclusive para a raiz, são respeitados.

O Overview conecta diagramas aos documentos apontados em link:doc, vistas apontadas em link:diagram, o par visão geral/documento gerado e os vínculos Markdown resolvidos entre arquivos conhecidos. README do módulo é ligado ao seu componente quando encontrado; links manuais do componente têm prioridade na mesclagem. Nomes parecidos ou referências dentro de blocos de código não criam relações. Conexões derivadas possuem base própria; rótulos manuais e conexões removidas pela pessoa são preservados. Posições de cards permanecem intactas.

O filtro do Overview permite Todos os itens, Visão principal, Sem pasta ou uma pasta com subpastas. A visão principal mantém os itens autorais e documentos de fonte referenciados diretamente por diagramas. Com mais de doze projeções, ela é selecionada inicialmente para evitar lotar o quadro; todos os documentos continuam disponíveis no catálogo e nos demais filtros. A filtragem é uma leitura, não exclui cards nem relações. Quadros com mais de oitenta cards renderizam apenas a região visível.

Após persistir a revisão analisada, em um estado estável e sem gravações pendentes, o Overview avisa sobre o aprofundamento. Pendências continuam identificadas; preparação inicial não é análise semântica completa. A pessoa pode configurar IA, iniciar análise no Joinlet ou copiar uma tarefa para o agente local e configurar MCP. O aviso e o encaminhamento funcionam em português e inglês e não presumem qual cliente de agente existe no computador.

Na IA do Joinlet, a ação prepara um snapshot autorizado com revisão e identidade das regras de inclusão/exclusão: no máximo oitenta leituras, arquivos de até sessenta mil caracteres e cem mil caracteres serializados de fontes. O inventário total, fontes omitidas e arquivos ilegíveis ficam explícitos. O chat recebe as fontes reais junto dos diagramas e documentos e usa suas ferramentas existentes de organização e criação por lote; refinamentos de itens existentes usam o item aberto. Não é um agente ilimitado com leitura de toda a codebase em uma chamada. Contexto de fonte permanece em memória, restrito ao workspace e conversa; abrir outra conversa o remove. Revisão e política são conferidas antes de chamar o modelo e antes de aplicar uma resposta. Respostas tardias de revisões anteriores são recusadas.

Para agentes com MCP, get_repository_analysis_plan oferece encaminhamento, revisão, índice paginado e fontes dos documentos. list_repository_files e read_repository_file permitem percorrer código e Markdown autorizado por páginas, sem IA e respeitando as regras compartilhadas. organize_workspace cria/move pastas e itens sem mudar slugs; get_overview e connect_overview permitem ler e conectar os cards existentes. Cada escrita usa o coordenador/CAS do workspace e atualiza o contexto. O conector encaminha leitura e inventário por sua conexão autenticada de saída; a página Cloud não acessa filesystem ou localhost privilegiado diretamente. No GitHub, snapshots permanecem fixados em SHA; a checagem posterior da revisão consulta somente a referência da branch, sem nova leitura de todos os blobs.

Testes cobrem importação e idempotência, edição incremental de um Markdown com uma leitura, conflitos autorais, renomeações e fontes removidas, conexões explícitas e referências em código, filtros sem perda de conteúdo, exclusões e paginação de fontes, política de acesso e limites, MCP local e pareado. O navegador usa Git e backend reais e provider controlado para criar documentação e diagramas, recusar edição tardia e verificar isolamento entre conversas. A integração pareada testa API de contexto e inventário/leitura MCP com processo CLI real; esses testes não comprovam qualidade semântica de um provider real nem implantação oficial.
