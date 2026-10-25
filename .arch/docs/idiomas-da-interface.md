> Joinlet · Fonte: `docs/idiomas.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Idiomas da interface

Joinlet oferece inglês (`en`, padrão) e português brasileiro (`pt-BR`). “Overview” é o nome da área que reúne diagramas, documentos e notas nos dois idiomas. As rotas, o tipo interno `board`, arquivos `.strukt.json`, namespaces `@strukt/*` e chaves legadas continuam compatíveis.

O seletor está no cabeçalho da landing, na barra lateral do app e em Configurações → Geral. A preferência é salva em `joinlet:locale`. Na ausência de uma escolha válida, o padrão é inglês, inclusive quando o armazenamento está indisponível; uma escolha explícita de português é preservada. A URL aceita `?lang=en` ou `?lang=pt-BR` para abrir uma prévia específica. A troca sincroniza o código e os sketches, interrompe a resposta corrente preservando a conversa, grava o workspace e recarrega os módulos no novo idioma. Código inválido bloqueia a troca e informa o motivo.

`apps/web/src/i18n/index.ts` fornece `uiText`, `getLocale` e `systemMessage`. O catálogo inglês está em `en.json`; a chave é o texto original em português. Interpolações usam `{0}`, `{1}` etc. Não concatenar frases para traduzi-las. `systemMessage` é reservado a mensagens do aplicativo e do servidor local: também reconhece formatos já interpolados presentes no catálogo.

Nunca passar texto escrito pelo usuário, nomes de itens, conteúdo dos documentos ou respostas da IA pelo tradutor. Os adaptadores de templates, componentes, assistentes e perspectivas traduzem apenas recursos nativos; itens salvos pelo usuário são preservados. O chat envia a preferência de resposta em inglês no contexto quando essa opção está ativa. As regras locais do compositor aceitam instruções em português e inglês.

Datas e números seguem a preferência. Excalidraw recebe `langCode`; CodeMirror recebe as frases de interface para português. `html.lang` e os nomes acessíveis dos controles acompanham o idioma.

Validação: catálogo com paridade de argumentos, idioma padrão, mensagens dinâmicas, espera de gravação e falhas antes de navegar; testes no navegador da landing, editor, configurações, chat, templates, persistência do workspace e telas de 320/390 px.
