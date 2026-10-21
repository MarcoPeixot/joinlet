import type { DiagramSnapshot } from '@strukt/workspace';
import { useEffect, useState } from 'react';
import { loadDiagramIcons, renderDiagramSvg } from '../export/svg';
import type { Theme } from '../ui/theme';

/**
 * Live diagram preview for a Overview card, as an <img> data URL (an image cannot run anything in the SVG).
 * Routes are dropped on purpose: every edge takes the cheap orthogonal fallback, never the router.
 */
export async function diagramThumbnail(snapshot: DiagramSnapshot, theme: Theme): Promise<string | null> {
  if (!snapshot.model.order.length) return null;
  const icons = await loadDiagramIcons(snapshot.model);
  const layout = { nodes: snapshot.layout.nodes, edges: {} };
  const svg = renderDiagramSvg(snapshot.model, layout, { theme, icons, background: false, padding: 16 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Re-renders at most every 200 ms while the diagram changes. */
export function useDiagramThumbnail(snapshot: DiagramSnapshot | undefined, theme: Theme): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    const timer = setTimeout(() => {
      void diagramThumbnail(snapshot, theme).then((next) => {
        if (alive) setUrl(next);
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [snapshot, theme]);
  return url;
}
