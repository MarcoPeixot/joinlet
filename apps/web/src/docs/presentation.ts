import { uiText } from '../i18n';
export interface DocumentSection { id: string; label: string; level: number }

/** Work only on the already-sanitized Markdown. Generated controls carry no user-provided attributes. */
export function presentDocument(html: string): { html: string; sections: DocumentSection[]; words: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const words = (doc.body.textContent?.match(/[\p{L}\p{N}]+(?:[_’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const sections = [...doc.querySelectorAll('h1,h2,h3')].map((heading, index) => {
    const id = `doc-section-${index + 1}`;
    heading.id = id;
    heading.setAttribute('tabindex', '-1');
    return { id, label: heading.textContent ?? '', level: Number(heading.tagName[1]) };
  });
  for (const table of doc.querySelectorAll('table')) {
    const wrap = doc.createElement('div');
    wrap.className = 'sk-doc-table';
    table.replaceWith(wrap); wrap.append(table);
  }
  for (const pre of doc.querySelectorAll('pre')) {
    const wrap = doc.createElement('div'); wrap.className = 'sk-doc-code';
    const bar = doc.createElement('div'); bar.className = 'sk-doc-code-bar';
    const label = doc.createElement('span'); label.textContent = uiText("Código");
    const copy = doc.createElement('button'); copy.type = 'button'; copy.textContent = uiText("Copiar");
    copy.setAttribute('aria-label', uiText("Copiar código")); copy.dataset.copyCode = '';
    bar.append(label, copy); pre.replaceWith(wrap); wrap.append(bar, pre);
  }
  return { html: doc.body.innerHTML, sections, words };
}
