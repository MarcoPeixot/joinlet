import { printManifest } from '@strukt/workspace';
import type { Manifest } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { mergeManifests, mergeManifestTexts } from './manifestMerge';

const manifest = (diagrams: Manifest['diagrams'], extra: Partial<Manifest> = {}): Manifest =>
  ({ version: 1, name: 'Loja', diagrams, docs: [], sketches: [], ...extra });
const slugs = (list: Manifest['diagrams']) => list.map((item) => item.slug);

describe('mergeManifests (three-way, per item)', () => {
  const base = manifest([{ slug: 'mapa', title: 'Mapa' }, { slug: 'outro', title: 'Outro' }]);

  it('keeps what both guests added, whoever wrote first', () => {
    const ana = manifest([...base.diagrams, { slug: 'do-ana', title: 'Do Ana' }]);
    const cris = manifest([...base.diagrams, { slug: 'do-cris', title: 'Do Cris' }]);
    const merged = mergeManifests(base, cris, ana);
    expect(slugs(merged.diagrams)).toEqual(['mapa', 'outro', 'do-ana', 'do-cris']);
  });

  it('a removal by either side wins over an untouched item', () => {
    const theirs = manifest([base.diagrams[0]!]);
    const mine = manifest([base.diagrams[1]!]);
    expect(slugs(mergeManifests(base, base, theirs).diagrams)).toEqual(['mapa']);
    expect(slugs(mergeManifests(base, mine, base).diagrams)).toEqual(['outro']);
    expect(slugs(mergeManifests(base, mine, theirs).diagrams)).toEqual([]);
  });

  it('a rename or move is taken from whoever changed it, mine first when both did', () => {
    const theirs = manifest([{ slug: 'mapa', title: 'Mapa novo' }, base.diagrams[1]!]);
    const mine = manifest([base.diagrams[0]!, { slug: 'outro', title: 'Outro', folder: 'Arquivo' }]);
    const merged = mergeManifests(base, mine, theirs);
    expect(merged.diagrams).toEqual([{ slug: 'mapa', title: 'Mapa novo' }, { slug: 'outro', title: 'Outro', folder: 'Arquivo' }]);
    const both = mergeManifests(base, manifest([{ slug: 'mapa', title: 'Meu' }, base.diagrams[1]!]), theirs);
    expect(both.diagrams[0]!.title).toBe('Meu');
  });

  it('takes the other side order and appends what is only mine', () => {
    const theirs = manifest([base.diagrams[1]!, base.diagrams[0]!]);
    const mine = manifest([...base.diagrams, { slug: 'novo', title: 'Novo' }]);
    expect(slugs(mergeManifests(base, mine, theirs).diagrams)).toEqual(['outro', 'mapa', 'novo']);
  });

  it('merges docs, sketches, the workspace name and the empty folders independently', () => {
    const theirs = manifest(base.diagrams, { name: 'Loja nova', docs: [{ slug: 'notas', title: 'Notas' }], folders: { docs: ['A'] } });
    const mine = manifest(base.diagrams, { sketches: [{ slug: 'rascunho', title: 'Rascunho' }], folders: { docs: ['B'] } });
    const merged = mergeManifests(base, mine, theirs);
    expect(merged.name).toBe('Loja nova');
    expect(merged.docs.map((item) => item.slug)).toEqual(['notas']);
    expect(merged.sketches.map((item) => item.slug)).toEqual(['rascunho']);
    expect(merged.folders?.docs).toEqual(['A', 'B']);
  });

  it('without a base, everything on either side is kept', () => {
    const merged = mergeManifests(null, manifest([{ slug: 'a', title: 'A' }]), manifest([{ slug: 'b', title: 'B' }]));
    expect(slugs(merged.diagrams)).toEqual(['b', 'a']);
  });
});

describe('mergeManifestTexts', () => {
  it('prints the canonical text, and falls back to mine when the other side is not a manifest', () => {
    const base = manifest([{ slug: 'mapa', title: 'Mapa' }]);
    const mine = manifest([{ slug: 'mapa', title: 'Mapa' }, { slug: 'x', title: 'X' }]);
    expect(mergeManifestTexts(printManifest(base), printManifest(mine), printManifest(base))).toBe(printManifest(mine));
    expect(mergeManifestTexts(printManifest(base), printManifest(mine), 'não é json')).toBe(printManifest(mine));
  });
});

it('merges workspace identity independently and preserves explicit logo removal', () => {
  const base = manifest([], { description: 'Before', logo: 'data:image/png;base64,AAAA' });
  const mine = { ...base, description: 'After' };
  const theirs = { ...base, logo: 'data:image/webp;base64,AAAA' };
  expect(mergeManifests(base, mine, theirs)).toMatchObject({ description: 'After', logo: theirs.logo });
  delete mine.logo;
  expect(mergeManifests(base, mine, theirs).logo).toBeUndefined();
});
