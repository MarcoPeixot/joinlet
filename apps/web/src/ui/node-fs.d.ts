// The web package has no @types/node; contrast.test.ts only needs readFileSync.
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
