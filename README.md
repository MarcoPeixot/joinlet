# Joinlet

Nome e domínio oficiais: **Joinlet · [joinlet.co](https://joinlet.co)**. O projeto anteriormente se chamava Strukt; todos os seus recursos passam a fazer parte do Joinlet.

Compatibilidade: os pacotes internos `@strukt/*`, arquivos `.strukt.json`, variáveis `STRUKT_*`, configurações MCP e dados locais mantêm seus identificadores para preservar workspaces e integrações existentes. Os comandos `joinlet` e `joinlet-mcp` também aceitam os aliases legados `strukt` e `strukt-mcp`. A configuração de DNS e a publicação no domínio são etapas de infraestrutura separadas.

**A arquitetura que seus agentes leem antes de escrever código.** Desenhe a arquitetura do sistema num canvas limpo e
expressivo; o Joinlet guarda tudo como texto versionável em `.arch/`, dentro do repositório (diagramas em JSON, posições
num arquivo à parte), e gera o contexto que agentes de código leem (`ARCHITECTURE.md`, `llms.txt`).

## Código aberto e hospedagem

O código original do Joinlet usa **AGPL-3.0-only**. O produto completo é aberto: editor, servidores, CLI, MCP e extensão. Use suas próprias credenciais e infraestrutura, sem cotas comerciais de workspaces, diagramas ou participantes. O Joinlet Cloud será a opção de operação gerenciada; sua política atual é Beta e assinaturas pagas ainda não estão implementadas. Veja [licença](LICENSE), [contribuições](CONTRIBUTING.md), [segurança](SECURITY.md), [marca](TRADEMARKS.md) e [limites de publicação](docs/open-source.md). Dados, segredos e materiais operacionais privados não fazem parte deste repositório.

## Documentação

A central completa fica em `/docs/` (inglês por padrão) e `/docs/pt-BR/`, com 25 guias em cada idioma, busca local, referência de comandos e schemas MCP. Em desenvolvimento: [abrir documentação](http://localhost:5178/docs/). O build inclui as páginas estáticas em `apps/web/dist/docs/`; é preciso publicá-lo para disponibilizá-las no domínio.

O conteúdo fica em `apps/web/docs/content.json`. Referências editoriais: [Eraser](https://docs.eraser.io/), [draw.io](https://www.drawio.com/docs/), [Structurizr](https://docs.structurizr.com/) e [Excalidraw](https://docs.excalidraw.com/). Os recursos documentados são verificados no código do Joinlet. As ilustrações do Jo são estáticas na landing e no chat.

## Recursos
- **Editor visual**: nós com 12 formas, grupos aninhados, conexões com 6 tipos de seta e rótulo, ícones (genéricos,
  marcas, AWS/GCP/Azure) com um seletor por categorias e busca no Inspector, estilos pastel/forte/contorno,
  sombra/liso/aquarela, fontes à mão/limpa/mono, snapping, undo/redo, atalhos (⌘K comandos, ⌘→ cria um nó conectado)
  e export SVG/PNG, além de copiar como Mermaid ou PlantUML (menu Exportar, ⌘K e `joinlet export <slug> --format mermaid|plantuml`).
  Excluir um diagrama, documento ou sketch oferece "Desfazer" por 8 s. Diagramas de centenas de nós abrem sem travar:
  o roteamento das conexões roda num Web Worker (acima de 300 conexões usa o roteador ortogonal).
- **Animar fluxo**: pulsos percorrem as conexões do diagrama e do Overview (toolbar + ⌘K), preferência do visitante,
  pausada sozinha quando o sistema pede menos movimento.
- **Fluxos guiados e drill-down**: o painel Fluxos cria cenários com mensagens, processos, escolhas, caminhos paralelos,
  saltos para outros fluxos e notas, reproduzindo cada etapa no canvas;
  um nó pode abrir um diagrama detalhado pelo campo "Detalhar em". Passos quebrados continuam visíveis para revisão.
- **Modo apresentação**: `P` (ou ⌘K › "Modo apresentação", ou o botão Apresentar) esconde o chrome e percorre o diagrama passo a passo, com a câmera enquadrando cada passo e o resto esmaecido: um passo por etapa dos fluxos guiados quando existem, senão visão geral + um passo por grupo. `←`/`→`/`Espaço` navegam, `Home`/`End` pulam, `Esc` (ou `P`) sai. O diagrama fica somente leitura enquanto apresenta; não abre com rascunho da IA, comparação de versão ou pedido de IA em andamento.
- **Biblioteca e modelos**: 1.712 ícones oficiais AWS/Azure/GCP, 1.648 presets cloud e 15 templates editáveis (incluindo Kubernetes/ArgoCD, bancos, sequência e processos). Crie componentes próprios na Biblioteca ou salve o diagrama como template pelo menu Modelos; a biblioteca acompanha o workspace em `library.json`. Tabelas têm campos PK/FK e cardinalidades; sequência tem participantes, lifelines e mensagens ordenadas.
- **Primeiros passos**: checklist de onboarding e um tour curto (iniciado sob demanda).
- **Tema e acessibilidade**: tema automático (segue o sistema), claro, escuro ou alto contraste, mais cores de destaque
  (Configurações › Geral), com contraste AA auditado por teste; um único painel à direita por vez (Versões, Fluxos,
  Modelo, Precisão, GitHub) e, no celular, painéis em folha inferior.
- **Código ↔ canvas**: painel "Código" com o JSON do diagrama (lint e autocomplete pelo schema); editar o texto nunca
  perde posições (renomear no texto preserva a posição); colar a DSL da Eraser oferece conversão; exportar JSON ou DSL;
  "Reorganizar" com ELK e roteamento ortogonal das conexões.
- **IA por operações** (⌘J): "Editar diagrama" e "Gerar do zero", com modelos escolhidos nas configurações, propõem operações
  que aparecem no canvas como diff (verde entra, vermelho sai, âmbar muda) até você aplicar — um passo de undo. Sem
  chave, regras locais em pt-BR ("modo offline"). "Gerar documentação" escreve um documento de arquitetura em Markdown.
- **Projetos**: cada workspace é um projeto independente. No menu da sidebar, “Meus projetos” lista e busca os
  destinos conhecidos; “Novo workspace” cria um projeto vazio no navegador, e o seletor abre os recentes. O projeto
  atual e seus arquivos antigos são preservados; os novos usam armazenamento isolado. Pastas e repositórios entram
  na lista quando conectados. A troca exige salvar as alterações e mantém o contexto do GitHub no projeto correto.
  O catálogo fica neste navegador; sessões remotas/LAN continuam vinculadas ao projeto autorizado pelo convite.
- **Workspace**: vários diagramas, documentos Markdown ligados a nós (`link: "doc:<slug>"`), sketches (Excalidraw) e o
  Overview com cards de tudo; salvo numa pasta do seu repositório (`<pasta>/.arch`, Chrome/Edge) ou no navegador
  (IndexedDB), com export/import `.zip`. Quando um agente regrava a pasta, o app avisa ("mudou no disco") e oferece
  recarregar — descartando escritas pendentes para não sobrescrever o agente.
- **Pastas**: diagramas, documentos e sketches podem ficar em pastas aninhadas na sidebar (até 4 níveis): criar pela seção, mover pelo botão de pasta do item ou arrastando, renomear, excluir (o conteúdo sobe um nível). A pasta é só um caminho no manifesto (`folder` no item, `folders` para pastas vazias); os arquivos de `.arch/` continuam planos.
- **Compartilhar**: o botão "Compartilhar workspace" da barra gera, a partir do app, dois links da sua rede local — um para editar junto e um **só para ver** (o host recusa qualquer edição desse link) — mostra quem está online agora (avatares e lista) e para quando você quiser.
- **Acesso e convites**: convites nomeados com papel (editar, comentar, só ver), validade e revogação imediata, auditoria sem conteúdo e acesso público opcional por túnel `cloudflared` (opt-in, com prazo).
- **Comentários e menções** em nós, conexões, canvas e trechos de documento, ao vivo entre colaboradores; o papel "comentar" só escreve comentários.
- **Perspectivas e níveis C4**: visões nomeadas do mesmo diagrama (por tag, nível ou nós), sem alterar o modelo; viram páginas do site estático.
- **Linha do tempo**: versões marcadas como atual/transição/planejado, régua cronológica e diff até o estado-meta (`joinlet diff --stage`).
- **Sync por PR** (`joinlet sync`) mantém o diagrama em dia com Terraform, Kubernetes, OpenAPI e outros arquivos do repositório, inclusive por GitHub Action; **nuvem viva** (`joinlet import cloud`, `joinlet check --cloud`) importa e compara AWS/Azure/GCP pelo CLI do próprio usuário, só leitura.
- **Integrações**: webhooks (Slack, Teams, Discord), publicação no Notion e Confluence e tarefa no Jira a partir de uma pendência. Extensão do VS Code em `apps/vscode`. Providers de IA: Anthropic, OpenRouter e qualquer API compatível com OpenAI (inclui Ollama local).
- **Chat com a IA**: painel lateral ao lado de Configurações para tirar dúvidas e conversar sobre diagramas, documentos e decisões; a IA usa o item aberto como contexto e pode criar ou editar diagramas, documentos, sketches e a organização do workspace. As alterações são validadas contra o estado capturado; confira o resultado e a opção de desfazer. A resposta aparece enquanto é escrita (dá para parar) e as conversas ficam salvas no navegador, por workspace.
- **Presença ao vivo**: em sessões compartilhadas (rede local ou serviço remoto) cada pessoa tem nome e cor; a barra mostra os avatares de quem está na sala, o documento mostra o cursor e a seleção dos outros com o nome (posições relativas do Yjs, que acompanham edições concorrentes) e o diagrama mostra o ponteiro e o contorno dos nós que outra pessoa selecionou. O host valida tudo que um convidado anuncia (`sanitizePresence`).
- **Overview**: ao selecionar um card de diagrama, documento ou sketch aparece "Abrir", que leva ao item. Conexões ortogonais entre cards, com rótulo em pílula (duplo clique edita) e segmento do meio arrastável.
- **Versões** (⌘S): salve versões de cada diagrama com uma descrição; aceitar uma proposta da IA também cria uma.
  Compare uma versão com o diagrama atual no próprio canvas (e numa lista de mudanças) e restaure-a num passo de undo.
- **Contexto para agentes**: "Gerar contexto para agentes" grava `.arch/context/ARCHITECTURE.md`, `llms.txt` e um
  arquivo por diagrama, e os mantém atualizados a cada mudança; um trecho pronto para o `AGENTS.md` manda o agente ler
  a arquitetura antes de escrever código.
- **Evidência e visões compartilhadas**: nós e conexões podem apontar para arquivos e linhas do repositório; `joinlet check`
  detecta referências ausentes e `joinlet check --drift` compara as linhas e trechos (`snippet`, uma impressão do código
  gravada com a referência) com os arquivos: linha inexistente, trecho movido (sugere a nova linha) ou reescrito, como
  avisos (`--strict` falha). `joinlet evidence snap` grava esses `snippet`s; o painel Precisão ainda não mostra a deriva, use a CLI. Componentes e conexões de diagramas diferentes podem ser ligados às mesmas entidades e
  relações. O painel Modelo reúne todas as visões e dependências; tags `grupo:valor` destacam perspectivas sem criar
  outro diagrama. O painel Precisão reúne referências quebradas e apontamentos da equipe.
- **Importação**: o painel Código importa arquivos ou converte texto de Mermaid flowchart, LikeC4, Structurizr DSL, D2,
  Terraform (`.tf`), OpenAPI (JSON/YAML) e manifestos Kubernetes (YAML multi-documento), com detecção automática
  (subconjuntos de componentes, grupos e conexões; construções ignoradas e entradas acima de 2 MB são avisadas).
- **Agentes (MCP + CLI)**: o servidor MCP (`apps/mcp`) deixa Claude Code/Cursor lerem a arquitetura (inclui `search_model`),
  mapearem um repositório (prompt `map_repository`) e criarem diagramas, documentos, versões, evidências (`add_evidence`)
  e contexto direto no `.arch/` (mesmo schema de operações da IA); o binário `strukt`
  (`apps/cli`) valida, gera contexto, exporta (`export`), gera o site (`site`), grava `snippet`s (`evidence snap`) e faz o diff semântico entre refs (com `--svg` para o diff visual) — instalação e referência em
  [`docs/agents.md`](docs/agents.md).
- **GitHub**: painel no app mostra as mudanças pendentes no `.arch/` (selo na barra de cima), o diff semântico e
  compara uma ref do Git no canvas e publica o PR sem sair do Joinlet; entre com a conta GitHub pelo Device Flow e conecte a pasta local do repositório.
  O MCP remoto (`apps/remote`) permite ao agente abrir o login no navegador, escolher um repositório e criar diagramas
  sem servidor local; alterações seguem para uma branch e um PR. `publish` (MCP/CLI local) cria branch + commit + PR
  com o diff semântico no corpo; na CI, o workflow
  [`templates/github/strukt.yml`](templates/github/strukt.yml) valida o workspace, comenta/atualiza esse diff no PR e publica o diff visual (`joinlet diff --svg`, antes/depois em SVG) como artefato.

## Site estático
`joinlet site --out strukt-site` (`apps/cli`) transforma o `.arch/` num site de HTML puro para publicar (GitHub Pages, artefato de CI ou
qualquer servidor de arquivos): página inicial, uma página por diagrama (SVG embutido, componentes e conexões) e uma por documento
(Markdown mínimo e seguro, links `doc:` viram links relativos). Sem JavaScript, sem fontes/CDN e com CSP restritiva; a saída é
determinística. A pasta de saída ganha o marcador `.strukt-site` (lista dos arquivos gerados): `joinlet site --out` recusa uma pasta
não vazia sem esse marcador, e só apaga arquivos que ele mesmo listou. Sites gerados por versões anteriores não têm o marcador: esvazie a
pasta uma vez. Detalhes em [`docs/agents.md`](docs/agents.md).

## Rodar
```bash
bun install
cp apps/server/.env.example apps/server/.env   # opcional: ANTHROPIC_API_KEY=… liga a IA
bun run dev                                    # landing em http://localhost:5178 + servidor em http://localhost:8787
```
- A página inicial apresenta o produto e uma demonstração interativa local. O editor abre em
  `http://localhost:5178/app/`; no build, as duas entradas ficam em `dist/index.html` e `dist/app/index.html`.
  Hosts remoto e LAN servem o editor em `/app/`, e os convites de colaboração levam diretamente a ele.
- Conecte Anthropic, OpenRouter, OpenCode Go/Zen, Google Gemini, DeepSeek, Groq ou Mistral AI em Configurações › IA e providers. Cada conexão mantém sua chave e modelos separados. OpenAI, Ollama e LM Studio usam a conexão compatível com OpenAI. As chaves ficam só no servidor; o navegador fala com ele pelo proxy
  `/api` do Vite. Sem chave (ou sem servidor), o painel IA usa as regras locais.
- Para o login GitHub direto, registre um [OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), ative Device Flow e configure o Client ID em `STRUKT_GITHUB_CLIENT_ID` no `apps/server/.env`. O Device Flow não usa Client Secret; o token fica em `~/.config/strukt/github-auth.json` com permissão `0600`.
- Só o servidor: `bun run dev:server` (porta `PORT`, padrão 8787).
- MCP remoto: configure uma GitHub App e as variáveis de [`apps/remote/.env.example`](apps/remote/.env.example), rode `bun run build` e `bun run start:remote` atrás de HTTPS. O agente usa `https://<seu-domínio>/mcp` e escolhe o repositório durante a autorização. [Passos completos](docs/agents.md).
- Preparação do deploy: Bun 1.4.3, `bun run test:remote-smoke`, `/ready` e `bun run backup:remote <banco> <novo-snapshot>`. A CI verifica testes, dependências e container. O backend hospedado oferece login web, workspace Cloud, BYOK pessoal e links com permissões; consulte o guia de hospedagem em `/docs/pt-BR/deployment/`.
- **Compartilhar por link:** no editor, abra **Compartilhar workspace → Liberar link de colaboração → Copiar link**. O dono entra na mesma sessão e os convidados abrem o link para editar sem cadastro. **Qualquer lugar** usa cloudflared (macOS: `brew install cloudflared`) por até 24 horas; **Mesma rede** usa o endereço LAN. Mantenha servidor e computador ligados. Workspaces do navegador ou de pastas abertas viram uma cópia de trabalho persistente em `~/.config/strukt/shared-workspaces/`, preservando o original. Repositórios conectados usam a própria `.arch/`. Parar de compartilhar salva o estado e mantém o workspace. Permissões, validade, revogação e atividade ficam nas opções avançadas. Esse fluxo local não publica automaticamente salas permanentes em `joinlet.co`.
- Colaboração na rede local: após `bun run build`, rode `STRUKT_COLLAB_ROOT=/caminho/do/repo bun run start:collab` e abra o convite impresso no terminal em cada máquina. O host serve apenas o workspace compartilhado; as rotas locais de IA, Git e MCP não ficam acessíveis aos convidados. O botão de link na barra superior copia o convite. Configure `STRUKT_COLLAB_PUBLIC_URL` se o IP detectado não for o endereço usado pelos convidados. Numa sessão compartilhada o id de cada elemento é a chave de mescla da sala: renomear pelo canvas, pelo Inspetor ou pelas regras offline da IA muda só o rótulo. Editar o texto no painel Código, restaurar uma versão ou aplicar uma proposta da IA que renomeie elementos ainda troca ids; evite essas ações com outras pessoas editando o mesmo diagrama.
- No serviço remoto, pessoas autorizadas no mesmo repositório coeditam documentos Markdown e diagramas pelo WebSocket do mesmo domínio. O estado é persistido em SQLite e projetado para a branch compartilhada `strukt/shared`; o proxy HTTPS precisa encaminhar `Upgrade: websocket`. Mantenha `STRUKT_REMOTE_DB` em volume persistente.
- Verificação: `bun run typecheck` · `bun run build` · `bun run test` (rode depois do build: `apps/web/src/bundle.test.ts` confere o teto de 1,3 MB do JS inicial) · `bun run e2e` (Playwright, Chromium).
- O seletor de pasta para escrita direta exige um navegador com File System Access API; nos demais, o workspace começa no IndexedDB.
- Para vincular um repositório em Safari, Firefox ou Brave, informe o caminho dele no painel GitHub. O servidor local cria `.arch/` após sua confirmação, sem usar o seletor de pastas do navegador.

## Formato `.arch/`
```
.arch/
├─ strukt.json                        manifesto { version, name, diagrams[], docs[], sketches[], folders? }; cada item pode ter `folder` ("Backend/Dados")
├─ strukt.schema.json                 JSON Schema dos diagramas (validado por editores externos)
├─ diagrams/<slug>.strukt.json        JSON do diagrama (nós, grupos, conexões, estilo)
├─ diagrams/<slug>.layout.json        posições { version, nodes }, separadas do significado
├─ diagrams/<slug>.flows.json         fluxos guiados e notas por passo (quando houver)
├─ evidence.json                      referências { path, line?, contains?, snippet? } a arquivos/linhas do repositório (quando houver)
├─ model.json                         entidades compartilhadas e vínculos com diagramas (quando houver)
├─ concerns.json                      apontamentos de precisão abertos/resolvidos (quando houver)
├─ docs/<slug>.md                     documentos Markdown
├─ sketches/<slug>.excalidraw         sketches (formato do Excalidraw)
├─ board.json                         Overview: cards, notas, seções e conexões
├─ versions/<slug>/<data>-<id>.json   versões { id, createdAt, message, author, json, layout, flows? }
├─ versions/<slug>/index.json         cache derivado da lista de versões (pode apagar; reconstruído sozinho)
└─ context/                           gerado para agentes: ARCHITECTURE.md, llms.txt, diagrams/<slug>.md
```
JSON com 2 espaços, sem valores padrão e com ordem de chaves fixa (diffs limpos); mover nós só muda o `.layout.json`.
Um `.arch/diagrams/<slug>.strukt` antigo é convertido para `.strukt.json` na primeira abertura (o original vira
`.strukt.bak`). Commite `.arch/` junto com o código do sistema.

## Estrutura
`packages/core` (modelo, operações, diff semântico), `packages/json` (formato JSON do diagrama), `packages/dsl` (parser
e printer da DSL da Eraser; subpaths `./lite`, `./import` com os importadores e `./export` com Mermaid/PlantUML, carregados sob demanda), `packages/ops` (schema/validação das operações da IA, compartilhado com
agentes), `packages/git` (runner de git/gh, diff entre refs e publish de PR), `packages/layout` (ELK e roteador), `packages/workspace` (formato `.arch/`, versões, evidência, contexto para agentes; `./zip` e `./collaboration` sob demanda),
`apps/web` (o app, React 19), `apps/server` (proxy de IA, Hono em Bun), `apps/remote` (MCP OAuth e GitHub), `apps/cli` (binário `strukt`: `check`, `context`, `diff`, `list`, `export`, `site`, `evidence`, `publish`, `pr-comment`) e `apps/mcp`
(servidor MCP para agentes). Pesquisa, design e planos em `docs/`; avisos de terceiros em `THIRD_PARTY_NOTICES.md`.

### Joinlet Beta

O beta é gratuito: **1 workspace próprio**, **20 diagramas por workspace** e **5 pessoas simultâneas**, incluindo o dono. Editor, documentos, exportação e versões estão incluídos; IA usa a chave do usuário. Consulte **Configurações → Plano e uso** e o guia `/docs/pt-BR/beta/` (inglês: `/docs/en/beta/`).

A política fica em `packages/workspace/src/beta.ts`. O serviço remoto registra propriedade pelo ID GitHub verificado em SQLite; convidados/membros não gastam cota própria. No editor local sem conta, a cota de workspaces é por navegador/origem. Projetos legados são preservados. A admissão de colaboração é por processo: durante o beta, hospede cada workspace em uma instância; múltiplas réplicas exigem admissão compartilhada.


Para testes administrativos, configure `JOINLET_ADMIN_GITHUB_IDS` no serviço remoto com IDs GitHub numéricos verificados (lista vazia por padrão). `JOINLET_LOCAL_ADMIN=1` libera apenas a instalação local: API/editor, CLI, MCP e host de colaboração. Administradores podem ter vários workspaces, sem cotas de diagramas/participantes nos seus workspaces. Convidados mantêm a própria cota e as permissões do convite. Reinicie o serviço e confira **Plano e uso**. `.env` é privado; para produção, configure as variáveis no serviço publicado. Detalhes e revogação no guia Beta.


### Verificação entre código e conhecimento

`bun run verify:knowledge` executa `joinlet verify --strict`: valida schema, evidências ancoradas, fontes configuradas e contexto; ausência de cobertura e divergências estruturais exigem revisão. `get_implementation_plan` no MCP local e o prompt `reconcile_codebase` orientam o agente nos dois sentidos. A implementação de código e a atualização de documentos autorais continuam sendo trabalho explícito do agente/equipe. O Joinlet sincroniza os formatos de fonte suportados e mantém o contexto gerado, inclusive após edições colaborativas. `context --check` agora falha também quando o contexto nunca foi gerado. Consulte `docs/agents.md`.

### Beta hospedado

O backend remoto inclui login direto com GitHub, um workspace Cloud persistente por conta, BYOK pessoal criptografado e links de colaboração com edição/comentário/visualização e revogação. O modo GitHub/MCP continua disponível para workspaces em repositórios; arquivos Cloud não são automaticamente espelhados na codebase.

O modelo de produção fica em `deploy/compose.yml`, com Caddy, volume persistente e uma réplica. Preencha `deploy/.env.production` a partir do exemplo antes de subir; consulte `/docs/pt-BR/cloud/` e `/docs/pt-BR/deployment/`. O script `scripts/backup-deploy.sh` exige um destino privado explícito para a cópia verificada do SQLite.

### Site e aplicativo em endereços separados

O deploy remoto mantém a landing e os guias em `https://joinlet.co` e abre o app diretamente em `https://app.joinlet.co`. API, login, colaboração e MCP usam o host do app. O desenvolvimento local continua em `/` e `/app/`. Veja [a configuração e a migração](deploy/README.md).
