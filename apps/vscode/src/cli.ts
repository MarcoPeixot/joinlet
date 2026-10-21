/** How to launch the Joinlet CLI: a binary plus arguments placed before the command (e.g. `bun` + `main.ts`). */
export interface CliSettings {
  path: string;
  args: readonly string[];
}

/** A process to run, never through a shell. */
export interface CliInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export function normalizeCliSettings(raw: { path?: unknown; args?: unknown }): CliSettings {
  const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : 'strukt';
  const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === 'string') : [];
  return { path, args };
}

/** `--dir=<root>` as one argument: a root starting with `-` can never be read as another flag. */
export function buildCheckInvocation(settings: CliSettings, root: string, options: { drift: boolean; strict?: boolean }): CliInvocation {
  const flags = ['--json'];
  if (options.drift || options.strict) flags.push('--drift');
  if (options.strict) flags.push('--strict');
  return { command: settings.path, args: [...settings.args, 'check', ...flags, `--dir=${root}`], cwd: root };
}

export function buildDiffInvocation(settings: CliSettings, root: string, ref: string): CliInvocation {
  return { command: settings.path, args: [...settings.args, 'diff', ref, '--markdown', `--dir=${root}`], cwd: root };
}

/** A git ref safe to pass as a positional argument: null when valid, a pt-BR reason otherwise. */
export function validateRef(ref: string): string | null {
  if (!ref.trim()) return 'Informe um ref do git (por exemplo HEAD ou main).';
  if (ref.startsWith('-') || ref.includes('..') || !/^[A-Za-z0-9_./~^@{}+:-]+$/.test(ref)) return `"${ref.replace(/[\u0000-\u001f]/g, '?')}" não é um ref do git válido.`;
  return null;
}
