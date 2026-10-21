import { describe, expect, it } from 'vitest';
import { applyOps, emptyLayout, emptyModel, readChatEdit, splitDiagram } from './index';
const result = applyOps(emptyModel(), [
  { op: 'add_group', id: 'Consulta' },
  { op: 'add_node', id: 'API', parentId: 'Consulta', tech: 'Node.js', description: 'Recebe perguntas' },
  { op: 'add_node', id: 'Banco', icon: 'postgresql' },
  { op: 'add_node', id: 'Indexador' },
  { op: 'connect', from: 'API', to: 'Banco', label: 'busca' },
  { op: 'connect', from: 'Indexador', to: 'Banco', connector: '-->' },
]);
if (!result.ok) throw new Error(result.error.message);
const model = result.model;
const parts = [{ title: 'Consulta', elements: ['Consulta', 'Banco'] }, { title: 'Ingestão', elements: ['Indexador', 'Banco'] }];
describe('diagram partition', () => {
  it('preserves groups, properties, boundaries, connections and positions without recreating components', () => {
    const layout = { nodes: { Consulta: { x: 20, y: 40 }, API: { x: 30, y: 50 }, Banco: { x: 400, y: 80 } }, edges: {} };
    const split = splitDiagram(model, layout, parts);
    expect(split[0]!.model.elements.API).toEqual(model.elements.API);
    expect(split[0]!.model.edges).toEqual([model.edges[0]]);
    expect(split[1]!.model.edges).toEqual([model.edges[1]]);
    expect(split[1]!.layout.nodes.Banco).toEqual(layout.nodes.Banco);
    expect(model.order).toHaveLength(4);
  });
  it('rejects unknown ids, partial groups, missing components and lost connections', () => {
    expect(() => splitDiagram(model, emptyLayout(), [{ ...parts[0]!, elements: ['Inexistente'] }, parts[1]!])).toThrow('não existe');
    expect(() => splitDiagram(model, emptyLayout(), [{ ...parts[0]!, elements: ['API', 'Banco'] }, parts[1]!])).toThrow('grupo raiz');
    expect(() => splitDiagram(model, emptyLayout(), [parts[0]!, { title: 'Outra', elements: ['Banco'] }])).toThrow('omitiu');
    expect(() => splitDiagram(model, emptyLayout(), [{ ...parts[0]!, elements: ['Consulta'] }, parts[1]!])).toThrow('perderia conexões');
  });
  it('validates bounds and distinct nonempty titles in the wire contract', () => {
    const edit = { kind: 'split_diagram', summary: 'Separação', parts };
    expect(readChatEdit(edit)).toEqual(edit);
    for (const invalid of [[], [parts[0]], [...parts, parts[0]], [{ title: ' ', elements: ['Banco'] }, parts[1]], [{ ...parts[0], elements: ['Banco', 'Banco'] }, parts[1]]]) expect(readChatEdit({ ...edit, parts: invalid })).toBeNull();
  });
});
