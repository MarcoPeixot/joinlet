import { RESERVED_NAME } from '@strukt/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MANIFEST_PATH } from './manifest';

/** Zip entries come from outside: no absolute paths, no `.`/`..` segments, nothing that could name a prototype. */
function safePath(path: string): boolean {
  const parts = path.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..' && part !== RESERVED_NAME && !part.includes('\\'));
}

/** Zips workspace files under `.arch/` (the same layout as a folder workspace). */
export function zipFiles(files: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[`.arch/${path}`] = strToU8(text);
  return zipSync(entries, { level: 6 });
}

/** A zip this small can only hold a workspace; anything past these limits is rejected outright. */
export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const ZIP_TOO_BIG = 'O .zip é grande demais para importar (limite: 64 MB, 16 MB por arquivo, 2000 arquivos).';

/** Reads a workspace zip: files relative to the folder that holds `strukt.json` (with or without `.arch/`). */
export function unzipFiles(bytes: Uint8Array): Record<string, string> {
  let entries: Record<string, Uint8Array>;
  // fflate sizes each entry's output buffer from its declared (pre-decompression) size, so
  // rejecting entries in the filter — before they are inflated — is what bounds memory here.
  let tooBig = false;
  let count = 0;
  let total = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        count += 1;
        total += file.originalSize;
        if (count > ZIP_MAX_ENTRIES || file.originalSize > ZIP_MAX_FILE_BYTES || total > ZIP_MAX_TOTAL_BYTES) {
          tooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new Error('O arquivo não é um .zip válido.');
  }
  if (tooBig) throw new Error(ZIP_TOO_BIG);
  const manifests = Object.keys(entries)
    .filter((path) => (path === MANIFEST_PATH || path.endsWith(`/${MANIFEST_PATH}`)) && !path.startsWith('__MACOSX/'))
    .sort((a, b) => a.length - b.length);
  if (!manifests.length) throw new Error('O .zip não contém um workspace do Joinlet (strukt.json).');
  const prefix = manifests[0]!.slice(0, -MANIFEST_PATH.length);
  const files = Object.entries(entries).flatMap(([path, data]): [string, string][] => {
    if (!path.startsWith(prefix) || path.endsWith('/')) return [];
    const relative = path.slice(prefix.length);
    return safePath(relative) ? [[relative, strFromU8(data)]] : [];
  });
  return Object.fromEntries(files);
}
