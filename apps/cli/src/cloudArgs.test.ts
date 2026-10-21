import { describe, expect, it } from 'vitest';
import { USAGE, parseArgs } from './args';

describe('import cloud and check --cloud arguments', () => {
  it('parses a provider import with its scope', () => {
    expect(parseArgs(['import', 'cloud', '--provider', 'aws', '--profile', 'prod', '--region', 'us-east-1', '--title', 'Produção'])).toMatchObject({
      command: 'import', refs: ['cloud'], provider: 'aws', profile: 'prod', region: 'us-east-1', title: 'Produção',
    });
    expect(parseArgs(['import', 'cloud', '--provider=azure', '--subscription=sub', '--resource-group=rg'])).toMatchObject({ provider: 'azure', subscription: 'sub', resourceGroup: 'rg' });
    expect(parseArgs(['import', 'cloud', '--provider', 'gcp', '--project', 'shop-prod-123456'])).toMatchObject({ provider: 'gcp', project: 'shop-prod-123456' });
  });

  it('parses a Terraform file import', () => {
    expect(parseArgs(['import', 'cloud', '--file', 'state.json'])).toMatchObject({ command: 'import', file: 'state.json' });
  });

  it('needs the cloud subcommand and exactly one of --provider and --file', () => {
    expect(parseArgs(['import'])).toEqual({ error: 'O import precisa de um subcomando: cloud.' });
    expect(parseArgs(['import', 'terraform', '--file', 'x'])).toEqual({ error: 'O import precisa de um subcomando: cloud.' });
    expect(parseArgs(['import', 'cloud'])).toEqual({ error: expect.stringContaining('exatamente um entre --provider') });
    expect(parseArgs(['import', 'cloud', '--provider', 'aws', '--file', 'x'])).toEqual({ error: expect.stringContaining('exatamente um entre --provider') });
    expect(parseArgs(['import', 'cloud', '--provider', 'oracle'])).toEqual({ error: 'Provedor inválido: "oracle". Use aws, azure ou gcp.' });
    expect(parseArgs(['import', 'cloud', '--file', 'x', '--region', 'us-east-1'])).toEqual({ error: expect.stringContaining('Com --file') });
  });

  it('parses check --cloud for a provider or a file, and lets --strict stand on --cloud alone', () => {
    expect(parseArgs(['check', '--cloud', 'aws', '--region', 'us-east-1'])).toMatchObject({ command: 'check', cloud: 'aws', region: 'us-east-1' });
    expect(parseArgs(['check', '--cloud', 'live.json', '--strict'])).toMatchObject({ cloud: 'live.json', strict: true });
    expect(parseArgs(['check', '--strict'])).toEqual({ error: '--strict requer --drift.' });
  });

  it('keeps the new options out of other commands', () => {
    expect(parseArgs(['check', '--region', 'us-east-1'])).toEqual({ error: expect.stringContaining('só valem para "import cloud" e "check --cloud"') });
    expect(parseArgs(['list', '--profile', 'p'])).toEqual({ error: expect.stringContaining('só valem') });
    expect(parseArgs(['check', '--cloud', 'aws', '--provider', 'aws'])).toEqual({ error: expect.stringContaining('--cloud') });
    expect(parseArgs(['list', '--cloud', 'aws'])).toEqual({ error: 'A opção --cloud só vale para o comando check.' });
    expect(parseArgs(['list', '--file', 'x'])).toEqual({ error: 'A opção --file só vale para "import cloud".' });
  });

  it('refuses a flag value that looks like another flag, so it can never be smuggled in as a value', () => {
    expect(parseArgs(['import', 'cloud', '--provider', 'aws', '--profile', '--endpoint-url'])).toEqual({ error: 'A opção --profile precisa de um valor.' });
  });

  it('documents both commands in the help text', () => {
    expect(USAGE).toContain('import cloud --provider aws|azure|gcp');
    expect(USAGE).toContain('check --cloud aws|azure|gcp|<arquivo>');
  });
});
