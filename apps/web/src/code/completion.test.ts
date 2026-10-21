import { describe, expect, it } from 'vitest';
import { DIAGRAM_KEYS, jsonCompletions } from './completion';

describe('jsonCompletions', () => {
  it('offers the document keys outside a value', () => {
    const options = jsonCompletions('{\n  ');
    expect(options.every((option) => option.type === 'property')).toBe(true);
    expect(options.map((option) => option.label)).toEqual([...DIAGRAM_KEYS]);
  });

  it('offers the values of the key before the cursor', () => {
    expect(jsonCompletions('{ "nodes": [{ "shape": "cy').map((o) => o.label)).toContain('cylinder');
    expect(jsonCompletions('{ "style": { "direction": "d').map((o) => o.label)).toContain('down');
    expect(jsonCompletions('{ "nodes": [{ "colorMode": "b').map((o) => o.label)).toContain('bold');
  });

  it('offers curated icons for the icon key and nothing for free-text keys', () => {
    expect(jsonCompletions('{ "nodes": [{ "icon": "kaf').length).toBeGreaterThan(0);
    expect(jsonCompletions('{ "nodes": [{ "label": "x').length).toBe(0);
    expect(jsonCompletions('{ "nodes": [{ "id": "x').length).toBe(0);
  });
});
