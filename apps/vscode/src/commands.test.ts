import { describe, expect, it } from 'vitest';
import { checkWorkspaceCommand, diffCommand, openCommand } from './commands';
import type { Host } from './commands';
import type { EditorDiagnostic } from './diagnostics';
import type { ExecFn } from './run';

interface Calls {
  info: string[];
  warn: string[];
  error: string[];
  markdown: string[];
  opened: string[];
  diagnostics: Map<string, EditorDiagnostic[]>[];
  exec: { command: string; args: readonly string[]; cwd: string }[];
}

function fakeHost(overrides: Partial<Host> = {}, execResults: Record<string, Awaited<ReturnType<ExecFn>>> = {}): { host: Host; calls: Calls } {
  const calls: Calls = { info: [], warn: [], error: [], markdown: [], opened: [], diagnostics: [], exec: [] };
  const host: Host = {
    isTrusted: true,
    settings: () => ({ cli: { path: 'strukt', args: [] }, appUrl: undefined, diffRef: 'HEAD', drift: false, strict: false }),
    findManifests: async () => ['/repo/.arch/strukt.json'],
    activeFile: () => undefined,
    chooseRoot: async (roots) => roots[0],
    exec: async (command, args, options) => {
      calls.exec.push({ command, args, cwd: options.cwd });
      return execResults[options.cwd] ?? { code: 0, stdout: JSON.stringify({ ok: true, diagrams: [], errors: 0 }), stderr: '' };
    },
    setCheckDiagnostics: (files) => calls.diagnostics.push(files),
    info: (message) => calls.info.push(message),
    warn: (message) => calls.warn.push(message),
    error: (message) => calls.error.push(message),
    showMarkdown: async (markdown) => {
      calls.markdown.push(markdown);
    },
    openExternal: async (url) => {
      calls.opened.push(url);
      return true;
    },
    ...overrides,
  };
  return { host, calls };
}

const failingReport = JSON.stringify({
  ok: false,
  diagrams: [{ slug: 'a', path: 'diagrams/a.strukt.json', diagnostics: [{ severity: 'error', message: 'cor inválida', line: 3, column: 5, span: { from: 1, to: 2 } }] }],
  errors: 1,
});

describe('checkWorkspaceCommand', () => {
  it('runs joinlet check --json in each workspace root and reports a clean workspace', async () => {
    const { host, calls } = fakeHost();
    await checkWorkspaceCommand(host);
    expect(calls.exec).toEqual([{ command: 'strukt', args: ['check', '--json', '--dir=/repo'], cwd: '/repo' }]);
    expect(calls.info).toEqual(['Joinlet: 0 diagramas, 0 avisos, 0 erros.']);
    expect(calls.diagnostics).toEqual([new Map()]);
  });

  it('publishes diagnostics by absolute file and reports failures (exit code 1 is a normal result)', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: 1, stdout: failingReport, stderr: '' } });
    await checkWorkspaceCommand(host);
    const files = calls.diagnostics.at(-1)!;
    expect([...files.keys()]).toEqual(['/repo/.arch/diagrams/a.strukt.json']);
    expect(files.get('/repo/.arch/diagrams/a.strukt.json')).toEqual([{ severity: 'error', message: 'cor inválida', startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 4 }]);
    expect(calls.warn).toEqual(['Joinlet: 1 diagrama, 0 avisos, 1 erro.']);
    expect(calls.info).toEqual([]);
  });

  it('honours the drift and strict settings', async () => {
    const { host, calls } = fakeHost({ settings: () => ({ cli: { path: 'bun', args: ['/s/main.ts'] }, appUrl: undefined, diffRef: 'HEAD', drift: true, strict: true }) });
    await checkWorkspaceCommand(host);
    expect(calls.exec[0]).toMatchObject({ command: 'bun', args: ['/s/main.ts', 'check', '--json', '--drift', '--strict', '--dir=/repo'] });
  });

  it('checks every workspace of a monorepo and merges the diagnostics', async () => {
    const { host, calls } = fakeHost({ findManifests: async () => ['/repo/a/.arch/strukt.json', '/repo/b/.arch/strukt.json'] }, { '/repo/b': { code: 1, stdout: failingReport, stderr: '' } });
    await checkWorkspaceCommand(host);
    expect(calls.exec.map((c) => c.cwd)).toEqual(['/repo/a', '/repo/b']);
    expect([...calls.diagnostics.at(-1)!.keys()]).toEqual(['/repo/b/.arch/diagrams/a.strukt.json']);
    expect(calls.warn[0]).toContain('/repo/b');
  });

  it('says there is no workspace instead of failing silently', async () => {
    const { host, calls } = fakeHost({ findManifests: async () => [] });
    await checkWorkspaceCommand(host);
    expect(calls.warn).toEqual(['Nenhum workspace do Joinlet (.arch/strukt.json) nesta pasta.']);
    expect(calls.exec).toEqual([]);
  });

  it('refuses to run the CLI in an untrusted folder', async () => {
    const { host, calls } = fakeHost({ isTrusted: false });
    await checkWorkspaceCommand(host);
    expect(calls.error[0]).toContain('confiável');
    expect(calls.exec).toEqual([]);
  });

  it('explains a missing CLI and keeps previous diagnostics untouched', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: null, stdout: '', stderr: '', failure: { code: 'ENOENT', message: 'spawn' } } });
    await checkWorkspaceCommand(host);
    expect(calls.error[0]).toContain('strukt.cli.path');
    expect(calls.diagnostics).toEqual([]);
  });

  it('surfaces a garbled report as an error', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: 0, stdout: 'olá', stderr: '' } });
    await checkWorkspaceCommand(host);
    expect(calls.error[0]).toContain('JSON');
  });

  it('shows the CLI explanation for exit code 2', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: 2, stdout: '', stderr: 'Nenhum workspace do Joinlet encontrado.\n' } });
    await checkWorkspaceCommand(host);
    expect(calls.error).toEqual(['Nenhum workspace do Joinlet encontrado.']);
  });
});

describe('diffCommand', () => {
  const markdown = '## Arquitetura — `HEAD` → `worktree`\n\n- Adicionados: `API`\n';

  it('previews joinlet diff <ref> --markdown', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: 0, stdout: markdown, stderr: '' } });
    await diffCommand(host);
    expect(calls.exec).toEqual([{ command: 'strukt', args: ['diff', 'HEAD', '--markdown', '--dir=/repo'], cwd: '/repo' }]);
    expect(calls.markdown).toEqual([markdown]);
  });

  it('uses the configured ref', async () => {
    const { host, calls } = fakeHost({ settings: () => ({ cli: { path: 'strukt', args: [] }, appUrl: undefined, diffRef: ' origin/main ', drift: false, strict: false }) });
    await diffCommand(host);
    expect(calls.exec[0]!.args).toContain('origin/main');
  });

  it('refuses a ref that looks like a flag, without running anything', async () => {
    const { host, calls } = fakeHost({ settings: () => ({ cli: { path: 'strukt', args: [] }, appUrl: undefined, diffRef: '--output=/etc/x', drift: false, strict: false }) });
    await diffCommand(host);
    expect(calls.error[0]).toContain('ref');
    expect(calls.exec).toEqual([]);
  });

  it('picks the root of the active file when there are several workspaces, else asks', async () => {
    const manifests = ['/repo/a/.arch/strukt.json', '/repo/b/.arch/strukt.json'];
    const withActive = fakeHost({ findManifests: async () => manifests, activeFile: () => '/repo/b/src/x.ts' });
    await diffCommand(withActive.host);
    expect(withActive.calls.exec[0]!.cwd).toBe('/repo/b');
    const asked = fakeHost({ findManifests: async () => manifests, chooseRoot: async (roots) => roots[1] });
    await diffCommand(asked.host);
    expect(asked.calls.exec[0]!.cwd).toBe('/repo/b');
  });

  it('does nothing when the user dismisses the root picker', async () => {
    const { host, calls } = fakeHost({ findManifests: async () => ['/a/.arch/strukt.json', '/b/.arch/strukt.json'], chooseRoot: async () => undefined });
    await diffCommand(host);
    expect(calls.exec).toEqual([]);
    expect(calls.error).toEqual([]);
  });

  it('reports git/CLI failures (exit 2) with the CLI message', async () => {
    const { host, calls } = fakeHost({}, { '/repo': { code: 2, stdout: '', stderr: 'Não é um repositório git.\n' } });
    await diffCommand(host);
    expect(calls.error).toEqual(['Não é um repositório git.']);
    expect(calls.markdown).toEqual([]);
  });

  it('refuses to run in an untrusted folder', async () => {
    const { host, calls } = fakeHost({ isTrusted: false });
    await diffCommand(host);
    expect(calls.exec).toEqual([]);
    expect(calls.error[0]).toContain('confiável');
  });
});

describe('openCommand', () => {
  it('opens the default local app', async () => {
    const { host, calls } = fakeHost();
    await openCommand(host);
    expect(calls.opened).toEqual(['http://localhost:5178/']);
  });

  it('opens the configured URL', async () => {
    const { host, calls } = fakeHost({ settings: () => ({ cli: { path: 'strukt', args: [] }, appUrl: 'https://strukt.example.com', diffRef: 'HEAD', drift: false, strict: false }) });
    await openCommand(host);
    expect(calls.opened).toEqual(['https://strukt.example.com/']);
  });

  it('refuses a non-http URL', async () => {
    const { host, calls } = fakeHost({ settings: () => ({ cli: { path: 'strukt', args: [] }, appUrl: 'file:///etc/passwd', diffRef: 'HEAD', drift: false, strict: false }) });
    await openCommand(host);
    expect(calls.opened).toEqual([]);
    expect(calls.error[0]).toContain('strukt.appUrl');
  });

  it('tells the user when the browser could not be opened', async () => {
    const { host, calls } = fakeHost({ openExternal: async () => false });
    await openCommand(host);
    expect(calls.error[0]).toContain('http://localhost:5178/');
  });
});
