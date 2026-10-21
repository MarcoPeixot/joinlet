import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocBadgeView } from './DocBadge';

describe('DocBadge', () => {
  it('renders the drill-down button, and hides it while presenting', () => {
    expect(renderToStaticMarkup(<DocBadgeView link="diagram:outro" />)).toContain('<button');
    expect(renderToStaticMarkup(<DocBadgeView link="diagram:outro" presenting />)).not.toContain('<button');
    expect(renderToStaticMarkup(<DocBadgeView link="doc:x" evidenceCount={2} presenting />)).toContain('evidências');
  });
});
