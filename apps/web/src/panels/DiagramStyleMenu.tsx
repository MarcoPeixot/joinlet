import { uiText } from '../i18n';
import { LoaderCircle, Palette } from 'lucide-react';
import { useState } from 'react';
import { setDiagramStyle } from '../actions/elements';
import { composeArchitecture } from '../actions/layout';
import { Button } from '../ui/Button';
import { useDiagram } from '../state/appStore';
import { FieldGroup, Segmented } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import { Keys } from '../ui/Kbd';
import { Popover } from '../ui/Popover';
import { colorModes, styleModes, typefaces } from './styleOptions';

const orientations = [
  { value: 'right' as const, label: 'Horizontal' },
  { value: 'down' as const, label: 'Vertical' },
];

function DiagramStyleCard() {
  const model = useDiagram((s) => s.model);
  const { style } = model;
  const [composing, setComposing] = useState(false);
  const groups = model.order.filter((id) => model.elements[id]?.kind === 'group').length;
  return (
    <div className="flex w-[300px] flex-col">
      <div className="flex flex-col gap-3.5 p-3.5">
        <FieldGroup label={uiText("Orientação da composição")}>
          <Segmented value={style.direction === 'down' || style.direction === 'up' ? 'down' : 'right'} options={orientations} onChange={(direction) => setDiagramStyle({ direction })} />
        </FieldGroup>
        <Button disabled={composing} aria-busy={composing} icon={composing ? <LoaderCircle size={14} className="animate-spin" /> : undefined} onClick={async () => {
          setComposing(true);
          try { await composeArchitecture(); } finally { setComposing(false); }
        }}>{composing ? uiText("Compondo…") : uiText("Compor arquitetura")}</Button>
        <FieldGroup label={uiText("Cores")}>
          <Segmented value={style.colorMode} options={colorModes} onChange={(colorMode) => setDiagramStyle({ colorMode })} />
        </FieldGroup>
        <FieldGroup label={uiText("Estilo")}>
          <Segmented value={style.styleMode} options={styleModes} onChange={(styleMode) => setDiagramStyle({ styleMode })} />
        </FieldGroup>
        <FieldGroup label={uiText("Fonte")}>
          <Segmented value={style.typeface} options={typefaces} onChange={(typeface) => setDiagramStyle({ typeface })} />
        </FieldGroup>
      </div>
      <div className="flex flex-col gap-2 border-t border-line bg-panel-2/50 px-3.5 py-3 text-caption text-muted">
        <p className="font-mono text-meta text-faint">
          {model.order.length - groups} {uiText("nós ·")} {groups} {uiText("grupos ·")} {model.edges.length} {uiText("conexões")}</p>
        <ul className="flex flex-col gap-1.5">
          <li className="flex items-center justify-between gap-2">{uiText("Editar o nome")} <span className="text-faint">{uiText("duplo clique")}</span></li>
          <li className="flex items-center justify-between gap-2">{uiText("Conectar")} <span className="text-faint">{uiText("arraste de uma borda")}</span></li>
          <li className="flex items-center justify-between gap-2">{uiText("Próximo nó")} <Keys combo="⌘→" /></li>
          <li className="flex items-center justify-between gap-2">{uiText("Comandos")} <Keys combo="⌘K" /></li>
        </ul>
      </div>
    </div>
  );
}

/** "Aparência" on the canvas toolbar: the diagram-wide style in a popover, out of the way until asked for. */
export function DiagramStyleMenu({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label={uiText("Aparência do diagrama")}
      open={open && !disabled}
      onOpenChange={setOpen}
      side="right"
      align="start"
      trigger={
        <IconButton label={uiText("Aparência do diagrama")} tooltipSide="right" active={open && !disabled} disabled={disabled}>
          <Palette />
        </IconButton>
      }
    >
      <DiagramStyleCard />
    </Popover>
  );
}
