> Joinlet · Fonte: `docs/workspace-settings.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Configurações do workspace

O menu do workspace abre **Workspace settings** (Configurações do workspace), também disponível na seção Workspace das configurações gerais. O usuário edita nome, descrição e logo com prévia, salva explicitamente ou descarta o rascunho. A descrição tem até 1000 caracteres e o nome até 100. Sessões somente leitura desabilitam as alterações.

A logo aceita PNG, JPEG e WebP até 2 MB. O navegador decodifica e redimensiona a imagem para 256 × 256, preservando a proporção e a transparência. O manifesto armazena um data URL raster de até 350000 caracteres; URLs externas e SVG não são aceitos. A logo aparece no seletor do workspace e na lista de projetos. Remover a logo restaura a inicial do nome.

`Manifest` recebe os campos opcionais `description` e `logo` em `.arch/strukt.json`. O formato e os nomes legados permanecem compatíveis. Importação, exportação, pastas e workspaces do navegador usam o mesmo manifesto. O catálogo IndexedDB mantém apenas uma cópia da logo e do nome para apresentar projetos fechados; o manifesto continua sendo a fonte dos dados. O merge colaborativo considera nome, descrição e logo independentemente, inclusive remoção explícita da logo.

`workspace.setDetails` valida os dados, respeita o bloqueio de edição e agenda a gravação do manifesto. A interface aguarda o saver e informa falhas em vez de confirmar um salvamento pendente. Ao mudar de workspace, o formulário descarta o rascunho anterior. Alterações externas de identidade impedem que um formulário antigo sobrescreva os novos dados.

Inglês é o idioma padrão da landing e do app, inclusive quando o armazenamento está indisponível. Uma escolha explícita de português continua válida; `?lang=en` e `?lang=pt-BR` têm prioridade. Os textos do formulário existem nos dois idiomas e os conteúdos do usuário não são traduzidos.
