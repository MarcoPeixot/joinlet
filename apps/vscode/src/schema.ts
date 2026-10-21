/** Diagram documents are `<slug>.strukt.json`; the manifest (`strukt.json`), layouts and the board use other shapes. */
export const DIAGRAM_FILE_MATCH = ['*.strukt.json'];

/** Bundled copy of the schema in `@strukt/json` (written by `bun run schema`, checked byte for byte in the tests). */
export const SCHEMA_URL = './schemas/strukt.schema.json';

const SUFFIX = '.strukt.json';

export function isDiagramFile(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name.length > SUFFIX.length && name.endsWith(SUFFIX);
}

/** The `contributes.jsonValidation` entry of `package.json` (a test keeps both in sync). */
export function jsonValidation(): { fileMatch: string[]; url: string }[] {
  return [{ fileMatch: DIAGRAM_FILE_MATCH, url: SCHEMA_URL }];
}
