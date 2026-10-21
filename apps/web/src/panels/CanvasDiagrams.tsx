import { uiText } from '../i18n';
import { canvasFrames } from '@strukt/core';
import { ArrowDown, ArrowRight, CopyPlus, Focus, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { arrangeCanvasDiagram, insertCanvasDiagram } from '../actions/canvasDiagrams';
import { diagramStore, useDiagram } from '../state/appStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { inputClass } from '../ui/controls';
import { requestFit } from '../ui/uiStore';

export function CanvasDiagrams({ onClose }: { onClose: () => void }) {
  const model = useDiagram(s => s.model);
  const frames = canvasFrames(model);
  const data = useWorkspace(s => s.data);
  const current = useWorkspace(s => s.diagram);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const insert = async (name: string, slug?: string) => { if (busy) return; setBusy(true); const id = await insertCanvasDiagram(name, slug); setBusy(false); if (id) onClose(); };
  return <div className="flex w-[360px] max-w-[calc(100vw-24px)] max-h-[min(720px,var(--radix-popover-content-available-height))] overflow-y-auto flex-col gap-4 p-4">
    <div><h2 className="text-title font-medium">{uiText("Diagramas no canvas")}</h2><p className="mt-1 text-caption leading-relaxed text-muted">{uiText("Vários desenhos no mesmo espaço. Cada área pode ser movida e organizada separadamente.")}</p></div>
    {frames.length > 0 && <div role="group" aria-label={uiText("Áreas deste canvas")} className="flex max-h-40 flex-col gap-1 overflow-y-auto">{frames.map(id => <div key={id} className="flex min-w-0 items-center gap-1 rounded-control bg-panel-2/50 px-2 py-1"><button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-caption" onClick={() => { diagramStore.getState().select({ nodes: [id], edges: [] }); requestFit([id]); onClose(); }}><Focus size={13} className="shrink-0 text-muted" /><span className="truncate">{model.elements[id]!.label ?? id}</span></button><IconButton label={uiText("Organizar {0} horizontalmente", [model.elements[id]!.label ?? id])} disabled={busy} onClick={() => { void arrangeCanvasDiagram(id, 'right'); onClose(); }}><ArrowRight /></IconButton><IconButton label={uiText("Organizar {0} verticalmente", [model.elements[id]!.label ?? id])} disabled={busy} onClick={() => { void arrangeCanvasDiagram(id, 'down'); onClose(); }}><ArrowDown /></IconButton></div>)}</div>}
    <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void insert(title.trim() || uiText("Diagrama {0}", [frames.length + 1])); }}><label className="text-caption text-muted" htmlFor="canvas-diagram-title">{uiText("Novo diagrama")}</label><input id="canvas-diagram-title" aria-label={uiText("Nome do diagrama no canvas")} className={`${inputClass} h-9`} maxLength={120} placeholder={uiText("Diagrama {0}", [frames.length + 1])} value={title} onChange={event => setTitle(event.target.value)} /><Button type="submit" icon={<Plus size={14} />} disabled={busy}>{uiText("Criar área vazia")}</Button></form>
    <section className="flex min-h-0 flex-col gap-2"><h3 className="text-caption font-medium">{uiText("Trazer do workspace")}</h3><p className="text-meta leading-relaxed text-muted">{uiText("Adiciona uma cópia editável ao lado. O original permanece na sidebar.")}</p><label className="flex items-center gap-2 rounded-control bg-panel-2 px-2.5"><Search size={13} className="text-muted" /><input aria-label={uiText("Buscar diagramas para adicionar")} placeholder={uiText("Buscar diagrama…")} className="h-9 min-w-0 flex-1 bg-transparent text-caption outline-none" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="max-h-44 overflow-y-auto">{data?.manifest.diagrams.filter(item => item.slug !== current && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <button key={item.slug} type="button" disabled={busy} aria-label={uiText("Adicionar {0} ao canvas", [item.title])} className="flex w-full items-center gap-2 rounded-control px-2 py-2.5 text-left text-caption text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-50" onClick={() => void insert(item.title, item.slug)}><CopyPlus size={14} /><span className="truncate">{item.title}</span></button>)}{!data?.manifest.diagrams.some(item => item.slug !== current) && <p className="py-2 text-meta text-faint">{uiText("Seus outros diagramas aparecerão aqui.")}</p>}</div></section>
  </div>;
}
