import * as simple from 'simple-icons';
import { describe, expect, it } from 'vitest';
import index from './simple-index.json';

/** The picker lists brands from `simple-index.json` instead of loading the whole package: it must not drift from it. */
describe('simple-index.json', () => {
  it('lists every brand of the installed simple-icons, with its title, in the package order', () => {
    const brands = (Object.values(simple) as unknown[])
      .filter((value): value is { slug: string; title: string } => !!value && typeof value === 'object' && 'slug' in value && 'path' in value && 'hex' in value && 'title' in value)
      .map(({ slug, title }) => [slug, title]);
    expect(index, 'regenerate with `cd apps/web && bun scripts/build-icon-subset.ts --index`').toEqual(brands);
  });
});
