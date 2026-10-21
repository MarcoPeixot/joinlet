import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runContext } from './context';

afterEach(cleanupDirs);

async function workspace(): Promise<string> {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }], [{ slug: 'api', title: 'API' }]),
    'diagrams/a.strukt.json': diagramJson('API', 'DB'),
    'docs/api.md': '# API\n',
  });
  return root;
}

describe('runContext', () => {
  it('writes the generated files and reports what changed', async () => {
    const root = await workspace();
    const out = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('Contexto atualizado');
    const architecture = await readFile(join(root, '.arch', 'context', 'ARCHITECTURE.md'), 'utf8');
    expect(architecture).toContain('```json');
    expect(architecture).toContain('| `API` | nó |');

    const again = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root), again)).toBe(0);
    expect(again.outText).toContain('já estava atualizado');
  });

  it('--check passes when fresh, fails when stale or never generated', async () => {
    const root = await workspace();
    const missing = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root, '--check'), missing)).toBe(1);
    expect(missing.errText).toContain('ausente');

    await runContext(argsOf('context', '--dir', root), fakeIo());
    const fresh = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root, '--check'), fresh)).toBe(0);

    await writeFile(join(root, '.arch', 'context', 'ARCHITECTURE.md'), 'velho\n', 'utf8');
    const stale = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root, '--check'), stale)).toBe(1);
    expect(stale.errText).toContain('desatualizado');
  });

  it('accepts another output directory inside .arch/ and refuses one outside', async () => {
    const root = await workspace();
    const out = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root, '--out', '.arch/contexto'), out)).toBe(0);
    expect(await readFile(join(root, '.arch', 'contexto', 'llms.txt'), 'utf8')).toContain('# Loja');

    const bad = fakeIo();
    expect(await runContext(argsOf('context', '--dir', root, '--out', 'docs/contexto'), bad)).toBe(2);
    expect(bad.errText).toContain('dentro de .arch/');
  });
});
