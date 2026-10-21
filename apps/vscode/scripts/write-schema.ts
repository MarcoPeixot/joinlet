import { writeFile } from 'node:fs/promises';
import { printDiagramJsonSchema } from '@strukt/json';

/** Regenerates `schemas/strukt.schema.json` from the single schema source in `@strukt/json`. */
await writeFile(new URL('../schemas/strukt.schema.json', import.meta.url), printDiagramJsonSchema(), 'utf8');
