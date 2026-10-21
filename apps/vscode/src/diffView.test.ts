import { describe, expect, it } from 'vitest';
import { diffMarkdown } from './diffView';

describe('diffMarkdown', () => {
  it('shows the CLI Markdown as is', () => {
    expect(diffMarkdown('HEAD', '## Arquitetura — `HEAD` → `worktree`\n\n- Adicionados: `API`\n')).toBe('## Arquitetura — `HEAD` → `worktree`\n\n- Adicionados: `API`\n');
  });

  it('explains an empty result', () => {
    expect(diffMarkdown('main', '  \n')).toContain('`main`');
  });
});
