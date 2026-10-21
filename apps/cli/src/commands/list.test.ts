import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runList } from './list';

afterEach(cleanupDirs);

describe('runList', () => {
  it('lists diagrams with counts and documents', async () => {
    const root = await tempDir();
    await writeArch(root, {
      'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'Visão geral' }], [{ slug: 'api', title: 'API' }]),
      'diagrams/a.strukt.json': diagramJson('API', 'DB'),
    });
    const out = fakeIo();
    expect(await runList(argsOf('list', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('Workspace "Loja"');
    expect(out.outText).toContain('a  "Visão geral"  2 componentes, 0 conexões');
    expect(out.outText).toContain('api  "API"');
  });

  it('exits 2 without a workspace', async () => {
    const out = fakeIo();
    expect(await runList(argsOf('list', '--dir', await tempDir()), out)).toBe(2);
    expect(out.errText).toContain('Nenhum workspace do Joinlet');
  });
});
