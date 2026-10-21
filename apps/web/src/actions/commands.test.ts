import { describe, expect, it } from 'vitest';
import { buildCommands, COMMAND_SECTIONS } from './commands';

const item = (slug: string, title: string) => ({ slug, title });
const build = () =>
  buildCommands({
    center: () => ({ x: 0, y: 0 }),
    flowAnimation: false,
    items: { diagram: [item('api', 'API'), item('constructor', 'Hostil')], doc: [item('guia', 'Guia')], sketch: [item('rascunho', 'Rascunho')] },
  });

describe('buildCommands', () => {
  const commands = build();
  const ids = commands.map((c) => c.id);

  it('gives every command one of the four sections and unique ids', () => {
    expect(COMMAND_SECTIONS).toEqual(['Ações', 'Ir para', 'Aparência', 'IA']);
    for (const c of commands) expect(COMMAND_SECTIONS).toContain(c.section);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('sections hold the expected commands', () => {
    const section = (id: string) => commands.find((c) => c.id === id)?.section;
    expect(section('add-node')).toBe('Ações');
    expect(section(ids.find((i) => i.startsWith('color-'))!)).toBe('Aparência');
    expect(section('theme')).toBe('Aparência');
    expect(section('ai')).toBe('IA');
    expect(section('doc')).toBe('IA');
  });
  it('has an "Ir para" command per diagram, doc, sketch, the board and each panel', () => {
    const goto = commands.filter((c) => c.section === 'Ir para');
    const titles = goto.map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(['Diagrama: API', 'Diagrama: Hostil', 'Documento: Guia', 'Sketch: Rascunho', 'Overview']));
    for (const panel of ['Código', 'Versões', 'Fluxos', 'Modelo', 'Perspectivas', 'Precisão', 'GitHub']) expect(titles).toContain(`Painel: ${panel}`);
  });
  it('offers Mermaid and PlantUML exports in Ações', () => {
    for (const [id, title] of [['export-mermaid', 'Exportar: Mermaid'], ['export-plantuml', 'Exportar: PlantUML']] as const) {
      expect(commands.find((c) => c.id === id)).toMatchObject({ title, section: 'Ações' });
    }
  });
  it('keeps what left the top bar and the zoom corner one search away', () => {
    for (const id of ['theme', 'minimap', 'present', 'export-svg', 'export-png', 'export-mermaid', 'export-plantuml', 'settings', 'tour']) expect(ids).toContain(id);
    expect(commands.find((c) => c.id === 'minimap')).toMatchObject({ title: 'Mostrar/ocultar minimapa', section: 'Aparência' });
  });
  it('works without workspace items', () => {
    expect(() => buildCommands({ center: () => ({ x: 0, y: 0 }), flowAnimation: true })).not.toThrow();
  });

  it('reaches the perspectives panel and the C4 level suggestions from the palette', () => {
    expect(commands.find((c) => c.id === 'panel-perspectives')).toMatchObject({ title: 'Painel: Perspectivas', section: 'Ir para' });
    expect(commands.find((c) => c.id === 'suggest-levels')).toMatchObject({ title: 'Sugerir níveis C4', section: 'Ações' });
  });
});
