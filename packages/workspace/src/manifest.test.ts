import { STRUKT_FORMAT_VERSION } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { emptyManifest, itemPaths, parseManifest, printManifest } from './manifest';

describe('manifest', () => {
  it('prints sorted keys and parses back to the same manifest', () => {
    const manifest = {
      ...emptyManifest('Loja'),
      diagrams: [{ slug: 'visao-geral', title: 'Visão geral' }],
      docs: [{ slug: 'api', title: 'API' }],
    };
    const text = printManifest(manifest);
    expect(text.indexOf('"diagrams"')).toBeLessThan(text.indexOf('"name"'));
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseManifest(text)).toEqual({ manifest, warnings: [] });
  });

  it('defaults missing lists and reports skipped entries in pt-BR', () => {
    const text = JSON.stringify({
      version: 1,
      name: 'Loja',
      diagrams: [{ slug: 'a', title: 'A' }, { slug: 'a', title: 'Outro A' }, { slug: '../x', title: 'X' }, { title: 'Sem slug' }],
    });
    const { manifest, warnings } = parseManifest(text);
    expect(manifest.diagrams).toEqual([{ slug: 'a', title: 'A' }]);
    expect(manifest.docs).toEqual([]);
    expect(manifest.sketches).toEqual([]);
    expect(warnings).toEqual([
      'strukt.json: "a" aparece duas vezes em diagrams; a repetição foi ignorada.',
      'strukt.json: uma entrada inválida de diagrams foi ignorada.',
      'strukt.json: uma entrada inválida de diagrams foi ignorada.',
    ]);
  });

  it('rejects files it cannot trust', () => {
    expect(() => parseManifest('{')).toThrow('strukt.json não é um JSON válido.');
    expect(() => parseManifest('[]')).toThrow('strukt.json não tem o formato de um workspace do Joinlet.');
    expect(() => parseManifest(JSON.stringify({ version: STRUKT_FORMAT_VERSION + 1, name: 'x' }))).toThrow(
      `strukt.json é de uma versão mais nova do Joinlet (v${STRUKT_FORMAT_VERSION + 1}).`,
    );
  });

  it('maps each item to the files it owns', () => {
    expect(itemPaths('diagram', 'api')).toEqual(['diagrams/api.strukt.json', 'diagrams/api.layout.json']);
    expect(itemPaths('doc', 'api')).toEqual(['docs/api.md']);
    expect(itemPaths('sketch', 'api')).toEqual(['sketches/api.excalidraw']);
  });
});

describe('workspace identity', () => {
  it('round trips optional branding without changing old manifests', () => {
    const manifest = { ...emptyManifest('Platform'), description: 'Engineering systems', logo: 'data:image/webp;base64,AAAA' };
    expect(parseManifest(printManifest(manifest))).toEqual({ manifest, warnings: [] });
    expect(parseManifest(printManifest(emptyManifest('Legacy'))).manifest).toEqual(emptyManifest('Legacy'));
  });
  it.each([['remote', 'https://example.com/logo.png'], ['SVG', 'data:image/svg+xml;base64,AAAA'], ['oversized', 'data:image/png;base64,' + 'A'.repeat(350_000)]])('drops unsafe or oversized logo: %s', (_label, logo) => {
    const result = parseManifest(JSON.stringify({ ...emptyManifest('Platform'), logo }));
    expect(result.manifest.logo).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});
