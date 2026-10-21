import { own } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { citationHref, diagramCitationHref } from './citationAddress';

export { citationHref, parseCitationHref } from './citationAddress';

/**
 * Clickable citations in the chat. The assistant writes `[[Id]]` (an element of the open diagram) or `[[slug#Id]]`;
 * the panel checks each one against the workspace and turns the ones that exist into links to an internal address,
 * `#cite/<slug>/<id>`. Anything else stays the text the model wrote.
 */
export interface CitationTarget {
  diagram: string;
  id: string;
  /** What the chip says: the element's label, or its id. */
  label: string;
  diagramTitle: string;
}

/** `null` when the reference is not an element of the workspace. */
export type CitationResolver = (ref: string) => CitationTarget | null;

/** Text beyond this is left as written: a reply is a few thousand characters, so this is only a guard. */
const MAX_LINKED = 100_000;
const MAX_REF = 200;

export interface CitableDiagram {
  slug: string;
  title: string;
  model: Pick<DiagramModel, 'elements'>;
}

/** Resolves against the workspace: `slug#Id` exactly; `Id` in the open diagram, else in the only other diagram that has it. */
export function workspaceResolver(diagrams: readonly CitableDiagram[], open: string | null): CitationResolver {
  // A Map, and never "__proto__": a slug is only ever a name to look up, not a key to assign.
  const bySlug = new Map(diagrams.filter((item) => item.slug !== '__proto__').map((item) => [item.slug, item]));
  const normalize = (value: string) => value.trim().normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const diagramOf = (name: string) => bySlug.get(name) ?? (()=>{const matches=[...bySlug.values()].filter(d=>normalize(d.title)===normalize(name)||normalize(d.slug)===normalize(name));return matches.length===1?matches[0]:undefined;})();
  const aliases = new Map<CitableDiagram,Map<string,string|null>>();
  for(const item of bySlug.values()){
    const index=new Map<string,string|null>();
    for(const element of Object.values(item.model.elements))for(const alias of new Set([normalize(element.id),normalize(element.label??element.id)]))index.set(alias,index.has(alias)&&index.get(alias)!==element.id?null:element.id);
    aliases.set(item,index);
  }
  const target = (item: CitableDiagram, id: string): CitationTarget | null => {
    const match=aliases.get(item)?.get(normalize(id));
    const element = own(item.model.elements,id) ?? (match ? own(item.model.elements,match) : undefined);
    return element ? { diagram: item.slug, id: element.id, label: element.label?.trim() || element.id, diagramTitle: item.title } : null;
  };
  return (ref) => {
    const text = ref.trim();
    if (!text || text.length > MAX_REF) return null;
    const explicit = /^(?:diagram|diagrama):(.+)$/i.exec(text);
    if(explicit){const d=diagramOf(explicit[1]!.trim());return d?{diagram:d.slug,id:'',label:d.title,diagramTitle:d.title}:null;}
    const hash = text.indexOf('#');
    const qualified = hash > 0 ? diagramOf(text.slice(0, hash).trim()) : undefined;
    if (qualified) return target(qualified, text.slice(hash + 1).trim());
    const here = open === null ? undefined : bySlug.get(open);
    const inOpen = here ? target(here, text) : null;
    if (inOpen) return inOpen;
    const elsewhere = [...bySlug.values()].flatMap(item=>item===here?[]:[target(item,text)]).filter((item):item is CitationTarget=>item!==null);
    if(elsewhere.length===1)return elsewhere[0]!;
    if(elsewhere.length>1)return null;
    const diagram=diagramOf(text);
    return diagram?{diagram:diagram.slug,id:'',label:diagram.title,diagramTitle:diagram.title}:null;
  };
}

// Code first, so a `[[Id]]` inside it is part of the code token and never reaches the citation branch.
const TOKENS = new RegExp(
  [
    '^ {0,3}(`{3,}|~{3,})[^\\n]*(?:\\n[\\s\\S]*?(?:\\n {0,3}\\1[`~]*[ \\t]*(?=\\n|$)|(?![\\s\\S]))|$)',
    '(?<!`)(`+)(?!`)[\\s\\S]*?(?<!`)\\2(?!`)',
    `\\[\\[([^\\[\\]\\n]{1,${MAX_REF}})\\]\\]`,
  ].join('|'),
  'gm',
);

/** What Markdown could read as syntax inside a link's text or title. */
const escapeMarkdown = (text: string) => text.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]()<>~&#!|]/g, '\\$&');

/**
 * Replaces each resolvable `[[…]]` outside code with a Markdown link to its internal address. The label (and the diagram
 * title, for another diagram's element) come from the workspace, which is untrusted too: both are escaped.
 */
export function linkCitations(markdown: string, resolve: CitationResolver): string {
  if (!markdown.includes('[[') || markdown.length > MAX_LINKED) return markdown;
  return markdown.replace(TOKENS, (match, fence: string | undefined, _ticks: string | undefined, ref: string | undefined) => {
    if (ref === undefined || fence !== undefined) return match;
    const found = resolve(ref);
    if (!found) return match;
    const title = found.diagramTitle && ref.includes('#') ? ` "${escapeMarkdown(found.diagramTitle).replace(/"/g, '\\"')}"` : '';
    return `[${escapeMarkdown(found.label)}](${referenceHref(found)}${title})`;
  });
}


export const referenceHref = (target: CitationTarget) => target.id ? citationHref(target.diagram,target.id) : diagramCitationHref(target.diagram);
/** Only actual references outside fenced/inline code; offsets preserve the original Markdown. */
export function citationRanges(markdown: string): {from:number;to:number;ref:string}[] {
  if(!markdown.includes('[[') || markdown.length>MAX_LINKED)return [];
  const result:{from:number;to:number;ref:string}[]=[];
  for(const match of markdown.matchAll(TOKENS)){if(match[3]!==undefined)result.push({from:match.index!,to:match.index!+match[0].length,ref:match[3]});}
  return result;
}
