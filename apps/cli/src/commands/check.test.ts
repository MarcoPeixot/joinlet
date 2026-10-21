import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprintLines } from '@strukt/workspace';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runCheck } from './check';

afterEach(cleanupDirs);

describe('runCheck', () => {
  it('reports valid workspaces and exits 0', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API', 'DB'),
    });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('1 diagrama, 0 avisos, 0 erros.');
  });

  it('reports schema errors with line and column and exits 1', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': '{\n  "version": 1,\n  "nodes": [{ "id": "A", "color": 5 }]\n}\n',
    });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(1);
    expect(out.outText).toContain('diagrams/a.strukt.json:3:35: erro: nodes[0].color: deve ser texto.');
  });

  it('fails when the manifest names a missing diagram', async () => {
    const root = await tempDir();
    await writeArch(root, { 'strukt.json': manifestOf('Loja', [{ slug: 'ausente', title: 'Ausente' }]) });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(1);
    expect(out.outText).toContain('diagrams/ausente.strukt.json:1:1: erro: Arquivo do diagrama não encontrado.');
  });

  it('detects evidence that no longer matches the repository', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API'),
      'evidence.json': JSON.stringify({ a: { API: [{ path: 'src/api.ts', line: 2, contains: 'route' }] } }),
    });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(1);
    expect(out.outText).toContain('src/api.ts');
  });

  it('detects a stale line anchor in an existing source file', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'api.ts'), 'export const route = 1;\n');
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API'),
      'evidence.json': JSON.stringify({ a: { API: [{ path: 'src/api.ts', line: 1, contains: 'oldRoute' }] } }),
    });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(1);
    expect(out.outText).toContain('Trecho esperado não encontrado.');
  });

  it('reports an open accuracy concern without failing validation', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API'),
      'concerns.json': JSON.stringify([{ id: 'c1', diagram: 'a', element: 'API', message: 'Revisar cache', status: 'open', createdAt: '2026-09-24T00:00:00Z' }]),
    });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(0);
    expect(out.errText).toContain('1 pendência(s) de precisão aberta(s)');
  });

  it('prints a JSON report with --json', async () => {
    const root = await tempDir();
    await writeArch(root, { 'strukt.json': manifestOf('Loja', []) });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root, '--json'), out)).toBe(0);
    expect(JSON.parse(out.outText)).toMatchObject({ ok: true, errors: 0, diagrams: [] });
  });

  it('exits 2 without a workspace', async () => {
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', await tempDir()), out)).toBe(2);
    expect(out.errText).toContain('Nenhum workspace do Joinlet');
  });

  it('verifies a line beyond 2 MB without a false error', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'src'));
    const filler = 'x'.repeat(99) + '\n';
    await writeFile(join(root, 'src', 'big.ts'), `${filler.repeat(30_000)}export const late = 1;\n`);
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API'),
      'evidence.json': JSON.stringify({ a: { API: [{ path: 'src/big.ts', line: 30_001, contains: 'late' }] } }),
    });
    expect(await runCheck(argsOf('check', '--dir', root), fakeIo())).toBe(0);
  });

  describe('--drift', () => {
    const source = 'import x;\nexport function route() {}\nexport const z = 1;\n';
    const setup = async (evidence: unknown, files: Record<string, string> = { 'src/api.ts': source }) => {
      const root = await tempDir();
      await mkdir(join(root, 'src'));
      for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
      await writeArch(root, {
        'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
        'diagrams/a.strukt.json': diagramJson('API'),
        'evidence.json': JSON.stringify({ a: { API: evidence } }),
      });
      return root;
    };
    const snip = fingerprintLines(source.split('\n'), 2);

    it('warns (exit 0) about a moved snippet and suggests the line', async () => {
      const moved = `a\nb\n${source}`;
      const root = await setup([{ path: 'src/api.ts', line: 2, snippet: snip }], { 'src/api.ts': moved });
      const out = fakeIo();
      expect(await runCheck(argsOf('check', '--dir', root, '--drift'), out)).toBe(0);
      expect(out.outText).toContain('aviso: a/API (src/api.ts)');
      expect(out.outText).toContain('para a 4')
      expect(out.outText).toContain('1 aviso, 0 erros');
    });

    it('fails (exit 1) with --strict', async () => {
      const root = await setup([{ path: 'src/api.ts', line: 2, snippet: 'ffffffff' }]);
      const out = fakeIo();
      expect(await runCheck(argsOf('check', '--dir', root, '--drift', '--strict'), out)).toBe(1);
      expect(out.outText).toContain('erro: a/API');
      expect(out.outText).toContain('1 erro.');
    });

    it('is clean when nothing drifted, and hints at --drift otherwise', async () => {
      const root = await setup([{ path: 'src/api.ts', line: 2, snippet: snip }]);
      const clean = fakeIo();
      expect(await runCheck(argsOf('check', '--dir', root, '--drift'), clean)).toBe(0);
      expect(clean.outText).toContain('0 avisos, 0 erros');
      expect(clean.errText).not.toContain('--drift');
      const hint = fakeIo();
      expect(await runCheck(argsOf('check', '--dir', root), hint)).toBe(0);
      expect(hint.errText).toContain('joinlet check --drift');
    });

    it('does not read files reached through a symlink out of the repository', async () => {
      const outside = await tempDir();
      await writeFile(join(outside, 'secret.ts'), 'a\nb\nc\n');
      const root = await setup([{ path: 'link/secret.ts', line: 3 }, { path: 'src/leak.ts', line: 3 }], {});
      await symlink(outside, join(root, 'link'));
      await symlink(join(outside, 'secret.ts'), join(root, 'src', 'leak.ts'));
      const out = fakeIo();
      const code = await runCheck(argsOf('check', '--dir', root, '--drift', '--json'), out);
      const report = JSON.parse(out.outText);
      expect(code).toBe(1);
      expect(report.evidence).toHaveLength(2);
      expect(report.drift).toEqual([]);
    });

    it('never touches ../ or absolute paths (they are dropped when the file is parsed)', async () => {
      const root = await setup([{ path: '../../etc/passwd', line: 1 }, { path: '/etc/passwd', line: 1 }]);
      const out = fakeIo();
      expect(await runCheck(argsOf('check', '--dir', root, '--drift'), out)).toBe(0);
      expect(out.outText).not.toContain('passwd');
    });

    it('does not follow a symlink into a sibling directory sharing the root name as prefix', async () => {
      const parent = await tempDir();
      const repo = join(parent, 'repo');
      const evil = join(parent, 'repo-evil');
      await mkdir(join(repo, 'src'), { recursive: true });
      await mkdir(evil);
      await writeFile(join(evil, 'secret.ts'), 'a\nb\nc\n');
      await symlink(join(evil, 'secret.ts'), join(repo, 'src', 'leak.ts'));
      await writeArch(repo, {
        'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
        'diagrams/a.strukt.json': diagramJson('API'),
        'evidence.json': JSON.stringify({ a: { API: [{ path: 'src/leak.ts', line: 2, snippet: 'ffffffff' }] } }),
      });
      const out = fakeIo();
      const code = await runCheck(argsOf('check', '--dir', repo, '--drift', '--json'), out);
      const report = JSON.parse(out.outText);
      expect(code).toBe(1);
      expect(report.evidence).toHaveLength(1);
      expect(report.drift).toEqual([]);
    });

    it('does not fail --strict for the truncation summary alone', async () => {
      const evidence = Array.from({ length: 501 }, () => ({ path: 'src/api.ts', line: 2, snippet: 'ffffffff' }));
      const root = await setup(evidence);
      const out = fakeIo();
      const code = await runCheck(argsOf('check', '--dir', root, '--drift', '--strict', '--json'), out);
      const report = JSON.parse(out.outText);
      expect(report.drift.at(-1).kind).toBe('truncated');
      expect(report.errors).toBe(500);
      expect(code).toBe(1);
    });

    it('prints the truncation summary as a warning even with --strict', async () => {
      const evidence = Array.from({ length: 501 }, () => ({ path: 'src/api.ts', line: 2, snippet: 'ffffffff' }));
      const root = await setup(evidence);
      const out = fakeIo();
      await runCheck(argsOf('check', '--dir', root, '--drift', '--strict'), out);
      const lines = out.outText.split('\n');
      expect(lines.filter((l) => l.includes(': erro: a/API'))).toHaveLength(500);
      const summary = lines.find((l) => l.includes('Mais 1 achado'))!;
      expect(summary).toContain(': aviso:');
      expect(summary).not.toContain(': erro:');
      expect(lines.find((l) => /diagrama/.test(l) && /erro/.test(l) && /^\d+ diagrama/.test(l))).toMatch(/1 aviso, 500 erros\./);
    });

    it('does not let missing files eat the finding cap', async () => {
      const evidence = [...Array.from({ length: 600 }, (_, i) => ({ path: `src/gone${i}.ts`, line: 1 })), { path: 'src/api.ts', line: 2, snippet: 'ffffffff' }];
      const root = await setup(evidence);
      const out = fakeIo();
      await runCheck(argsOf('check', '--dir', root, '--drift', '--json'), out);
      expect(JSON.parse(out.outText).drift).toMatchObject([{ kind: 'snippet-changed' }]);
    });

    it('hints at --drift when anchored refs only have contains', async () => {
      const root = await setup([{ path: 'src/api.ts', line: 2, contains: 'x' }]);
      const hint = fakeIo();
      await runCheck(argsOf('check', '--dir', root), hint);
      expect(hint.errText).toContain('joinlet check --drift');
    });

    it('prints the --drift hint only when an anchored reference could drift', async () => {
      const plain = await setup([{ path: 'src/api.ts', line: 2 }]);
      const quiet = fakeIo();
      await runCheck(argsOf('check', '--dir', plain), quiet);
      expect(quiet.errText).not.toContain('--drift');
    });
  });

  it('validates .arch/sources.json and fails on invalid entries or a missing target diagram', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
      'diagrams/a.strukt.json': diagramJson('API'),
      'sources.json': JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'a', mode: 'merge' }] }),
    });
    expect(await runCheck(argsOf('check', '--dir', root), fakeIo())).toBe(0);
    await writeArch(root, { 'sources.json': JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'nao-existe' }, { id: 'x', kind: 'cobol', include: ['a'], diagram: 'a' }] }) });
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), out)).toBe(1);
    expect(out.outText).toContain('sources.json:1:1: erro: sources[1].kind');
    const json = fakeIo();
    await runCheck(argsOf('check', '--json', '--dir', root), json);
    expect(JSON.parse(json.outText).sources.length).toBeGreaterThan(0);
    await writeArch(root, { 'sources.json': JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'nao-existe' }] }) });
    const missing = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root), missing)).toBe(1);
    expect(missing.outText).toContain('"nao-existe" não existe');
  });
});
