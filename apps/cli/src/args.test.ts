import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('shows help without a command', () => {
    expect(parseArgs([])).toMatchObject({ command: 'help', help: true });
    expect(parseArgs(['--help'])).toMatchObject({ command: 'help' });
    expect(parseArgs(['check', '--help'])).toMatchObject({ command: 'check', help: true });
  });

  it('accepts repository initialization, watch and paired connector options without dropping their values', () => {
    expect(parseArgs(['init','--check','--dir','/repo'])).toMatchObject({command:'init',check:true,dir:'/repo',dirExplicit:true});
    expect(parseArgs(['watch','--dir=/repo'])).toMatchObject({command:'watch',dir:'/repo'});
    expect(parseArgs(['connect','--cloud-url','https://app.joinlet.co','--pair=ABC','--dir','/repo'])).toMatchObject({command:'connect',cloudUrl:'https://app.joinlet.co',pair:'ABC',dir:'/repo'});
    expect(parseArgs(['connect','--cloud-url','https://app.joinlet.co'])).toMatchObject({command:'connect',cloudUrl:'https://app.joinlet.co'});
    expect(parseArgs(['init','--pair','ABC'])).toHaveProperty('error');
  });

  it('parses flags, values and refs', () => {
    expect(parseArgs(['check', '--dir', '/repo', '--json'])).toMatchObject({ command: 'check', dir: '/repo', json: true });
    expect(parseArgs(['context', '--dir=/repo', '--out=.arch/ctx', '--check'])).toMatchObject({ command: 'context', dir: '/repo', out: '.arch/ctx', check: true });
    expect(parseArgs(['diff', 'main', 'feature', '--markdown'])).toMatchObject({ command: 'diff', refs: ['main', 'feature'], markdown: true });
  });

  it('parses the publish and pr-comment flags', () => {
    expect(parseArgs(['publish', '--title', 'Fila', '--body-file', 'corpo.md', '--branch', 'strukt/x', '--base', 'main', '--draft'])).toMatchObject({
      command: 'publish', title: 'Fila', bodyFile: 'corpo.md', branch: 'strukt/x', base: 'main', draft: true,
    });
    expect(parseArgs(['pr-comment', '--base', 'origin/main', '--head', 'abc', '--pr', '7'])).toMatchObject({
      command: 'pr-comment', base: 'origin/main', head: 'abc', pr: '7',
    });
    expect(parseArgs(['publish'])).toEqual({ error: 'O publish precisa de --title.' });
    expect(parseArgs(['pr-comment'])).toEqual({ error: 'O pr-comment precisa de --base (o ref base do PR).' });
  });

  it('parses --svg for diff and --artifact-url for pr-comment only', () => {
    expect(parseArgs(['diff', 'main', '--svg', 'out'])).toMatchObject({ command: 'diff', svg: 'out', refs: ['main'] });
    expect(parseArgs(['pr-comment', '--base', 'main', '--artifact-url=https://github.com/x/y/actions/runs/1'])).toMatchObject({ artifactUrl: 'https://github.com/x/y/actions/runs/1' });
    expect(parseArgs(['check', '--svg', 'out'])).toEqual({ error: 'A opção --svg só vale para o comando diff.' });
    expect(parseArgs(['diff', '--artifact-url', 'https://x.y'])).toEqual({ error: 'A opção --artifact-url só vale para o comando pr-comment.' });
  });

  it('parses site with an optional --out', () => {
    expect(parseArgs(['site'])).toMatchObject({ command: 'site' });
    expect(parseArgs(['site', '--out', 'dist-arch'])).toMatchObject({ command: 'site', out: 'dist-arch' });
    expect(parseArgs(['site', '--svg', 'x'])).toEqual({ error: 'A opção --svg só vale para o comando diff.' });
  });

  it('rejects unknown commands, unknown flags and missing values', () => {
    expect(parseArgs(['explode'])).toEqual({ error: 'Comando desconhecido: "explode".' });
    expect(parseArgs(['check', '--drift', '--strict'])).toMatchObject({ command: 'check', drift: true, strict: true });
    expect(parseArgs(['check', '--nope'])).toEqual({ error: 'Opção desconhecida: "--nope".' });
    expect(parseArgs(['check', '--dir'])).toEqual({ error: 'A opção --dir precisa de um valor.' });
    expect(parseArgs(['check', '--dir', '--json'])).toEqual({ error: 'A opção --dir precisa de um valor.' });
    expect(parseArgs(['context', '--out='])).toEqual({ error: 'A opção --out precisa de um valor.' });
    expect(parseArgs(['check', 'extra'])).toEqual({ error: 'O comando "check" não aceita argumentos posicionais.' });
    expect(parseArgs(['diff', 'a', 'b', 'c'])).toEqual({ error: 'O diff compara no máximo dois refs.' });
  });

  it('requires --drift for --strict and a "snap" subcommand for evidence', () => {
    expect(parseArgs(['check', '--strict'])).toEqual({ error: '--strict requer --drift.' });
    expect(parseArgs(['check', '--drift', '--strict'])).toMatchObject({ drift: true, strict: true });
    expect(parseArgs(['evidence', 'snap', '--dir', 'x'])).toMatchObject({ command: 'evidence', refs: ['snap'] });
    expect(parseArgs(['evidence'])).toEqual({ error: 'O evidence precisa de um subcomando: snap.' });
    expect(parseArgs(['evidence', 'zap'])).toEqual({ error: 'O evidence precisa de um subcomando: snap.' });
  });

  it('parses sync and sources', () => {
    expect(parseArgs(['sync', '--check', '--markdown', '--json'])).toMatchObject({ command: 'sync', check: true, markdown: true, json: true });
    expect(parseArgs(['sources', 'list', '--json'])).toMatchObject({ command: 'sources', refs: ['list'], json: true });
    expect(parseArgs(['sources', 'add', 'infra', '--kind', 'terraform', '--include', 'infra/**/*.tf', '--include=!infra/old/**', '--diagram', 'infra', '--mode', 'replace'])).toMatchObject({
      command: 'sources', refs: ['add', 'infra'], kind: 'terraform', include: ['infra/**/*.tf', '!infra/old/**'], diagram: 'infra', mode: 'replace',
    });
    expect(parseArgs(['sources', 'remove', 'infra'])).toMatchObject({ refs: ['remove', 'infra'] });
  });

  it('validates the sources subcommands', () => {
    expect(parseArgs(['sources'])).toEqual({ error: 'O sources precisa de um subcomando: list, add ou remove.' });
    expect(parseArgs(['sources', 'zap'])).toEqual({ error: 'O sources precisa de um subcomando: list, add ou remove.' });
    expect(parseArgs(['sources', 'list', 'x'])).toEqual({ error: 'O "sources list" não aceita argumentos.' });
    expect(parseArgs(['sources', 'remove'])).toEqual({ error: 'O "sources remove" precisa de exatamente um <id> de fonte.' });
    expect(parseArgs(['sources', 'remove', 'a', 'b'])).toEqual({ error: 'O "sources remove" precisa de exatamente um <id> de fonte.' });
    expect(parseArgs(['sources', 'add', 'x', '--kind', 'd2'])).toEqual({ error: 'O "sources add" precisa de --kind, --include (ao menos um) e --diagram.' });
    expect(parseArgs(['sources', 'remove', 'x', '--kind', 'd2'])).toEqual({ error: 'As opções --kind, --include, --diagram e --mode só valem para "sources add".' });
    expect(parseArgs(['check', '--include', 'x'])).toEqual({ error: 'As opções --kind, --include, --diagram e --mode só valem para "sources add".' });
    expect(parseArgs(['sync', 'extra'])).toEqual({ error: 'O comando "sync" não aceita argumentos posicionais.' });
  });
});
