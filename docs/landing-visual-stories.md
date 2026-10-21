# Joinlet — demonstrações visuais

A landing apresenta os benefícios antes dos comandos. Os quatro cartões de recursos incluem cenas de modelagem, discussão no componente, documento vinculado e seleção de componentes. São ilustrações de interface, não atividade de pessoas reais. A seleção de componentes responde a clique e teclado.

O detalhe expansível de repositório mostra o exemplo de Notificações conectado ao Kafka, com etapas de visualização, revisão do impacto e arquivos que acompanham a mudança. Diagrama, layout e contexto continuam derivados do mesmo exemplo usado no workspace da landing. O diff e a árvore de arquivos ficam em um painel expansível. A aplicação explícita da proposta atualiza o estado compartilhado da página; o download exporta o diagrama nesse estado. Nenhum repositório externo é alterado pela demonstração.

O detalhe expansível de agentes mostra o pedido, a leitura das dependências e a proposta revisável. O caminho Pedidos → Kafka → Pagamentos vem do exemplo; Notificações aparece na proposta. Comandos MCP, instruções de AGENTS.md, checagem da CI e o contexto gerado permanecem acessíveis em painéis expansíveis. A antiga transcrição de terminal deixa de ser o conteúdo principal.

As narrativas avançam uma vez ao entrar em vista, com controles para pausar, reproduzir e selecionar etapas. A reprodução nunca aplica uma proposta. Preferência de movimento reduzido impede reprodução automática e remove transições; as etapas continuam selecionáveis. Layouts são adaptados a 320 px e temas claro/escuro. Textos novos têm versões en e pt-BR.

No app, os dois canvases ocultam a atribuição visual usando a opção do React Flow. O Overview usa um renderizador de minimapa com posições, títulos, conexões e miniaturas dos diagramas e sketches reais; documentos mostram o início do conteúdo. O minimapa do diagrama continua usando o mesmo SVG do export, com ícones, cores e conexões. Os pontos do canvas usam opacidade 0,20 no escuro e 0,16 no claro para melhorar a orientação espacial.

O minimapa do Overview enquadra o conteúdo com escala estável: mover a área visível não encolhe as miniaturas. Arraste, setas do teclado e rolagem controlam a navegação e o zoom.

A página concentra a experiência em uma demonstração principal no hero. Git e MCP são aprofundamentos recolhidos inicialmente; seus links de navegação abrem o detalhe. Abrir este exemplo cria um workspace independente com o estado aprovado da demonstração. O rodapé do Overview se adapta à largura do canvas para manter contador e zoom separados.
