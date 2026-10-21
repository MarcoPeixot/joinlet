import { uiText } from '../i18n';
import { own } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { normalizeName } from '@strukt/workspace';
import type { CommentAnchor } from '@strukt/workspace';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", then the date. */
export function relativeTime(at: number, now: number): string {
  const age = now - at;
  if (age < MIN) return uiText("agora");
  if (age < HOUR) return uiText("há {0} min", [Math.floor(age / MIN)]);
  if (age < DAY) return uiText("há {0} h", [Math.floor(age / HOUR)]);
  if (age < 2 * DAY) return uiText("ontem");
  if (age < 30 * DAY) return uiText("há {0} dias", [Math.floor(age / DAY)]);
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export interface TextPart { text: string; mention?: true }

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The comment's text cut into plain pieces and the `@Name` of each person it mentions (by the names stored with the
 * message), for rendering as React text: nothing here is ever HTML.
 */
export function splitMentions(text: string, mentions: readonly string[] = []): TextPart[] {
  if (!text) return [];
  const keys = mentions.map(normalizeName).filter(Boolean).sort((a, b) => b.length - a.length);
  const parts: TextPart[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || !WORD.test(text[i - 1]!)) && keys.length) {
      let end = -1;
      // The longest stretch after the @ that reads as one of the names (accents and case ignored).
      for (let stop = Math.min(text.length, i + 1 + 70); stop > i + 1 && end === -1; stop--) {
        const next = text[stop];
        if (next !== undefined && WORD.test(next)) continue;
        if (keys.includes(normalizeName(text.slice(i + 1, stop)))) end = stop;
      }
      if (end !== -1) {
        if (plain) parts.push({ text: plain });
        plain = '';
        parts.push({ text: text.slice(i, end), mention: true });
        i = end;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

export interface AnchorLabel {
  text: string;
  /** The node or connection the conversation was about is gone. */
  orphan: boolean;
  icon: 'node' | 'edge' | 'point' | 'text';
  note?: string;
}

const QUOTE_SHOWN = 60;

export function anchorLabel(anchor: CommentAnchor, model: DiagramModel | null): AnchorLabel {
  switch (anchor.type) {
    case 'node': {
      const element = model ? own(model.elements, anchor.id) : undefined;
      return element ? { text: element.label?.trim() || anchor.id, orphan: false, icon: 'node' } : { text: anchor.id, orphan: true, icon: 'node', note: uiText("elemento removido") };
    }
    case 'edge': {
      const edge = model?.edges.find((item) => item.id === anchor.id);
      if (!edge || !model) return { text: anchor.id, orphan: true, icon: 'edge', note: uiText("conexão removida") };
      const name = (id: string) => own(model.elements, id)?.label?.trim() || id;
      return { text: `${name(edge.from)} → ${name(edge.to)}`, orphan: false, icon: 'edge' };
    }
    case 'point': return { text: uiText("Ponto do canvas"), orphan: false, icon: 'point' };
    case 'text': {
      const flat = anchor.quote.replace(/\s+/g, ' ').trim();
      return { text: uiText("“{0}”", [flat.length > QUOTE_SHOWN ? `${flat.slice(0, QUOTE_SHOWN - 1)}…` : flat]), orphan: false, icon: 'text' };
    }
  }
}
