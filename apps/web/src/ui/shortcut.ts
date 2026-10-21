const MODIFIERS = new Set(['⌘', '⇧', '⌥', '⌃']);

/** "Adicionar nó (N)" → the text and the shortcut the tooltip shows as keys (short, no spaces). */
export function labelParts(label: string): { text: string; shortcut: string | null } {
  const match = /^(.*\S)\s+\(([^()\s]{1,6})\)$/.exec(label);
  return match ? { text: match[1], shortcut: match[2] } : { text: label, shortcut: null };
}

/** "⇧⌘Z" → ["⇧", "⌘", "Z"]: one key cap per modifier, the rest together. */
export function splitShortcut(combo: string): string[] {
  const keys: string[] = [];
  let rest = combo;
  while (rest && MODIFIERS.has(rest[0])) {
    keys.push(rest[0]);
    rest = rest.slice(1);
  }
  if (rest) keys.push(rest);
  return keys;
}
