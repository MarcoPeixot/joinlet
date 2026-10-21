/**
 * Regenerates `src/diagram/icons/lucide-categories.json` (icon name → category id) for the icon picker.
 * Run from `apps/web` after updating `lucide`:
 *
 *   bun scripts/build-lucide-categories.ts
 *
 * The category of each name comes from the heuristic in `src/diagram/icons/lucideCategorize.ts`.
 * Every name is a canonical icon file of the installed `lucide` (aliases are left out) that the registry
 * resolves (`pascal(name)` is a key of `icons`).
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { icons } from 'lucide';
import { categorize } from '../src/diagram/icons/lucideCategorize';

const pascal = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

if (import.meta.main) {
  const dir = new URL('../node_modules/lucide/dist/esm/icons/', import.meta.url);
  const names = readdirSync(dir)
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => file.slice(0, -'.mjs'.length))
    .filter((name) => Object.hasOwn(icons, pascal(name)))
    .sort();
  const categories = Object.fromEntries(names.map((name) => [name, categorize(name)]));
  const out = new URL('../src/diagram/icons/lucide-categories.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(categories, null, 1)}\n`);
  const counts: Record<string, number> = {};
  for (const category of Object.values(categories)) counts[category] = (counts[category] ?? 0) + 1;
  console.log(`lucide-categories.json: ${names.length} icons`, counts);
}
