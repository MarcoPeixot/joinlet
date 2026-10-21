import { stableStringify } from './json';

/** A new, empty Excalidraw scene in the `.excalidraw` file format. */
export function emptySketch(): string {
  return stableStringify({
    type: 'excalidraw',
    version: 2,
    source: 'strukt',
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    files: {},
  });
}

/** Visible (non-deleted) elements in a `.excalidraw` file; 0 when it cannot be read. */
export function sketchElementCount(text: string): number {
  try {
    const elements = (JSON.parse(text) as { elements?: unknown }).elements;
    return Array.isArray(elements) ? elements.filter((el) => el && !(el as { isDeleted?: boolean }).isDeleted).length : 0;
  } catch {
    return 0;
  }
}

/** Title for a doc made from Markdown: its first `# heading`, if any. */
export function markdownTitle(markdown: string): string | null {
  const match = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  return match ? match[1]!.trim() : null;
}

export function defaultDoc(title: string): string {
  return `# ${title}\n\n`;
}

/** The start of a doc for its Quadro card, cut at a line break. */
export function docExcerpt(markdown: string, max = 600): string {
  if (markdown.length <= max) return markdown;
  const cut = markdown.lastIndexOf('\n', max);
  return markdown.slice(0, cut > 0 ? cut : max);
}
