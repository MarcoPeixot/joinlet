import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { printDiagramJsonSchema } from '@strukt/json';
import { DIAGRAM_FILE_MATCH, isDiagramFile, jsonValidation, SCHEMA_URL } from './schema';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('isDiagramFile', () => {
  it('matches diagram documents on any OS path', () => {
    expect(isDiagramFile('/repo/.arch/diagrams/loja.strukt.json')).toBe(true);
    expect(isDiagramFile('C:\\repo\\.arch\\diagrams\\loja.strukt.json')).toBe(true);
    expect(isDiagramFile('/repo/outro/api.strukt.json')).toBe(true);
  });

  it('leaves the manifest, layouts and other JSON alone', () => {
    for (const path of ['/repo/.arch/strukt.json', '/repo/.arch/strukt.schema.json', '/repo/.arch/diagrams/loja.layout.json', '/repo/.arch/board.json', '/repo/package.json', '/repo/.strukt.json', '/repo/loja.strukt.json.bak']) {
      expect(isDiagramFile(path)).toBe(false);
    }
  });
});

describe('schema association', () => {
  it('is what package.json contributes', () => {
    const pkg = JSON.parse(read('../package.json')) as { contributes: { jsonValidation: unknown } };
    expect(pkg.contributes.jsonValidation).toEqual(jsonValidation());
    expect(jsonValidation()).toEqual([{ fileMatch: DIAGRAM_FILE_MATCH, url: SCHEMA_URL }]);
  });

  it('ships the bundled schema byte-identical to @strukt/json (run `bun run schema` when this fails)', () => {
    expect(read(`../${SCHEMA_URL.replace('./', '')}`)).toBe(printDiagramJsonSchema());
  });
});
