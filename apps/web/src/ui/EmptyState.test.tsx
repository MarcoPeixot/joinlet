import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import type { Illustration } from './EmptyState';

describe('EmptyState', () => {
  it('renders the drawing, title, text and one primary action', () => {
    const out = renderToStaticMarkup(<EmptyState illustration="versions" title="Sem versões" text="Salve a primeira." action={{ label: 'Salvar versão', onClick: () => {} }} />);
    expect(out).toContain('<svg');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('Sem versões');
    expect(out).toContain('Salve a primeira.');
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('Salvar versão');
  });

  it('has no button without an action and draws every scene from tokens only', () => {
    for (const scene of ['versions', 'flows', 'accuracy', 'board', 'docs'] as Illustration[]) {
      const out = renderToStaticMarkup(<EmptyState illustration={scene} title="t" text="x" />);
      expect(out).not.toContain('<button');
      expect(out).toContain('var(--sk-');
      expect(out).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});
