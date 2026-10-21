import { describe, expect, it } from 'vitest';
import { archRelative, pickRoot, rootOfManifest, workspaceRoots } from './workspaceRoots';

describe('rootOfManifest', () => {
  it('is the folder that holds .arch/', () => {
    expect(rootOfManifest('/repo/.arch/strukt.json')).toBe('/repo');
    expect(rootOfManifest('/repo/pkg/a/.arch/strukt.json')).toBe('/repo/pkg/a');
    expect(rootOfManifest('C:\\repo\\.arch\\strukt.json')).toBe('C:\\repo');
  });

  it('refuses anything that is not <root>/.arch/strukt.json', () => {
    expect(rootOfManifest('/repo/strukt.json')).toBeNull();
    expect(rootOfManifest('/repo/.arch/diagrams/strukt.json')).toBeNull();
    expect(rootOfManifest('/.arch/strukt.json')).toBe('/');
  });
});

describe('workspaceRoots', () => {
  it('dedupes and keeps order', () => {
    expect(workspaceRoots(['/b/.arch/strukt.json', '/a/.arch/strukt.json', '/b/.arch/strukt.json', '/x/other.json'])).toEqual(['/b', '/a']);
  });
});

describe('archRelative', () => {
  it('normalises a path reported by the CLI', () => {
    expect(archRelative('diagrams/a.strukt.json')).toBe('diagrams/a.strukt.json');
    expect(archRelative('./diagrams//a.strukt.json')).toBe('diagrams/a.strukt.json');
    expect(archRelative('diagrams\\a.strukt.json')).toBe('diagrams/a.strukt.json');
  });

  it('refuses anything that could leave .arch/', () => {
    for (const bad of ['', '..', '../x', 'a/../../x', '/etc/passwd', '\\x', 'C:/x', 'C:\\x', 'a\0b', '__proto__']) expect(archRelative(bad)).toBeNull();
  });
});


describe('pickRoot', () => {
  const roots = ['/repo', '/repo/pkg/a', '/other'];

  it('prefers the deepest root that contains the active file', () => {
    expect(pickRoot(roots, '/repo/pkg/a/.arch/diagrams/x.strukt.json')).toBe('/repo/pkg/a');
    expect(pickRoot(roots, '/repo/src/index.ts')).toBe('/repo');
  });

  it('does not confuse sibling folders that share a prefix', () => {
    expect(pickRoot(['/repo', '/repo-two'], '/repo-two/x')).toBe('/repo-two');
    expect(pickRoot(['/repo'], '/repository/x')).toBeNull();
  });

  it('returns null when nothing matches or there is no active file', () => {
    expect(pickRoot(roots, '/elsewhere/x')).toBeNull();
    expect(pickRoot(roots, undefined)).toBeNull();
  });
});
