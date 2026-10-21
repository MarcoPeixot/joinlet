export const USAGE = `joinlet-mcp — servidor MCP do Joinlet (stdio)

Uso: joinlet-mcp [--dir <caminho>]

  --dir <caminho>   Onde procurar o workspace (padrão: diretório atual; sobe até achar .arch/strukt.json)`;

export function dirFromArgv(argv: readonly string[]): string | { error: string } {
  let dir = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') return { error: USAGE };
    if (arg === '--dir') {
      const value = argv[++i];
      if (value === undefined) return { error: 'A opção --dir precisa de um valor.' };
      dir = value;
    } else if (arg.startsWith('--dir=')) {
      dir = arg.slice('--dir='.length);
      if (!dir) return { error: 'A opção --dir precisa de um valor.' };
    } else return { error: `Opção desconhecida: "${arg}".\n\n${USAGE}` };
  }
  return dir;
}
