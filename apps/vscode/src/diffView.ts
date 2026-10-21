/** Markdown shown in the preview: the CLI output, or an explicit "nothing changed" instead of an empty page. */
export function diffMarkdown(ref: string, stdout: string): string {
  if (stdout.trim()) return stdout;
  return `## Arquitetura\n\nSem mudanças semânticas entre \`${ref}\` e a pasta de trabalho.\n`;
}
