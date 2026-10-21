import { linkCitations } from '../chat/citations';
import type { CitationResolver } from '../chat/citations';
import { uiText } from '../i18n';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import { downloadBlob } from '../export/png';

// Keep PDFKit and its embedded fonts out of the editor's initial download.
let renderer: Promise<typeof import('pdfmake/build/pdfmake')> | undefined;
function loadRenderer() {
  renderer ??= Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]).then(([pdf, fonts]) => {
    const engine = pdf.default;
    engine.addVirtualFileSystem(fonts.default);
    return engine;
  }).catch((error) => { renderer = undefined; throw error; });
  return renderer;
}

function inline(tokens: Token[] = []): ContentText[] {
  return tokens.flatMap((token): ContentText[] => {
    switch (token.type) {
      case 'strong': return inline(token.tokens).map((part) => ({ ...part, bold: true }));
      case 'em': return inline(token.tokens).map((part) => ({ ...part, italics: true }));
      case 'del': return inline(token.tokens).map((part) => ({ ...part, decoration: 'lineThrough' }));
      case 'link': return inline(token.tokens).map((part) => /^https?:\/\//i.test(token.href) ? { ...part, link: token.href, color: '#356b16', decoration: 'underline' } : part);
      case 'codespan': return [{ text: token.text, background: '#f1f3f5', fontSize: 9 }];
      case 'br': return [{ text: "\n" }];
      case 'image': return [{ text: token.text }]; // Match document rendering: no remote image fetches.
      case 'html': return []; // Never interpret document HTML as PDF instructions.
      case 'escape': return [{ text: token.text }];
      default: return 'tokens' in token && token.tokens ? inline(token.tokens) : [{ text: 'text' in token ? token.text : token.raw }];
    }
  });
}

function blocks(tokens: Token[]): Content[] {
  return tokens.flatMap((token): Content[] => {
    switch (token.type) {
      case 'space': return [];
      case 'heading': return [{ text: inline(token.tokens), style: `h${token.depth}`, headlineLevel: token.depth, margin: [0, token.depth === 1 ? 0 : 18, 0, 10] }];
      case 'paragraph': case 'text': return [{ text: inline(token.tokens ?? [{ type: 'text', raw: token.raw, text: token.text }]), margin: [0, 0, 0, 10] }];
      case 'blockquote': return [{ stack: blocks(token.tokens ?? []), color: '#526071', margin: [14, 4, 0, 12], italics: true }];
      case 'list': {
        const list = token as Tokens.List;
        const items: Content[] = list.items.map((item) => ({ stack: [
          ...(item.task ? [{ text: item.checked ? '[x]' : '[ ]', bold: true } as Content] : []),
          ...blocks(item.tokens),
        ] }));
        return [list.ordered ? { ol: items, start: list.start || 1, margin: [0, 0, 0, 10] } : { ul: items, margin: [0, 0, 0, 10] }];
      }
      case 'code': return [{ table: { widths: ['*'], body: [[{ text: token.text || ' ', fontSize: 9, lineHeight: 1.3, fillColor: '#f3f5f7', margin: [10, 8, 10, 8], preserveLeadingSpaces: true }]] }, layout: 'noBorders', margin: [0, 4, 0, 14] }];
      case 'table': { const table = token as Tokens.Table; return [{ table: { headerRows: 1, keepWithHeaderRows: 1, widths: table.header.map(() => '*'), body: [
        table.header.map((cell, index) => ({ text: inline(cell.tokens), bold: true, fillColor: '#edf1f5', alignment: table.align[index] ?? 'left' })),
        ...table.rows.map((row) => row.map((cell, index) => ({ text: inline(cell.tokens), alignment: table.align[index] ?? 'left' }))),
      ] }, layout: { hLineColor: '#dce2e8', vLineWidth: () => 0, hLineWidth: () => 0.5, paddingTop: () => 8, paddingBottom: () => 8, paddingLeft: () => 8, paddingRight: () => 8 }, fontSize: 9, margin: [0, 6, 0, 16] }]; }
      case 'hr': return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.5, lineColor: '#dce2e8' }], margin: [0, 14, 0, 18] }];
      case 'html': return []; // Same allowlist principle as the editor, without active content.
      default: return [];
    }
  });
}

/** A trailing bottom margin can create a blank last page when the text exactly fills a page. */
function trimEndMargins(nodes: Content[]): void {
  const last = nodes.at(-1);
  if (!last || typeof last !== 'object' || Array.isArray(last)) return;
  if ('margin' in last && Array.isArray(last.margin) && last.margin.length === 4) last.margin = [last.margin[0], last.margin[1], last.margin[2], 0];
  if ('stack' in last && Array.isArray(last.stack)) trimEndMargins(last.stack);
  if ('ul' in last && Array.isArray(last.ul)) trimEndMargins(last.ul);
  if ('ol' in last && Array.isArray(last.ol)) trimEndMargins(last.ol);
}

/** A paginated, selectable-text document. Content is data, never an executable PDF definition. */
export function documentPdfDefinition(title: string, markdown: string, resolve?:CitationResolver): TDocumentDefinitions {
  const tokens = marked.lexer(resolve ? linkCitations(markdown,resolve) : markdown, { gfm: true });
  const first = tokens.find((token) => token.type !== 'space');
  const hasTitle = first?.type === 'heading' && first.depth === 1;
  const content: Content[] = [...(hasTitle ? [] : [{ text: title, style: 'h1', margin: [0, 0, 0, 22] } as Content]), ...blocks(tokens)];
  trimEndMargins(content);
  return {
    info: { title, creator: "Joinlet", subject: uiText("Documento do workspace") },
    pageSize: 'A4', pageMargins: [56, 60, 56, 58],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.4, color: '#202a35' },
    styles: {
      h1: { fontSize: 25, bold: true, lineHeight: 1.15 }, h2: { fontSize: 18, bold: true, lineHeight: 1.2 },
      h3: { fontSize: 14, bold: true }, h4: { fontSize: 12, bold: true }, h5: { fontSize: 11, bold: true }, h6: { fontSize: 10.5, bold: true },
    },
    content,
    header: { text: title.length > 61 ? `${title.slice(0, 60)}…` : title, margin: [56, 24, 56, 0], fontSize: 8, color: '#64748b' },
    footer: (page, pages) => ({ columns: [{ text: "Joinlet", color: '#64748b' }, { text: `${page} / ${pages}`, alignment: 'right', color: '#64748b' }], margin: [56, 20, 56, 0], fontSize: 8 }),
    pageBreakBefore: (node, container) => !!node.headlineLevel && container.getFollowingNodesOnPage().length === 0,
  };
}

export async function exportDocumentPdf(title: string, markdown: string, slug: string, resolve?:CitationResolver): Promise<void> {
  const pdf = await loadRenderer();
  const blob = await pdf.createPdf(documentPdfDefinition(title, markdown, resolve)).getBlob();
  downloadBlob(blob, `${slug.replace(/[^\p{L}\p{N}_.-]/gu, '-') || uiText("documento")}.pdf`);
}
