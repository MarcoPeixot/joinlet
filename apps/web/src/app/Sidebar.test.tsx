import { describe, expect, it } from 'vitest';
import { sectionLabel } from './Sidebar';

describe('sidebar section label', () => {
  it('shows the count next to the name', () => {
    expect(sectionLabel('Diagramas', 2)).toBe('Diagramas · 2');
  });
  it('omits the count of an empty section', () => {
    expect(sectionLabel('Sketches', 0)).toBe('Sketches');
  });
});
