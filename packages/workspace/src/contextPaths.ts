import type { Manifest } from './manifest';

/**
 * Where the generated agent context lives. Kept apart from the generator (`context.ts`, ~16 KB) so the app can
 * know which files are generated without loading the generator, which only runs once context is enabled.
 */
export const CONTEXT_DIR = 'context';
export const ARCHITECTURE_PATH = `${CONTEXT_DIR}/ARCHITECTURE.md`;
export const LLMS_PATH = `${CONTEXT_DIR}/llms.txt`;
export const contextDiagramPath = (slug: string) => `${CONTEXT_DIR}/diagrams/${slug}.md`;

/** The files the generator writes for this manifest. */
export function contextPaths(manifest: Manifest): string[] {
  return [ARCHITECTURE_PATH, LLMS_PATH, ...manifest.diagrams.map(({ slug }) => contextDiagramPath(slug))];
}

/** A path the generator owns (anything else in `context/` belongs to the user and is left alone). */
export function isContextFile(path: string): boolean {
  return path === ARCHITECTURE_PATH || path === LLMS_PATH || /^context\/diagrams\/[^/]+\.md$/.test(path);
}
