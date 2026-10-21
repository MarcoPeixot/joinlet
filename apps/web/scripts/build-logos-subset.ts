/**
 * Regenerates `src/diagram/icons/logos-subset.json`, the part of @iconify-json/logos (SVG Logos, CC0) the
 * icon registry reaches: cloud provider icons and the brands lucide and simple-icons lack. The full set is
 * ~7.7 MB of JavaScript. Run from `apps/web` after changing the lists or updating the package:
 *
 *   bun scripts/build-logos-subset.ts
 */
import { writeFileSync } from 'node:fs';
import { icons as full } from '@iconify-json/logos';
import type { IconifyJSON } from '@iconify-json/logos';

/** Every icon named `prefix` or `prefix-…`: AWS/GCP/Azure services and the provider fallbacks. */
const PREFIXES = ['aws', 'azure', 'google-cloud', 'microsoft-azure', 'kubernetes'];
/** Brands that only logos has (Eraser examples use some), with their square `-icon` mark. */
const BRANDS = ['slack', 'oracle', 'tableau', 'twitter'];

const wanted = (name: string) =>
  PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`)) || BRANDS.some((brand) => name === brand || name === `${brand}-icon`);

const icons = Object.fromEntries(Object.keys(full.icons).filter(wanted).sort().map((name) => [name, full.icons[name]!]));
const aliases = Object.fromEntries(Object.entries(full.aliases ?? {}).filter(([, alias]) => Object.hasOwn(icons, alias.parent)));
const subset: IconifyJSON = {
  prefix: full.prefix,
  width: full.width,
  height: full.height,
  icons,
  ...(Object.keys(aliases).length ? { aliases } : {}),
};

const out = new URL('../src/diagram/icons/logos-subset.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(subset, null, 2)}\n`);
console.log(`logos-subset.json: ${Object.keys(icons).length} of ${Object.keys(full.icons).length} icons`);
