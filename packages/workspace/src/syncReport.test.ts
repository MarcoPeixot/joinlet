import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './storage';
import { addItem, newWorkspace, workspaceFiles } from './workspace';
import { SOURCES_PATH, printSources } from './sources';
import type { Source } from './sources';
import { planSync, renderSyncReport } from './sync';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const infra: Source = { id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'merge' };

async function setup(files: Record<string, string>, sources: Source[] | string | null = [infra]) {
  const root = await mkdtemp(join(tmpdir(), 'strukt-sync-report-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  }
  const data = addItem(newWorkspace('Loja'), 'diagram', 'Infra').data;
  const adapter = createMemoryAdapter(workspaceFiles(data));
  if (sources !== null) adapter.files.set(SOURCES_PATH, typeof sources === 'string' ? sources : printSources(sources));
  return { root, data, adapter };
}

async function plan(files: Record<string, string>, sources: Source[] | string | null = [infra]) {
  return planSync(await setup(files, sources));
}

const MAIN = 'resource "aws_instance" "web" {\n  subnet_id = aws_subnet.a.id\n}\nresource "aws_subnet" "a" {\n}\nmodule "m" {\n  source = "./m"\n}\n';

describe('renderSyncReport', () => {
  it('explains that nothing is configured', async () => {
    expect(renderSyncReport(await plan({}, null))).toContain('Nenhuma fonte configurada');
  });

  it('lists the problems of an invalid sources file', async () => {
    const text = renderSyncReport(await plan({}, '{"version":1,"sources":[{"id":"x"}]}'));
    expect(text).toContain('sources.json: sources[0]');
  });

  it('shows sources, changes, importer warnings and the verdict (text)', async () => {
    const text = renderSyncReport(await plan({ 'infra/main.tf': MAIN }));
    expect(text).toContain('Fontes');
    expect(text).toContain('infra: terraform → infra (merge), 1 arquivo');
    expect(text).toContain('+ aws_instance.web');
    expect(text).toContain('+ conexão aws_instance.web → aws_subnet.a');
    expect(text).toContain('Avisos dos importadores');
    expect(text).toContain('infra: infra/main.tf:');
    expect(text).toContain('Desatualizado: infra.');
  });

  it('renders Markdown with code spans and escapes backticks', async () => {
    const text = renderSyncReport(await plan({ 'infra/main.tf': MAIN }), 'markdown');
    expect(text).toContain('## Sincronização de fontes');
    expect(text).toContain('- + `aws_instance.web`');
    expect(text).not.toMatch(/`[^`\n]*`[^`\n]*`[^`\n]*`.*``/);
  });

  it('shows the blocked source and caps long lists', async () => {
    const blocked = renderSyncReport(await plan({ 'a.txt': '' }));
    expect(blocked).toContain('ERRO — Nenhum arquivo casa');
    expect(blocked).toContain('não sincronizado');
    expect(blocked).toContain('impede a sincronização completa');
    const many = Array.from({ length: 40 }, (_, i) => `resource "aws_s3_bucket" "b${i}" {\n}\n`).join('');
    expect(renderSyncReport(await plan({ 'infra/main.tf': many }))).toContain('… e mais 10');
  });

  it('says everything is up to date when nothing would change', async () => {
    const env = await setup({ 'infra/main.tf': MAIN });
    const first = await planSync(env);
    expect(first.stale).toBe(true);
    env.adapter.files.set('sync.json', first.state.text);
    const data = { ...env.data, diagrams: { ...env.data.diagrams, infra: { ...env.data.diagrams.infra!, model: first.diagrams[0]!.model } } };
    const text = renderSyncReport(await planSync({ ...env, data }));
    expect(text).toContain('em dia com as fontes');
    expect(text).toContain('Tudo em dia com as fontes.');
  });
});
