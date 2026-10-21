import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, readSettings, SETTING_KEYS } from './commands';

interface Manifest {
  main: string;
  activationEvents: string[];
  contributes: { commands: { command: string; title: string }[]; configuration: { properties: Record<string, { scope?: string; default?: unknown }> } };
  capabilities: { untrustedWorkspaces: { supported: unknown } };
}
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest;

describe('package.json (the extension manifest)', () => {
  it('contributes exactly the commands the code registers, titled in pt-BR', () => {
    expect(manifest.contributes.commands.map((c) => c.command)).toEqual([...COMMAND_IDS]);
    expect(manifest.contributes.commands.map((c) => c.title)).toEqual(['Joinlet: Validar workspace', 'Joinlet: Diff contra HEAD', 'Joinlet: Abrir no Joinlet']);
  });

  it('declares every setting the code reads, and nothing else', () => {
    expect(Object.keys(manifest.contributes.configuration.properties).sort()).toEqual(SETTING_KEYS.map((key) => `strukt.${key}`).sort());
  });

  it('keeps what the extension executes out of workspace settings (a repo must not pick the binary)', () => {
    const { properties } = manifest.contributes.configuration;
    expect(properties['strukt.cli.path']!.scope).toBe('machine');
    expect(properties['strukt.cli.args']!.scope).toBe('machine');
  });

  it('runs in limited mode in untrusted folders and loads the bundle produced by `bun run build`', () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(manifest.main).toBe('./dist/extension.cjs');
    expect(manifest.activationEvents).toEqual(['workspaceContains:.arch/strukt.json']);
  });
});

describe('readSettings', () => {
  it('maps the package.json defaults to the runtime defaults', () => {
    const { properties } = manifest.contributes.configuration;
    const settings = readSettings((key) => properties[`strukt.${key}`]!.default as never);
    expect(settings).toEqual({ cli: { path: 'strukt', args: [] }, appUrl: 'http://localhost:5178', diffRef: 'HEAD', drift: false, strict: false });
  });

  it('survives values of the wrong type (settings.json is hand-edited)', () => {
    const settings = readSettings((key) => ({ 'cli.path': 7, 'cli.args': 'x', diffRef: 3, 'check.drift': 'yes' })[key as string] as never);
    expect(settings).toMatchObject({ cli: { path: 'strukt', args: [] }, diffRef: 'HEAD', drift: false });
  });
});
