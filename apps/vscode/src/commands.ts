import { join } from 'node:path';
import { resolveAppUrl } from './appUrl';
import { buildCheckInvocation, buildDiffInvocation, normalizeCliSettings, validateRef } from './cli';
import type { CliSettings } from './cli';
import { parseCheckReport, reportToFileDiagnostics, summarizeReport } from './checkReport';
import type { EditorDiagnostic } from './diagnostics';
import { diffMarkdown } from './diffView';
import { describeRunFailure, runCli } from './run';
import type { ExecFn } from './run';
import { pickRoot, workspaceRoots } from './workspaceRoots';

export const COMMAND_IDS = ['strukt.check', 'strukt.diff', 'strukt.open'] as const;

/** `strukt.<key>` settings read by `readSettings`; `package.json` must declare each (see `manifest.test.ts`). */
export const SETTING_KEYS = ['cli.path', 'cli.args', 'appUrl', 'diffRef', 'check.drift', 'check.strict', 'liveDiagnostics'] as const;

export interface Settings {
  cli: CliSettings;
  /** Raw value of `strukt.appUrl`: validated by `resolveAppUrl`. */
  appUrl: unknown;
  diffRef: string;
  drift: boolean;
  strict: boolean;
}

/** Everything the commands need from the editor. `extension.ts` implements it with `vscode`; the tests with a fake. */
export interface Host {
  isTrusted: boolean;
  settings(): Settings;
  /** File-system paths of every `.arch/strukt.json` in the open folders. */
  findManifests(): Promise<string[]>;
  activeFile(): string | undefined;
  /** Lets the user pick one of several roots; undefined when dismissed. */
  chooseRoot(roots: string[]): Promise<string | undefined>;
  exec: ExecFn;
  /** Replaces the diagnostics of the last check (absolute path → diagnostics). */
  setCheckDiagnostics(files: Map<string, EditorDiagnostic[]>): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  showMarkdown(markdown: string): Promise<void>;
  openExternal(url: string): Promise<boolean>;
}

/** Reads the raw `strukt.*` values into `Settings` (the one place where settings of unknown type are coerced). */
export function readSettings(get: <T>(key: string) => T | undefined): Settings {
  return {
    cli: normalizeCliSettings({ path: get('cli.path'), args: get('cli.args') }),
    appUrl: get('appUrl'),
    diffRef: typeof get('diffRef') === 'string' ? get<string>('diffRef')! : 'HEAD',
    drift: get('check.drift') === true,
    strict: get('check.strict') === true,
  };
}

const UNTRUSTED = 'Esta pasta não é confiável: confie nela para executar a CLI do Joinlet (ela roda no seu computador com o conteúdo do repositório).';
const NO_WORKSPACE = 'Nenhum workspace do Joinlet (.arch/strukt.json) nesta pasta.';

export async function checkWorkspaceCommand(host: Host): Promise<void> {
  if (!host.isTrusted) return host.error(UNTRUSTED);
  const roots = workspaceRoots(await host.findManifests());
  if (!roots.length) return host.warn(NO_WORKSPACE);
  const { cli, drift, strict } = host.settings();
  const merged = new Map<string, EditorDiagnostic[]>();
  const summaries: string[] = [];
  let errors = 0;
  for (const root of roots) {
    const outcome = await runCli(host.exec, buildCheckInvocation(cli, root, { drift, strict }));
    // 0 = clean, 1 = findings (both carry the JSON report); anything else is a CLI/environment problem.
    if (outcome.kind !== 'done' || outcome.code > 1) return host.error(describeRunFailure(outcome, cli));
    const parsed = parseCheckReport(outcome.stdout);
    if (!parsed.ok) return host.error(`${roots.length > 1 ? `${root}: ` : ''}${parsed.error}`);
    for (const [path, diagnostics] of reportToFileDiagnostics(parsed.report, { strict })) {
      merged.set(join(root, '.arch', ...path.split('/')), diagnostics);
    }
    errors += parsed.report.errors;
    summaries.push(`${roots.length > 1 ? `${root}: ` : ''}${summarizeReport(parsed.report, { strict })}`);
  }
  host.setCheckDiagnostics(merged);
  const message = `Joinlet: ${summaries.join(' ')}`;
  if (errors) host.warn(message);
  else host.info(message);
}

export async function diffCommand(host: Host): Promise<void> {
  if (!host.isTrusted) return host.error(UNTRUSTED);
  const { cli, diffRef } = host.settings();
  const ref = diffRef.trim();
  const invalid = validateRef(ref);
  if (invalid) return host.error(`strukt.diffRef: ${invalid}`);
  const roots = workspaceRoots(await host.findManifests());
  if (!roots.length) return host.warn(NO_WORKSPACE);
  const root = roots.length === 1 ? roots[0] : (pickRoot(roots, host.activeFile()) ?? (await host.chooseRoot(roots)));
  if (!root) return;
  const outcome = await runCli(host.exec, buildDiffInvocation(cli, root, ref));
  if (outcome.kind !== 'done' || outcome.code !== 0) return host.error(describeRunFailure(outcome, cli));
  await host.showMarkdown(diffMarkdown(ref, outcome.stdout));
}

export async function openCommand(host: Host): Promise<void> {
  const target = resolveAppUrl(host.settings().appUrl);
  if (!target.ok) return host.error(target.error);
  if (!(await host.openExternal(target.url))) host.error(`Não consegui abrir o navegador. Abra ${target.url} manualmente.`);
}
