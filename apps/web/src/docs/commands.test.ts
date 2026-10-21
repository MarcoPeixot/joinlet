import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { matchingBlocks, slashCommands } from './commands';
const source = (doc: string, readonly = false) => slashCommands(new CompletionContext(EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(readonly)] }), doc.length, false));
describe('document slash commands', () => {
  it('finds headings with accents and familiar aliases', () => {
    expect(matchingBlocks('titulo').map((command) => command.label)).toEqual(['Título 1', 'Título 2', 'Título 3']);
    expect(matchingBlocks('code').map((command) => command.label)).toEqual(['Código']);
  });
  it('only opens on a standalone slash query, outside code and read-only items', () => {
    expect(source('/tabe')?.options.map((item) => item.label)).toEqual(['Tabela']);
    expect(source('https://exemplo.com/')).toBeNull();
    expect(source('texto /tabela')).toBeNull();
    expect(source('```\n/tabela')).toBeNull();
    expect(source('/tabela', true)).toBeNull();
  });
});
