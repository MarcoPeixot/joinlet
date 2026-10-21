import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZIP_MAX_ENTRIES, ZIP_MAX_FILE_BYTES, unzipFiles, zipFiles } from './zip';

describe('workspace zip', () => {
  it('round-trips files under .arch/', () => {
    const files = { 'strukt.json': '{}\n', 'docs/visão.md': '# Visão ✓\n', 'diagrams/a.strukt': 'A > B\n' };
    expect(unzipFiles(zipFiles(files))).toEqual(files);
  });

  it('accepts a zip whose workspace sits in a nested folder, ignoring the rest', () => {
    const bytes = zipSync({
      'repo/.arch/strukt.json': strToU8('{}'),
      'repo/.arch/docs/a.md': strToU8('a'),
      'repo/README.md': strToU8('fora'),
      '__MACOSX/repo/.arch/strukt.json': strToU8('lixo'),
    });
    expect(unzipFiles(bytes)).toEqual({ 'strukt.json': '{}', 'docs/a.md': 'a' });
  });

  it('drops entries with unsafe paths', () => {
    const bytes = zipSync({
      '.arch/strukt.json': strToU8('{}'),
      '.arch/docs/../../fora.md': strToU8('x'),
      '.arch/__proto__/a.md': strToU8('x'),
      '.arch/docs/a\\b.md': strToU8('x'),
    });
    const files = unzipFiles(bytes);
    expect(Object.keys(files)).toEqual(['strukt.json']);
    expect(Object.getPrototypeOf(files)).toBe(Object.prototype);
  });

  it('explains what is wrong in pt-BR', () => {
    expect(() => unzipFiles(strToU8('não é zip'))).toThrow('O arquivo não é um .zip válido.');
    expect(() => unzipFiles(zipSync({ 'a.txt': strToU8('a') }))).toThrow('O .zip não contém um workspace do Joinlet (strukt.json).');
  });

  it('rejects a zip with a file larger than the per-file limit', () => {
    const big = new Uint8Array(ZIP_MAX_FILE_BYTES + 1); // zero-filled: highly compressible, small on disk
    const bytes = zipSync({ '.arch/strukt.json': strToU8('{}'), '.arch/docs/big.md': big }, { level: 9 });
    expect(() => unzipFiles(bytes)).toThrow('O .zip é grande demais para importar (limite: 64 MB, 16 MB por arquivo, 2000 arquivos).');
  });

  it('rejects a zip with too many entries', () => {
    const entries: Record<string, Uint8Array> = { '.arch/strukt.json': strToU8('{}') };
    for (let i = 0; i < ZIP_MAX_ENTRIES + 1; i++) entries[`.arch/docs/f${i}.md`] = strToU8('x');
    const bytes = zipSync(entries, { level: 0 });
    expect(() => unzipFiles(bytes)).toThrow('O .zip é grande demais para importar (limite: 64 MB, 16 MB por arquivo, 2000 arquivos).');
  });

  it('still round-trips a normal-sized workspace zip', () => {
    const files = { 'strukt.json': '{}\n', 'docs/api.md': '# API\n' };
    expect(unzipFiles(zipFiles(files))).toEqual(files);
  });
});
