> Joinlet · Fonte: `apps/vscode/README.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Joinlet para VS Code

Valida, compara e abre a arquitetura do Joinlet (`.arch/`) sem sair do editor.

- **Validação e autocompletar** em `*.strukt.json` pelo schema do Joinlet, mais diagnósticos do parser do Joinlet (mensagens em pt-BR) enquanto você digita.
- **Joinlet: Validar workspace** roda `joinlet check --json` e mostra os problemas no painel Problemas.
- **Joinlet: Diff contra HEAD** mostra o diff semântico (`joinlet diff --markdown`) numa visualização Markdown.
- **Joinlet: Abrir no Joinlet** abre o app (`strukt.appUrl`, padrão http://localhost:5178) no navegador.

Os comandos de validar e comparar precisam da CLI `strukt` (`strukt.cli.path`; ou `bun` com `strukt.cli.args` apontando para `apps/cli/src/main.ts`).
