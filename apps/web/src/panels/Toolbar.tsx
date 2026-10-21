import { uiText } from '../i18n';
import { PanelsTopLeft, Blocks, CodeXml, Group, Redo2, Server, Square, Undo2 } from 'lucide-react';
import { Suspense, useState } from 'react';
import { addComponentAt, addNodeAt, groupSelectionOrCreate } from '../actions/elements';
import { diagramStore, useDiagram } from '../state/appStore';
import { useCollaborationView } from '../workspace/collaborationView';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { IconButton } from '../ui/IconButton';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { useIsMobile } from '../ui/useBreakpoint';
import { DiagramStyleMenu } from './DiagramStyleMenu';
import { Popover } from '../ui/Popover';
import { toggleCode, uiStore, useUi } from '../ui/uiStore';

const ComponentLibrary = lazyWithRetry(() => import('./ComponentLibrary').then((module) => ({ default: module.ComponentLibrary })));

const CanvasDiagrams = lazyWithRetry(() => import('./CanvasDiagrams').then(m => ({ default: m.CanvasDiagrams })));

const Divider = () => <span className="my-1 h-px w-5 max-sm:mx-1 max-sm:my-0 max-sm:h-5 max-sm:w-px" />;

export function Toolbar({ center }: { center: () => { x: number; y: number } }) {
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [componentsOpen, setComponentsOpen] = useState(false);
  const localUndo = useDiagram((s) => s.past.length > 0);
  const localRedo = useDiagram((s) => s.future.length > 0);
  const history = useCollaborationView();
  const canUndo = history.canUndo ?? localUndo;
  const canRedo = history.canRedo ?? localRedo;
  // An AI draft is pending: nothing can be edited until it is applied or discarded.
  const locked = useDiagram((s) => s.readOnly !== null);
  // A phone lays the palette out as a row under the bar; everywhere else it is a column on the left edge.
  const row = useIsMobile();
  const codeOpen = useUi(s => s.codeOpen);
  const tip = { tooltipSide: row ? 'bottom' : 'right' } as const;

  return (
    <div role="toolbar" aria-orientation={row ? 'horizontal' : 'vertical'} aria-label={uiText("Ferramentas do diagrama")} className="sk-diagram-tools sk-float absolute left-3 z-20 flex max-h-[80%] flex-col items-center gap-0.5 overflow-y-auto rounded-panel p-1 max-sm:left-1/2 max-sm:max-w-[calc(100%-24px)] max-sm:-translate-x-1/2 max-sm:flex-row max-sm:overflow-x-auto max-sm:overflow-y-hidden">
      <IconButton {...tip} label={uiText("Adicionar nó (N)")} disabled={locked} onClick={() => addNodeAt(center(), 'shape')}>
        <Square />
      </IconButton>
      <IconButton {...tip} label={uiText("Adicionar serviço com ícone (I)")} disabled={locked} onClick={() => addNodeAt(center(), 'icon')}>
        <Server />
      </IconButton>
      <Popover label={uiText("Biblioteca de componentes")} open={componentsOpen && !locked} onOpenChange={setComponentsOpen} onCloseAutoFocus={(event) => { if (uiStore.getState().editingId) event.preventDefault(); }} side={row ? 'bottom' : 'right'} align="start" trigger={<IconButton {...tip} label={uiText("Biblioteca de componentes")} disabled={locked} active={componentsOpen && !locked}><Blocks /></IconButton>}>
        {componentsOpen && !locked && <ChunkBoundary><Suspense fallback={<p className="w-[420px] max-w-[calc(100vw-32px)] p-3 text-caption text-muted">{uiText("Carregando componentes…")}</p>}>
          <ComponentLibrary onManage={() => setComponentsOpen(false)} onSelect={(preset) => { setComponentsOpen(false); addComponentAt(center(), preset); }} />
        </Suspense></ChunkBoundary>}
      </Popover>
      <IconButton {...tip} label={uiText("Agrupar seleção / novo grupo (⌘G)")} disabled={locked} onClick={() => groupSelectionOrCreate(center())}>
        <Group />
      </IconButton>
      <Popover label={uiText("Diagramas no canvas")} open={diagramsOpen && !locked} onOpenChange={setDiagramsOpen} side={row ? 'bottom' : 'right'} align="start" trigger={<IconButton {...tip} label={uiText("Adicionar diagrama ao canvas")} disabled={locked} active={diagramsOpen}><PanelsTopLeft /></IconButton>}>
        {diagramsOpen && !locked && <ChunkBoundary><Suspense fallback={<p className="p-4 text-caption text-muted">{uiText("Carregando…")}</p>}><CanvasDiagrams onClose={() => setDiagramsOpen(false)} /></Suspense></ChunkBoundary>}
      </Popover>
      <span data-slot="comments-tool" className="contents" />
      <Divider />
      <IconButton {...tip} label={uiText("Desfazer (⌘Z)")} disabled={locked || !canUndo} onClick={() => diagramStore.getState().undo()}>
        <Undo2 />
      </IconButton>
      <IconButton {...tip} label={uiText("Refazer (⇧⌘Z)")} disabled={locked || !canRedo} onClick={() => diagramStore.getState().redo()}>
        <Redo2 />
      </IconButton>
      <Divider />
      <span data-tour="code" className="flex">
        <IconButton {...tip} label={uiText("Mostrar/ocultar código")} title={uiText("Código: o diagrama como JSON")} pressed={codeOpen} onClick={toggleCode}><CodeXml /></IconButton>
      </span>
      <DiagramStyleMenu disabled={locked} />
    </div>
  );
}
