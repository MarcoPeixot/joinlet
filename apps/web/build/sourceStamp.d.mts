export const STAMP_FILE: string;
/** `repoRoot`: an absolute path or a `file:` URL of the repository root. */
export function sourceFiles(repoRoot: string): string[];
export function sourceHash(repoRoot: string): string;
export function staleReason(stampText: string | undefined, currentHash: string): string | null;
export function sourceStampPlugin(repoRoot: string): { name: string; apply: 'build'; [hook: string]: unknown };
