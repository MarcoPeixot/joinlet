import { uiText } from '../i18n';
import { useReactFlow, useStore } from '@xyflow/react';
import type { FitViewOptions } from '@xyflow/react';
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from './IconButton';

const DEFAULT_FIT: FitViewOptions = { padding: 0.2, maxZoom: 1 };

/** Bottom-left of a canvas: zoom out, the current zoom (click = 100%), zoom in, fit; optionally the minimap toggle. */
export function ZoomControls({ fit = DEFAULT_FIT, minimap, onToggleMinimap }: { fit?: FitViewOptions; minimap?: boolean; onToggleMinimap?: () => void }) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="sk-float flex items-center gap-0.5 rounded-[12px] p-1">
      <IconButton label={uiText("Diminuir zoom")} className="pointer-coarse:hidden" tooltipSide="top" onClick={() => void flow.zoomOut({ duration: 180 })}>
        <Minus />
      </IconButton>
      <button
        type="button"
        aria-label={uiText("Zoom em 100%")}
        title={uiText("Voltar a 100%")}
        onClick={() => void flow.zoomTo(1, { duration: 180 })}
        className="h-8 min-w-12 rounded-control px-1 font-mono text-meta text-muted sk-num transition-colors hover:bg-panel-2 hover:text-ink"
      >
        {Math.round(zoom * 100)}{"%"}</button>
      <IconButton label={uiText("Aumentar zoom")} className="pointer-coarse:hidden" tooltipSide="top" onClick={() => void flow.zoomIn({ duration: 180 })}>
        <Plus />
      </IconButton>
      <span className="mx-0.5 h-5 w-px bg-line pointer-coarse:hidden" />
      <IconButton label={uiText("Ajustar à tela")} tooltipSide="top" onClick={() => void flow.fitView({ ...fit, duration: 220 })}>
        <Maximize />
      </IconButton>
      {onToggleMinimap && (
        <IconButton label={uiText("Mostrar/ocultar minimapa")} tooltipSide="top" pressed={minimap} onClick={onToggleMinimap}>
          <MapIcon />
        </IconButton>
      )}
    </div>
  );
}
