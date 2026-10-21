import { describe, expect, it } from 'vitest';
import { buildCheckInvocation, buildDiffInvocation, normalizeCliSettings, validateRef } from './cli';

const settings = { path: 'strukt', args: [] as string[] };

describe('normalizeCliSettings', () => {
  it('defaults to the strukt binary', () => {
    expect(normalizeCliSettings({})).toEqual({ path: 'strukt', args: [] });
  });

  it('keeps a configured path and string args only', () => {
    expect(normalizeCliSettings({ path: ' bun ', args: ['/x/main.ts', 3, null] })).toEqual({ path: 'bun', args: ['/x/main.ts'] });
  });

  it('falls back when the values have the wrong type or are blank', () => {
    expect(normalizeCliSettings({ path: 42, args: 'nope' })).toEqual({ path: 'strukt', args: [] });
    expect(normalizeCliSettings({ path: '   ' })).toEqual({ path: 'strukt', args: [] });
  });
});

describe('buildCheckInvocation', () => {
  it('asks for the JSON report of one workspace root, no shell', () => {
    expect(buildCheckInvocation(settings, '/repo', { drift: false })).toEqual({ command: 'strukt', args: ['check', '--json', '--dir=/repo'], cwd: '/repo' });
  });

  it('adds --drift on request', () => {
    expect(buildCheckInvocation(settings, '/repo', { drift: true }).args).toEqual(['check', '--json', '--drift', '--dir=/repo']);
  });

  it('strict implies drift (the CLI refuses --strict alone)', () => {
    expect(buildCheckInvocation(settings, '/repo', { drift: false, strict: true }).args).toEqual(['check', '--json', '--drift', '--strict', '--dir=/repo']);
  });

  it('puts the configured launcher args before the command', () => {
    const inv = buildCheckInvocation({ path: 'bun', args: ['/s/apps/cli/src/main.ts'] }, '/repo', { drift: false });
    expect(inv).toMatchObject({ command: 'bun', args: ['/s/apps/cli/src/main.ts', 'check', '--json', '--dir=/repo'] });
  });

  it('passes a root that looks like a flag as a single --dir= value', () => {
    expect(buildCheckInvocation(settings, '-rf', { drift: false }).args).toContain('--dir=-rf');
  });
});

describe('buildDiffInvocation', () => {
  it('compares the ref with the working tree as Markdown', () => {
    expect(buildDiffInvocation(settings, '/repo', 'HEAD')).toEqual({ command: 'strukt', args: ['diff', 'HEAD', '--markdown', '--dir=/repo'], cwd: '/repo' });
  });
});

describe('validateRef', () => {
  it('accepts common refs', () => {
    for (const ref of ['HEAD', 'main', 'origin/main', 'HEAD~2', 'v1.2.3', 'feature/x-y', 'abc1234', 'HEAD^', 'stash@{0}']) expect(validateRef(ref)).toBeNull();
  });

  it('refuses flags, whitespace, control chars and empty refs', () => {
    for (const ref of ['', '  ', '--output=x', '-h', 'a b', 'a\nb', 'a\0b', '..', 'a..b']) expect(validateRef(ref)).toEqual(expect.any(String));
  });
});
