import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './storage';
import { loadWorkspace, newWorkspace, workspaceFiles } from './workspace';
import { ASSISTANTS_PATH, MAX_ASSISTANTS, printAssistants } from './assistants';
import { newAssistantId, parseAssistants, validateAssistants } from './assistantsParse';
import { BUILTIN_ASSISTANTS, allAssistants } from './assistantsBuiltin';
import type { Assistant } from './assistants';

const saved: Assistant = { id: 'custo', name: 'Revisar custos', instruction: 'Aponte onde o desenho gera custo desnecessário.', scope: 'workspace' };

describe('assistants.json', () => {
  it('lives at the root of .arch/', () => {
    expect(ASSISTANTS_PATH).toBe('assistants.json');
  });

  it('round trips, with keys in a fixed order so the file diffs well in git', () => {
    const text = printAssistants([saved, { id: 'b', name: 'B', instruction: 'x', scope: 'diagram', changes: true }]);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ version: 1, assistants: [saved, { id: 'b', name: 'B', instruction: 'x', scope: 'diagram', changes: true }] });
    expect(parseAssistants(text)).toEqual([saved, { id: 'b', name: 'B', instruction: 'x', scope: 'diagram', changes: true }]);
    expect(printAssistants(parseAssistants(text))).toBe(text);
  });

  it('is tolerant: broken, empty or foreign files are no assistants, never an error', () => {
    for (const text of [null, '', '{nope', 'null', '42', '"x"', '{}', '{"version":1}', '{"assistants":"x"}', '[1,2,null]']) expect(parseAssistants(text)).toEqual([]);
  });

  it('accepts a bare list and a missing version (hand-written files)', () => {
    expect(parseAssistants(JSON.stringify([saved]))).toEqual([saved]);
    expect(parseAssistants(JSON.stringify({ assistants: [saved] }))).toEqual([saved]);
  });

  it('skips only the bad entries and normalizes the rest', () => {
    const text = JSON.stringify({
      version: 1,
      assistants: [
        saved,
        { id: 'sem-nome', instruction: 'x' },
        { id: 'sem-instrucao', name: 'X' },
        { id: 'vazio', name: '  ', instruction: 'x' },
        { id: 'ok-1', name: '  Aparado  ', instruction: '  texto  ', scope: 'galaxia' },
        { id: 'ok-2', name: 'Dois', instruction: 'y', scope: 'workspace', changes: 'sim' },
        'texto',
        null,
      ],
    });
    expect(parseAssistants(text)).toEqual([
      saved,
      { id: 'ok-1', name: 'Aparado', instruction: 'texto', scope: 'diagram' },
      { id: 'ok-2', name: 'Dois', instruction: 'y', scope: 'workspace' },
    ]);
  });

  it('gives an entry without a usable id one derived from its name, and keeps ids unique', () => {
    const list = parseAssistants(JSON.stringify([{ name: 'Revisão Rápida', instruction: 'a' }, { name: 'Revisão Rápida', instruction: 'b' }, { id: '../../x', name: 'Fuga', instruction: 'c' }, { id: 'custo', name: 'A', instruction: 'd' }, { id: 'custo', name: 'B', instruction: 'e' }]));
    expect(list.map((item) => item.id)).toEqual(['revisao-rapida', 'revisao-rapida-2', 'fuga', 'custo', 'custo-2']);
  });

  it('reserves the builtin- prefix: a saved assistant cannot take a built-in id', () => {
    const [first] = parseAssistants(JSON.stringify([{ id: 'builtin-spof', name: 'Falso', instruction: 'x' }]));
    expect(first!.id).not.toMatch(/^builtin-/);
    expect(first!.name).toBe('Falso');
  });

  it('bounds names, instructions and the list', () => {
    const [one] = parseAssistants(JSON.stringify([{ id: 'a', name: 'n'.repeat(500), instruction: 'i'.repeat(20_000) }]));
    expect(one!.name).toHaveLength(60);
    expect(one!.instruction).toHaveLength(4_000);
    const many = Array.from({ length: MAX_ASSISTANTS + 25 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, instruction: 'x' }));
    expect(parseAssistants(JSON.stringify(many))).toHaveLength(MAX_ASSISTANTS);
    expect(parseAssistants(`[${'{"name":"a","instruction":"b"},'.repeat(40_000)}{}]`)).toHaveLength(MAX_ASSISTANTS);
    expect(parseAssistants(`[${'{},'.repeat(2_000_000)}{}]`)).toEqual([]);
  });

  it('never turns a hostile key into data: __proto__ and extra fields are dropped', () => {
    const raw = '{"version":1,"assistants":[{"id":"a","name":"A","instruction":"x","__proto__":{"polluted":true},"extra":1,"constructor":{"x":1}}]}';
    const [item] = parseAssistants(raw);
    expect(item).toEqual({ id: 'a', name: 'A', instruction: 'x', scope: 'diagram' });
    expect(Object.keys(item!)).toEqual(['id', 'name', 'instruction', 'scope']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips control characters from names', () => {
    expect(parseAssistants(JSON.stringify([{ id: 'a', name: 'A\u0000‮B\nC', instruction: 'x' }]))[0]!.name).toBe('AB C');
  });
});

describe('validateAssistants (what the editor refuses to save)', () => {
  it('accepts a good list', () => {
    expect(validateAssistants([saved])).toBeNull();
  });

  it('explains in pt-BR what is wrong', () => {
    expect(validateAssistants([{ ...saved, name: ' ' }])).toBe('Dê um nome ao assistente.');
    expect(validateAssistants([{ ...saved, instruction: '' }])).toBe('Escreva a instrução do assistente.');
    expect(validateAssistants([{ ...saved, name: 'x'.repeat(61) }])).toBe('O nome passa de 60 caracteres.');
    expect(validateAssistants([{ ...saved, instruction: 'x'.repeat(4_001) }])).toBe('A instrução passa de 4000 caracteres.');
    expect(validateAssistants([saved, { ...saved, name: 'Outro' }])).toBe('Há dois assistentes com o mesmo id.');
    expect(validateAssistants([{ ...saved, id: 'builtin-x' }])).toBe('O id "builtin-x" é reservado.');
    expect(validateAssistants([{ ...saved, id: 'a b' }])).toBe('Id inválido: "a b".');
    expect(validateAssistants(Array.from({ length: MAX_ASSISTANTS + 1 }, (_, i) => ({ ...saved, id: `a${i}` })))).toBe(`No máximo ${MAX_ASSISTANTS} assistentes por workspace.`);
  });
});

describe('built-in assistants', () => {
  it('has the four from the plan, ready to run: ids reserved, instructions in pt-BR, scopes set', () => {
    expect(BUILTIN_ASSISTANTS.map((item) => item.name)).toEqual(['Revisar pontos únicos de falha', 'Auditar segurança', 'Resumir mudanças desde a última versão', 'Rascunhar ADR']);
    for (const item of BUILTIN_ASSISTANTS) {
      expect(item.id).toMatch(/^builtin-[a-z-]+$/);
      expect(item.instruction.length).toBeGreaterThan(80);
      expect(item.instruction.length).toBeLessThanOrEqual(4_000);
      expect(validateAssistants([{ ...item, id: 'x' }])).toBeNull();
    }
    expect(new Set(BUILTIN_ASSISTANTS.map((item) => item.id)).size).toBe(4);
  });

  it('asks for the changes since the last version only where it needs them', () => {
    expect(BUILTIN_ASSISTANTS.filter((item) => item.changes).map((item) => item.id)).toEqual(['builtin-changes']);
    expect(BUILTIN_ASSISTANTS.find((item) => item.id === 'builtin-changes')!.scope).toBe('diagram');
  });

  it('allAssistants lists the built-ins first, then the saved ones', () => {
    const all = allAssistants([saved]);
    expect(all.slice(0, 4)).toEqual([...BUILTIN_ASSISTANTS]);
    expect(all.at(-1)).toEqual(saved);
    expect(allAssistants(undefined)).toEqual([...BUILTIN_ASSISTANTS]);
  });
});

describe('newAssistantId', () => {
  it('derives a unique slug from the name, never a reserved one', () => {
    expect(newAssistantId('Revisar custos', [saved])).toBe('revisar-custos');
    expect(newAssistantId('Custo', [saved])).toBe('custo-2');
    expect(newAssistantId('Builtin Spof', [])).not.toMatch(/^builtin-/);
  });
});

describe('assistants in the workspace', () => {
  it('are written next to the other files only when there are some, and read back', async () => {
    const data = newWorkspace('Loja');
    expect(Object.keys(workspaceFiles(data))).not.toContain(ASSISTANTS_PATH);
    expect(Object.keys(workspaceFiles({ ...data, assistants: [] }))).not.toContain(ASSISTANTS_PATH);
    const files = workspaceFiles({ ...data, assistants: [saved] });
    expect(files[ASSISTANTS_PATH]).toBe(printAssistants([saved]));
    const loaded = await loadWorkspace(createMemoryAdapter(files));
    expect(loaded!.data.assistants).toEqual([saved]);
    expect(loaded!.warnings).toEqual([]);
  });

  it('a workspace without the file has none, and a broken file is ignored without a warning or a crash', async () => {
    const files = workspaceFiles(newWorkspace('Loja'));
    expect((await loadWorkspace(createMemoryAdapter(files)))!.data.assistants).toBeUndefined();
    const broken = await loadWorkspace(createMemoryAdapter({ ...files, [ASSISTANTS_PATH]: '{nope' }));
    expect(broken!.data.assistants).toEqual([]);
    expect(broken!.warnings).toEqual([]);
  });
});
