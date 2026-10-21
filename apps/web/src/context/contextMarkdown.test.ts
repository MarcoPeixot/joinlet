import { applyOps, emptyModel } from '@strukt/core';
import { architectureMarkdown, diagramMarkdown, newWorkspace } from '@strukt/workspace';
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';

/**
 * The generated context is Markdown that agents read raw and that GitHub, editors and the app render. Rendering it
 * with a real GFM renderer (unsanitized on purpose) proves the Markdown itself is inert: hostile labels, values and
 * ids stay text inside their own table cell.
 */
function hostileSnapshot() {
  const result = applyOps(emptyModel(), [
    { op: 'add_node', id: 'a|b*c', label: '<img src=x onerror=alert(1)>', tech: 'pg\r# Injected heading' },
    { op: 'update', id: 'a|b*c', set: { description: 'pipe | and x\\|y' } },
    { op: 'add_group', id: 'g|1' },
    { op: 'add_node', id: 'n\\|2', parentId: 'g|1' },
    { op: 'update', id: 'n\\|2', set: { description: `sep${String.fromCharCode(0x2028)}# Injected separator` } },
    { op: 'add_node', id: 'Plain*Id', label: '[x](javascript:alert(1)) **b**' },
    { op: 'connect', from: 'a|b*c', to: 'n\\|2', label: 'lbl\r# Injected edge' },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: {}, edges: {} } };
}

const render = (md: string) => marked.parse(md, { async: false, gfm: true });
const data = newWorkspace('Hostil', { title: 'C', snapshot: hostileSnapshot() });

describe('generated context rendered as GFM', () => {
  for (const [name, md] of [['ARCHITECTURE.md', architectureMarkdown(data)], ['diagrams/c.md', diagramMarkdown(data, 'c')]] as const) {
    it(`${name}: no raw HTML, no injected heading or link, every cell in its column`, () => {
      const html = render(md);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/<h\d[^>]*>[^<]*Injected/);
      expect(html).not.toMatch(/href="javascript/i);
      expect(html).not.toMatch(/<strong>/);

      const tables = marked.lexer(md).filter((token) => token.type === 'table');
      expect(tables).toHaveLength(2);
      const [components, connections] = tables as { rows: { text: string }[][] }[];
      const cells = (rows: { text: string }[][]) => rows.map((row) => row.map((cell) => marked.parseInline(cell.text, { async: false, gfm: true })));
      expect(cells(components!.rows)).toEqual([
        ['&lt;img src=x onerror=alert(1)&gt; (<code>a|b*c</code>)', 'nó', 'pg # Injected heading', 'pipe | and x\\|y', '—'],
        ['<code>g|1</code>', 'grupo', '—', '—', '—'],
        ['<code>n\\\\|2</code>', 'nó', '—', 'sep # Injected separator', '<code>g|1</code>'],
        ['[x](javascript:alert(1)) **b** (<code>Plain*Id</code>)', 'nó', '—', '—', '—'],
      ]);
      expect(cells(connections!.rows)).toEqual([
        ['<code>a|b*c</code>', '<code>n\\\\|2</code>', '<code>&gt;</code> seta', 'lbl # Injected edge'],
      ]);
    });
  }
});
