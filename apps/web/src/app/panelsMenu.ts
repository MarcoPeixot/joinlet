import { uiText } from '../i18n';
import { pluralize } from '../ui/plural';
import type { RightPanel } from '../ui/uiStore';

export interface PanelEntry {
  id: RightPanel;
  label: string;
  description: string;
}

/** The right-hand panels, grouped by intent as the Painéis menu lists them. */
export const PANEL_GROUPS: readonly { label: string; panels: readonly PanelEntry[] }[] = [
  {
    label: uiText("Explorar"),
    panels: [
      { id: 'flows', label: uiText("Fluxos"), description: uiText("Percursos guiados, passo a passo") },
      { id: 'model', label: uiText("Modelo"), description: uiText("Entidades compartilhadas e lentes") },
      { id: 'perspectives', label: uiText("Perspectivas"), description: uiText("Níveis C4 e tags") },
      { id: 'accuracy', label: uiText("Precisão"), description: uiText("Apontamentos e evidências") },
      { id: 'comments', label: uiText("Comentários"), description: uiText("Conversas e menções") },
    ],
  },
  {
    label: uiText("Publicar"),
    panels: [
      { id: 'versions', label: uiText("Versões"), description: uiText("Salvar, comparar e restaurar") },
      { id: 'timeline', label: uiText("Linha do tempo"), description: uiText("Estados passados e planejados") },
      { id: 'github', label: "GitHub", description: uiText("Publicar mudanças do .arch/") },
    ],
  },
];

export interface PanelSignals {
  /** Open accuracy concerns. */
  concerns: number;
  /** Uncommitted changes under .arch/. */
  changes: number;
  /** The tag lens the Modelo panel left on, if any. */
  lens: string | null;
}

/** What a panel's menu item shows on its right: a count only when there is something to see (never "0"), or the active lens. */
export function panelHint(panel: RightPanel, signals: PanelSignals): string | undefined {
  if (panel === 'model') return signals.lens ?? undefined;
  const count = panel === 'accuracy' ? signals.concerns : panel === 'github' ? signals.changes : 0;
  return count > 0 ? String(count) : undefined;
}

/**
 * What a panel behind the trigger has to show, in words: the trigger carries a dot while this is not empty, and the
 * words go in its accessible name and tooltip. Nothing at zero.
 */
export function panelsSummary(signals: PanelSignals): string[] {
  const parts: string[] = [];
  if (signals.changes > 0) parts.push(uiText("{0} no .arch/", [pluralize(signals.changes, uiText("mudança pendente"), uiText("mudanças pendentes"), 'f')]));
  if (signals.concerns > 0) parts.push(uiText("{0} de precisão", [pluralize(signals.concerns, uiText("pendência"), uiText("pendências"), 'f')]));
  if (signals.lens !== null) parts.push(uiText("lente ativa: {0}", [signals.lens]));
  return parts;
}

/** The trigger names the open panel, so the bar still says where you are; "Painéis" when none is. */
export function panelsTriggerLabel(open: RightPanel | null): string {
  const entry = PANEL_GROUPS.flatMap((group) => group.panels).find((panel) => panel.id === open);
  return entry?.label ?? uiText("Painéis");
}
