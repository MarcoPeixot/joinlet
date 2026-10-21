/** `<root>/.arch/strukt.json` → `<root>`; anything else is not a Joinlet manifest. */
export function rootOfManifest(manifestPath: string): string | null {
  const match = /^(.*)[\\/]\.arch[\\/]strukt\.json$/s.exec(manifestPath);
  if (!match) return null;
  return match[1] === '' ? '/' : match[1]!;
}

/** Distinct workspace roots of the manifests found in the editor, in the order they came. */
export function workspaceRoots(manifestPaths: readonly string[]): string[] {
  const roots: string[] = [];
  for (const path of manifestPaths) {
    const root = rootOfManifest(path);
    if (root !== null && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

const slashed = (path: string) => path.replace(/\\/g, '/');

/** The deepest root that contains `file` (a sibling that merely shares a prefix does not count). */
export function pickRoot(roots: readonly string[], file: string | undefined): string | null {
  if (!file) return null;
  const target = slashed(file);
  let best: string | null = null;
  for (const root of roots) {
    const base = slashed(root);
    const prefix = base.endsWith('/') ? base : `${base}/`;
    if (target !== base && !target.startsWith(prefix)) continue;
    if (best === null || base.length > slashed(best).length) best = root;
  }
  return best;
}

/**
 * A path the CLI reported (relative to `.arch/`), normalised to forward slashes, or null when it could leave `.arch/`.
 * The report is data from another process: never trust it as a path.
 */
export function archRelative(path: string): string | null {
  if (!path || path.includes('\0') || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  if (!parts.length || parts.some((part) => part === '..' || part === '__proto__')) return null;
  return parts.join('/');
}
