import { uiText } from '../i18n';
import type { ItemKind } from '@strukt/workspace';
import { COLOR_MODES, STYLE_MODES, TYPEFACES } from '@strukt/core';
import { docSession, toggleAi } from '../ai/session';
import { generateAgentContext } from '../context/session';
import { openGithub } from '../github/session';
import { openSettings } from '../settings/store';
import { COLOR_MODE_LABELS, STYLE_MODE_LABELS, TYPEFACE_LABELS } from '../diagram/labels';
import { diagramStore } from '../state/appStore';
import { setTheme, toggleCode, toggleFlowAnimation, toggleMinimap, toggleRightPanel, uiStore } from '../ui/uiStore';
import { openPlanFuture, openSaveVersion, toggleVersions } from '../versions/session';
import { togglePresentation } from '../present/presentStore';
import { openItem } from '../workspace/actions';
import { reloadWorkspace, workspace } from '../workspace/appWorkspace';
import { exportZip, openFolderPicker } from '../workspace/boot';
import { startTour } from '../onboarding/tour';
import { duplicateSelection } from './clipboard';
import { addNodeAt, deleteSelection, groupSelectionOrCreate, removeAll, selectAll, setDiagramStyle } from './elements';
import { loadExample } from './example';
import { copyDiagramAs, exportDiagram } from './export';
import { reorganize } from './layout';

export const COMMAND_SECTIONS = [uiText("Ações"), uiText("Ir para"), uiText("Aparência"), uiText("IA")] as const;
export type CommandSection = (typeof COMMAND_SECTIONS)[number];

export interface Command {
  id: string;
  title: string;
  section: CommandSection;
  hint?: string;
  run: () => void;
}

/** Workspace items the palette can jump to (the manifest lists: slug + title). */
export type CommandItems = Record<ItemKind, { slug: string; title: string }[]>;

const ITEM_PREFIX: Record<ItemKind, string> = { diagram: uiText("Diagrama"), doc: uiText("Documento"), sketch: 'Sketch' };

export function buildCommands(ctx: { center: () => { x: number; y: number }; flowAnimation: boolean; items?: Partial<CommandItems> }): Command[] {
  const store = () => diagramStore.getState();
  const action = (id: string, title: string, run: () => void, hint?: string): Command => ({ id, title, section: uiText("Ações"), run, ...(hint ? { hint } : {}) });
  const look = (id: string, title: string, run: () => void): Command => ({ id, title, section: uiText("Aparência"), run });
  const goto = (id: string, title: string, run: () => void, hint?: string): Command => ({ id, title, section: uiText("Ir para"), run, ...(hint ? { hint } : {}) });
  const ai = (id: string, title: string, run: () => void, hint?: string): Command => ({ id, title, section: uiText("IA"), run, ...(hint ? { hint } : {}) });
  const kinds: ItemKind[] = ['diagram', 'doc', 'sketch'];
  return [
    action('add-node', uiText("Adicionar nó"), () => addNodeAt(ctx.center(), 'shape'), 'N'),
    action('add-icon', uiText("Adicionar serviço com ícone"), () => addNodeAt(ctx.center(), 'icon'), 'I'),
    action('group', uiText("Agrupar seleção / novo grupo"), () => groupSelectionOrCreate(ctx.center()), '⌘G'),
    action('duplicate', uiText("Duplicar seleção"), duplicateSelection, '⌘D'),
    action('select-all', uiText("Selecionar tudo"), selectAll, '⌘A'),
    action('delete', uiText("Excluir seleção"), deleteSelection, '⌫'),
    action('undo', uiText("Desfazer"), () => store().undo(), '⌘Z'),
    action('redo', uiText("Refazer"), () => store().redo(), '⇧⌘Z'),
    action('clear', uiText("Limpar diagrama"), removeAll),
    action('example', uiText("Carregar diagrama de exemplo"), loadExample),
    action('export-svg', uiText("Exportar SVG"), () => void exportDiagram('svg')),
    action('export-png', uiText("Exportar PNG"), () => void exportDiagram('png')),
    action('export-mermaid', uiText("Exportar: Mermaid"), () => void copyDiagramAs('mermaid')),
    action('export-plantuml', uiText("Exportar: PlantUML"), () => void copyDiagramAs('plantuml')),
    action('reorganize', uiText("Reorganizar diagrama"), () => void reorganize()),
    action('suggest-levels', uiText("Sugerir níveis C4"), () => void import('../perspectives/suggest').then((module) => module.requestLevelSuggestions())),
    action('open-folder', uiText("Abrir pasta do workspace…"), () => void openFolderPicker()),
    action('export-zip', uiText("Exportar workspace (.zip)"), () => void exportZip()),
    action('save-version', uiText("Salvar versão"), openSaveVersion, '⌘S'),
    action('settings', uiText("Configurações"), () => openSettings(), '⌘,'),
    action('agent-context', uiText("Gerar contexto para agentes"), () => void generateAgentContext()),
    action('tour', uiText("Refazer o tour"), startTour),
    action('present', uiText("Modo apresentação"), togglePresentation, 'P'),
    action('reload-disk', uiText("Recarregar do disco (mudanças de agente)"), () => void reloadWorkspace()),
    ...kinds.flatMap((kind) =>
      (ctx.items?.[kind] ?? []).map((item) => goto(`goto-${kind}-${item.slug}`, `${ITEM_PREFIX[kind]}: ${item.title}`, () => void openItem(kind, item.slug))),
    ),
    goto('open-board', 'Overview', () => void workspace.show({ kind: 'board' })),
    goto('toggle-code', uiText("Painel: Código"), toggleCode),
    goto('versions', uiText("Painel: Versões"), toggleVersions),
    goto('panel-flows', uiText("Painel: Fluxos"), () => toggleRightPanel('flows')),
    goto('panel-model', uiText("Painel: Modelo"), () => toggleRightPanel('model')),
    goto('panel-perspectives', uiText("Painel: Perspectivas"), () => toggleRightPanel('perspectives')),
    goto('panel-accuracy', uiText("Painel: Precisão"), () => toggleRightPanel('accuracy')),
    goto('panel-timeline', uiText("Painel: Linha do tempo"), () => toggleRightPanel('timeline')),
    action('plan-future', uiText("Planejar estado futuro…"), openPlanFuture),
    goto('github', uiText("Painel: GitHub"), openGithub),
    ...COLOR_MODES.map((colorMode) => look(`color-${colorMode}`, uiText("Cores: {0}", [COLOR_MODE_LABELS[colorMode]]), () => setDiagramStyle({ colorMode }))),
    ...STYLE_MODES.map((styleMode) => look(`style-${styleMode}`, uiText("Estilo: {0}", [STYLE_MODE_LABELS[styleMode]]), () => setDiagramStyle({ styleMode }))),
    ...TYPEFACES.map((typeface) => look(`font-${typeface}`, uiText("Fonte: {0}", [TYPEFACE_LABELS[typeface]]), () => setDiagramStyle({ typeface }))),
    look('flow', ctx.flowAnimation ? uiText("Parar animação do fluxo") : uiText("Animar fluxo"), toggleFlowAnimation),
    look('theme', uiText("Alternar tema claro/escuro"), () => setTheme(uiStore.getState().theme === 'dark' ? 'light' : 'dark')),
    look('minimap', uiText("Mostrar/ocultar minimapa"), toggleMinimap),
    ai('ai', uiText("Editar com IA"), toggleAi, '⌘J'),
    ai('doc', uiText("Gerar documentação"), () => void docSession.generate()),
    ai('settings-ai', uiText("Configurar provider de IA (Anthropic, OpenRouter, OpenAI)"), () => openSettings('ai')),
    goto('settings-integrations', uiText("Integrações: Slack, Notion, Confluence e Jira"), () => openSettings('integrations')),
  ];
}
