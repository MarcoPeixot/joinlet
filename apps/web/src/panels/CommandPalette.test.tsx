import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Command } from '../actions/commands';
import { PaletteContent } from './CommandPalette';

const cmd = (id: string, title: string): Command => ({ id, title, section: 'Ações', run: () => {} });
const groups = [
  { label: 'Ações', items: [cmd('a', 'Novo diagrama'), cmd('b', 'Exportar SVG')] },
  { label: 'Ir para', items: [cmd('c', 'Pedidos')] },
];
const noop = () => {};
const props = { query: '', active: 1, onQuery: noop, onKeyDown: noop, onHover: noop, onRun: noop, listRef: { current: null } };

describe('PaletteContent a11y', () => {
  const out = renderToStaticMarkup(<PaletteContent {...props} groups={groups} />);

  it('the input is a combobox wired to the listbox and the active option', () => {
    expect(out).toMatch(/<input[^>]*role="combobox"/);
    const listId = /<ul[^>]*role="listbox"[^>]*id="([^"]+)"|<ul[^>]*id="([^"]+)"[^>]*role="listbox"/.exec(out);
    const id = listId?.[1] ?? listId?.[2];
    expect(id).toBeTruthy();
    expect(out).toContain(`aria-controls="${id}"`);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-autocomplete="list"');
    const active = /aria-activedescendant="([^"]+)"/.exec(out)![1]!;
    expect(out).toMatch(new RegExp(`<button[^>]*id="${active}"[^>]*>|<button[^>]*>`));
    const activeOption = new RegExp(`id="${active}"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="${active}"`);
    expect(out).toMatch(activeOption);
    expect(out).toContain('Exportar SVG');
  });

  it('options have role option, aria-selected and unique ids; sections are labelled groups', () => {
    expect(out.match(/role="option"/g)).toHaveLength(3);
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(out.match(/aria-selected="false"/g)).toHaveLength(2);
    const ids = [...out.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(3);
    expect(out.match(/role="group"/g)).toHaveLength(2);
    for (const label of [...out.matchAll(/role="group"[^>]*aria-labelledby="([^"]+)"|aria-labelledby="([^"]+)"[^>]*role="group"/g)]) {
      const target = label[1] ?? label[2];
      expect(out).toContain(`id="${target}"`);
    }
  });

  it('empty state is a status and the combobox is collapsed', () => {
    const empty = renderToStaticMarkup(<PaletteContent {...props} query="zzz" groups={[]} />);
    expect(empty).toMatch(/role="status"[^>]*>Nenhum comando para/);
    expect(empty).toContain('aria-expanded="false"');
    expect(empty).not.toContain('aria-activedescendant');
    expect(empty).not.toContain('role="option"');
  });
});
