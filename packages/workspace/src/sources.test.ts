import { describe, expect, it } from 'vitest';
import { expandBraces, globPrefix, globProblem, matchGlob, matchesInclude, parseSources, printSources, validateSourceTargets } from './sources';

const doc = (sources: unknown[]) => JSON.stringify({ version: 1, sources });
const valid = { id: 'infra', kind: 'terraform', include: ['infra/**/*.tf'], diagram: 'infra', mode: 'merge' };

describe('parseSources', () => {
  it('reads a valid file and fills the default mode', () => {
    const { mode: _mode, ...noMode } = valid;
    const result = parseSources(doc([noMode]));
    expect(result.diagnostics).toEqual([]);
    expect(result.sources).toEqual([valid]);
  });

  it('treats a missing file as no sources', () => {
    expect(parseSources(null)).toEqual({ sources: [], diagnostics: [] });
  });

  it('reports broken JSON in pt-BR without throwing', () => {
    const result = parseSources('{ "sources": [');
    expect(result.sources).toEqual([]);
    expect(result.diagnostics[0]!.message).toMatch(/JSON inválido/);
  });

  it('refuses another version and a non-object document', () => {
    expect(parseSources(JSON.stringify({ version: 2, sources: [] })).diagnostics[0]!.message).toMatch(/versão/i);
    expect(parseSources('[]').diagnostics[0]!.message).toMatch(/objeto/);
    expect(parseSources(JSON.stringify({ version: 1 })).diagnostics[0]!.message).toMatch(/sources/);
  });

  it('flags typos in keys instead of ignoring them', () => {
    const result = parseSources(doc([{ ...valid, includes: ['x'] }]));
    expect(result.diagnostics.map((d) => d.message).join('\n')).toContain('Chave desconhecida "includes"');
    expect(result.sources).toEqual([]);
  });

  it('validates id, kind, mode, diagram and include with the path of the problem', () => {
    const result = parseSources(doc([
      { ...valid, id: '__proto__' },
      { ...valid, id: 'a b' },
      { ...valid, id: 'k', kind: 'cobol' },
      { ...valid, id: 'm', mode: 'overwrite' },
      { ...valid, id: 'd', diagram: '../x' },
      { ...valid, id: 'i', include: [] },
      { ...valid, id: 'j', include: ['/etc/passwd'] },
      { ...valid, id: 'n', include: ['!only-negative.tf'] },
    ]));
    expect(result.sources).toEqual([]);
    const paths = result.diagnostics.map((d) => d.path);
    for (const expected of ['sources[0].id', 'sources[1].id', 'sources[2].kind', 'sources[3].mode', 'sources[4].diagram', 'sources[5].include', 'sources[6].include[0]', 'sources[7].include']) {
      expect(paths, expected).toContain(expected);
    }
  });

  it('keeps the valid sources and drops the invalid ones', () => {
    const result = parseSources(doc([valid, { ...valid, id: 'bad', kind: 'x' }]));
    expect(result.sources.map((s) => s.id)).toEqual(['infra']);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    const result = parseSources(doc([valid, { ...valid, diagram: 'other' }]));
    expect(result.diagnostics.map((d) => d.message).join('\n')).toMatch(/já existe/);
    expect(result.sources).toHaveLength(1);
  });

  it('never lets __proto__ become a key or crash on hostile documents', () => {
    const result = parseSources('{"version":1,"sources":[{"__proto__":{"x":1},"id":"a","kind":"d2","include":["a.d2"],"diagram":"a"}]}');
    expect(result.diagnostics.map((d) => d.message).join('\n')).toContain('Chave desconhecida "__proto__"');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('caps the number of sources and includes', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ ...valid, id: `s${i}` }));
    expect(parseSources(doc(many)).diagnostics.map((d) => d.message).join('\n')).toMatch(/no máximo 100/);
    const includes = Array.from({ length: 51 }, (_, i) => `a${i}.tf`);
    expect(parseSources(doc([{ ...valid, include: includes }])).diagnostics.map((d) => d.message).join('\n')).toMatch(/no máximo 50/);
  });
});

describe('printSources', () => {
  it('is canonical and round-trips', () => {
    const sources = parseSources(doc([valid, { id: 'api', kind: 'openapi', include: ['api/openapi.yaml', '!api/old/*.yaml'], diagram: 'api', mode: 'replace' }])).sources;
    const text = printSources(sources);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseSources(text).sources).toEqual(sources);
    expect(printSources(parseSources(text).sources)).toBe(text);
  });
});

describe('validateSourceTargets', () => {
  const sources = parseSources(doc([valid])).sources;

  it('accepts sources that point to existing diagrams', () => {
    expect(validateSourceTargets(sources, ['infra'])).toEqual([]);
  });

  it('flags a missing diagram with the known slugs', () => {
    const [problem] = validateSourceTargets(sources, ['loja', 'api']);
    expect(problem!.path).toBe('sources[0].diagram');
    expect(problem!.message).toContain('"infra"');
    expect(problem!.message).toContain('loja, api');
  });

  it('refuses mixing replace and merge on the same diagram', () => {
    const mixed = parseSources(doc([valid, { ...valid, id: 'k8s', kind: 'kubernetes', include: ['k8s/*.yaml'], mode: 'replace' }])).sources;
    const problems = validateSourceTargets(mixed, ['infra']);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.path).toBe('sources[1].mode');
    expect(problems[0]!.message).toMatch(/replace.*merge|merge.*replace/);
  });
});

describe('globs', () => {
  it('rejects patterns that escape the repository or are ambiguous', () => {
    for (const bad of ['', '/abs/*.tf', 'C:/x.tf', '../x.tf', 'a/../b.tf', 'a\\b.tf', 'a/[ab].tf', 'a/{b,{c,d}}.tf', 'a/{b.tf', 'a/b}.tf', 'a//b.tf', '!', 'a\0b', `${'a/'.repeat(30)}x`, 'x'.repeat(301), '**/**/**/**/**/x.tf']) {
      expect(globProblem(bad), JSON.stringify(bad)).toEqual(expect.any(String));
    }
    for (const good of ['main.tf', 'infra/**/*.tf', '!infra/legacy/**', '*.{yml,yaml}', '{a,b}/x?.tf']) expect(globProblem(good), good).toBeNull();
  });

  it('expands braces up to a limit', () => {
    expect(expandBraces('a/*.{yml,yaml}')).toEqual(['a/*.yml', 'a/*.yaml']);
    expect(expandBraces('{a,b}/{c,d}')).toEqual(['a/c', 'a/d', 'b/c', 'b/d']);
    expect(expandBraces('plain')).toEqual(['plain']);
  });

  it('matches * within a segment and ** across directories', () => {
    expect(matchGlob('infra/*.tf', 'infra/main.tf')).toBe(true);
    expect(matchGlob('infra/*.tf', 'infra/mod/main.tf')).toBe(false);
    expect(matchGlob('infra/**/*.tf', 'infra/main.tf')).toBe(true);
    expect(matchGlob('infra/**/*.tf', 'infra/a/b/c/main.tf')).toBe(true);
    expect(matchGlob('infra/**/*.tf', 'other/main.tf')).toBe(false);
    expect(matchGlob('**/*.d2', 'x.d2')).toBe(true);
    expect(matchGlob('**/*.d2', 'a/b/x.d2')).toBe(true);
    expect(matchGlob('k8s/**', 'k8s/a/b.yaml')).toBe(true);
    expect(matchGlob('a?c.tf', 'abc.tf')).toBe(true);
    expect(matchGlob('a?c.tf', 'ac.tf')).toBe(false);
    expect(matchGlob('*.{yml,yaml}', 'x.yaml')).toBe(true);
    expect(matchGlob('*.{yml,yaml}', 'x.json')).toBe(false);
    expect(matchGlob('main.tf', 'main.tf')).toBe(true);
    expect(matchGlob('main.tf', 'dir/main.tf')).toBe(false);
  });

  it('treats regex metacharacters literally', () => {
    expect(matchGlob('a+b(1).tf', 'a+b(1).tf')).toBe(true);
    expect(matchGlob('a.b', 'axb')).toBe(false);
  });

  it('stays fast on adversarial patterns and paths', () => {
    const path = `${'a/'.repeat(40)}${'a'.repeat(200)}.tf`;
    const start = performance.now();
    expect(matchGlob('**/**/**/*a*a*a*a*b.tf', path)).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('applies negations after the positive patterns', () => {
    const include = ['infra/**/*.tf', '!infra/legacy/**'];
    expect(matchesInclude(include, 'infra/a/main.tf')).toBe(true);
    expect(matchesInclude(include, 'infra/legacy/old.tf')).toBe(false);
    expect(matchesInclude(include, 'other/x.tf')).toBe(false);
  });

  it('finds the static directory prefix to start the walk from', () => {
    expect(globPrefix('infra/prod/**/*.tf')).toEqual(['infra', 'prod']);
    expect(globPrefix('**/*.tf')).toEqual([]);
    expect(globPrefix('main.tf')).toEqual([]);
    expect(globPrefix('a/b/main.tf')).toEqual(['a', 'b']);
    expect(globPrefix('*.tf')).toEqual([]);
  });
});
