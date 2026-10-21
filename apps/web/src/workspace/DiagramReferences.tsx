import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramSnapshot } from '@strukt/workspace';
import { uiText } from '../i18n';
import { citationRanges } from '../chat/citations';
import type { CitationResolver } from '../chat/citations';
import { goToCitation } from '../chat/reveal';
import type { Theme } from '../ui/theme';
import { useUi } from '../ui/uiStore';
import { useWorkspace } from './appWorkspace';

const thumbnails = new WeakMap<DiagramSnapshot, Partial<Record<Theme, Promise<string | null>>>>();
function thumbnail(snapshot: DiagramSnapshot, theme: Theme) {
  const cache = thumbnails.get(snapshot) ?? {};
  cache[theme] ??= import('../board/thumbnail').then((m) => m.diagramThumbnail(snapshot, theme));
  thumbnails.set(snapshot, cache);
  return cache[theme]!;
}
function Preview({ slug, title }: { slug: string; title: string }) {
  const element = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const snapshot = useWorkspace((s) => s.data?.diagrams[slug]);
  const theme = useUi((s) => s.theme);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setUrl(null);
    setFailed(false);
    if (!snapshot || snapshot.model.order.length > 500) {
      setFailed(true);
      return;
    }
    const timer = setTimeout(() => {
      void thumbnail(snapshot, theme).then(
        (next) => {
          if (active) {
            setUrl(next);
            setFailed(!next);
          }
        },
        () => {
          if (active) setFailed(true);
        },
      );
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [snapshot, theme, visible]);
  return (
    <button
      ref={element}
      type="button"
      className="flex min-w-0 flex-col overflow-hidden rounded-control border border-line bg-canvas text-left hover:border-accent/50"
      aria-label={uiText('Abrir diagrama {0}', [title])}
      onClick={() => void goToCitation({ diagram: slug, id: '' })}
    >
      <span className="flex h-28 w-full items-center justify-center overflow-hidden p-2">
        {url ? (
          <img src={url} alt={uiText('Prévia de {0}', [title])} className="h-full w-full object-contain" />
        ) : (
          <span className="text-caption text-muted">{failed ? uiText('Prévia indisponível') : uiText('Preparando prévia…')}</span>
        )}
      </span>
      <span className="w-full truncate border-t border-line px-2 py-1.5 text-caption font-medium text-ink">{title}</span>
    </button>
  );
}
/** Deduplicate component citations into real diagram previews; no AI generation or remote images. */
export function DiagramReferences({ markdown, resolve }: { markdown: string; resolve: CitationResolver }) {
  const references = useMemo(() => {
    const diagrams = new Map<string, string>();
    for (const item of citationRanges(markdown)) {
      const found = resolve(item.ref);
      if (found) diagrams.set(found.diagram, found.diagramTitle);
    }
    return [...diagrams];
  }, [markdown, resolve]);
  if (!references.length) return null;
  return (
    <details className="mx-auto my-2 w-full max-w-[760px] px-3 text-caption" open>
      <summary className="cursor-pointer py-1 text-muted">
        {uiText('Diagramas referenciados')} ({references.length})
      </summary>
      <div className="grid max-h-44 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 overflow-y-auto py-1">
        {references.slice(0, 4).map(([slug, title]) => (
          <Preview key={slug} slug={slug} title={title} />
        ))}
      </div>
    </details>
  );
}
