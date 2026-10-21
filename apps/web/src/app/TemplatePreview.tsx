import { uiText } from '../i18n';
import { LayoutTemplate } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiagramTemplate } from '@strukt/workspace';
import { templateSnapshot } from '../actions/templates';
import { useUi } from '../ui/uiStore';
import type { Theme } from '../ui/theme';

const previews = new WeakMap<DiagramTemplate, Partial<Record<Theme, Promise<string>>>>();

export function templatePreview(template: DiagramTemplate, theme: Theme): Promise<string> {
  const cache = previews.get(template) ?? {};
  if (cache[theme]) return cache[theme];
  const pending = Promise.all([
    templateSnapshot(template),
    import('../export/svg'),
    import('@strukt/layout/router'),
  ]).then(async ([snapshot, renderer, layout]) => {
    const icons = await renderer.loadDiagramIcons(snapshot.model);
    const svg = renderer.renderDiagramSvg(snapshot.model, snapshot.layout, { theme, icons, router: layout.eraserRouter, padding: 12 });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  cache[theme] = pending;
  previews.set(template, cache);
  return pending;
}

export function TemplatePreview({ template, large = false }: { template: DiagramTemplate; large?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(large);
  const theme = useUi((state) => state.theme);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (large || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [large]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setUrl(null); setError(false);
    void templatePreview(template, theme).then((next) => { if (active) setUrl(next); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [template, theme, visible]);
  return (
    <div ref={element} className={`flex w-full items-center justify-center bg-canvas p-4 ${large ? 'h-[min(48vh,440px)] rounded-panel border border-line' : 'aspect-[16/10] border-b border-line'}`}>
      {url ? <img src={url} alt={uiText("Prévia de {0}", [template.title])} className="h-full w-full object-contain" /> : (
        <span role="status" className="flex items-center gap-2 text-caption text-muted"><LayoutTemplate size={18} />{error ? uiText("Prévia indisponível") : uiText("Preparando prévia…")}</span>
      )}
    </div>
  );
}
