import { uiText } from '../i18n';
export type OpenItem = { kind: 'diagram' | 'doc' | 'sketch'; slug: string; title?: string } | { kind: 'board' };

export interface ChatSource {
  workspace: string;
  open: OpenItem;
  diagrams: { slug: string; title: string; json: string }[];
  docs: { slug: string; title: string; markdown: string }[];
  sketches?: { slug: string; title: string; json: string }[];
  /** `diagram`: only the open diagram is read (an assistant scoped to it); without one open, everything is. */
  scope?: 'diagram' | 'workspace';
  /** A section appended after the sources, outside the budget (the changes an assistant asked for). */
  extra?: string;
}

/** Characters of context sent with each question (the server accepts 300 000). */
export const CONTEXT_BUDGET = 150_000;
/** A document that is not the open one is cut here: the point is to know it exists and what it says first. */
const DOC_CUT = 6_000;

const fence = (json: string) => `\`\`\`json\n${json.trim()}\n\`\`\``;

/**
 * What the assistant reads along with each question: the diagram JSON (canonical, the same text as the code
 * panel), the documents' Markdown, with the open item first and whole, and everything else while the budget lasts.
 */
export function buildChatContext(source: ChatSource): string {
  const { open } = source;
  const single = source.scope === 'diagram' && open.kind === 'diagram';
  const diagrams = single ? source.diagrams.filter((item) => item.slug === open.slug) : source.diagrams;
  const docs = single ? [] : source.docs;
  const isOpen = (kind: string, slug: string) => open.kind === kind && 'slug' in open && open.slug === slug;
  const openedLine = (() => {
    if (open.kind === 'board') return uiText("Aberto agora: o overview.");
    const title = open.kind === 'sketch' ? open.title : (open.kind === 'diagram' ? source.diagrams : source.docs).find((item) => item.slug === open.slug)?.title;
    const kind = open.kind === 'diagram' ? uiText("diagrama") : open.kind === 'doc' ? uiText("documento") : 'sketch';
    return uiText("Aberto agora: {0} \"{1}\".", [kind, title ?? open.slug]);
  })();

  const sections: { open: boolean; text: string }[] = [
    ...diagrams.map((item) => ({ open: isOpen('diagram', item.slug), text: `## Diagrama: ${item.title} (slug: ${item.slug}${isOpen('diagram', item.slug) ? ', aberto' : ''})\n${fence(item.json)}` })),
    ...(single ? [] : source.sketches ?? []).map((item) => ({ open: isOpen('sketch', item.slug), text: `## Sketch: ${item.title} (slug: ${item.slug}${isOpen('sketch', item.slug) ? ', aberto' : ''})\n${fence(item.json)}` })),
    ...docs.map((item) => {
      const current = isOpen('doc', item.slug);
      const body = !current && item.markdown.length > DOC_CUT ? uiText("{0}\n[texto cortado]", [item.markdown.slice(0, DOC_CUT)]) : item.markdown;
      return { open: current, text: `## Documento: ${item.title} (slug: ${item.slug}${current ? ', aberto' : ''})\n${body}` };
    }),
  ];
  // The open item first; then documents before diagrams (shorter, more of them fit); the sources' own order otherwise.
  const rank = (section: { open: boolean; text: string }) => (section.open ? 0 : section.text.startsWith(uiText("## Documento")) ? 1 : 2);
  const ordered = sections.map((section, index) => ({ section, index })).sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index).map(({ section }) => section);

  const head = `Workspace: ${source.workspace}\n${openedLine}`;
  let used = head.length;
  const kept: string[] = [];
  let left = 0;
  for (const section of ordered) {
    if (!section.open && used + section.text.length > CONTEXT_BUDGET) {
      left += 1;
      continue;
    }
    used += section.text.length + 2;
    kept.push(section.text);
  }
  const note = left ? `\n\n(${left === 1 ? uiText("outro 1 item não coube") : uiText("outros {0} itens não coube", [left])} neste contexto.)` : '';
  return `${head}\n\n${kept.join('\n\n')}${note}${source.extra ? `\n\n${source.extra}` : ''}`.trim();
}
