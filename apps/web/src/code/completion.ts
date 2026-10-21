import { COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';
import { ICON_SUGGESTIONS } from '../diagram/icons/registry';

export interface JsonCompletion {
  label: string;
  type: 'property' | 'value';
}

/** Every key a diagram document may carry, in the order the printer writes them. */
export const DIAGRAM_KEYS = [
  '$schema', 'version', 'style', 'nodes', 'connections',
  'id', 'type', 'label', 'shape', 'icon', 'color', 'tech', 'description', 'link',
  'colorMode', 'styleMode', 'typeface', 'children', 'from', 'to',
  'direction',
] as const;

/** The values each key accepts; `icon` gets the curated suggestions. */
const VALUES: Record<string, readonly string[]> = {
  type: ['node', 'group'],
  shape: SHAPES,
  colorMode: COLOR_MODES,
  styleMode: STYLE_MODES,
  typeface: TYPEFACES,
  direction: DIRECTIONS,
  color: ['blue', 'green', 'purple', 'red', 'orange', 'yellow', 'black', 'white'],
  icon: ICON_SUGGESTIONS.slice(0, 60),
};

/**
 * Completions for the JSON editor, from the text before the cursor: after `"chave": "` the values of
 * that key, otherwise the document keys. Heuristic on purpose — it never blocks typing.
 */
export function jsonCompletions(before: string): JsonCompletion[] {
  const value = /"([A-Za-z]+)"\s*:\s*"?[^"]*$/.exec(before);
  const key = value?.[1];
  if (key) {
    const values = Object.hasOwn(VALUES, key) ? VALUES[key]! : [];
    return values.map((label) => ({ label, type: 'value' as const }));
  }
  return DIAGRAM_KEYS.map((label) => ({ label, type: 'property' as const }));
}
