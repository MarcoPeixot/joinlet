import { uiText } from '../i18n';
export interface Shortcut {
  label: string;
  keys: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** What Configurações › Atalhos lists (the keys themselves live in app/useShortcuts.ts and AppShell). */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Canvas',
    items: [
      { label: uiText("Adicionar nó"), keys: 'N' },
      { label: uiText("Adicionar serviço com ícone"), keys: 'I' },
      { label: uiText("Próximo nó conectado"), keys: '⌘→' },
      { label: uiText("Mover seleção"), keys: '←↑→↓' },
      { label: uiText("Mover seleção 10 px"), keys: '⇧←' },
      { label: uiText("Editar o nome"), keys: '↵' },
      { label: uiText("Limpar seleção"), keys: 'Esc' },
    ],
  },
  {
    title: uiText("Edição"),
    items: [
      { label: uiText("Desfazer"), keys: '⌘Z' },
      { label: uiText("Refazer"), keys: '⇧⌘Z' },
      { label: uiText("Copiar"), keys: '⌘C' },
      { label: uiText("Colar"), keys: '⌘V' },
      { label: uiText("Duplicar seleção"), keys: '⌘D' },
      { label: uiText("Selecionar tudo"), keys: '⌘A' },
      { label: uiText("Agrupar seleção / novo grupo"), keys: '⌘G' },
      { label: uiText("Excluir seleção"), keys: '⌫' },
    ],
  },
  {
    title: uiText("Navegação"),
    items: [
      { label: uiText("Comandos"), keys: '⌘K' },
      { label: uiText("Configurações"), keys: '⌘,' },
      { label: uiText("Mostrar/ocultar barra lateral"), keys: '⌘\\' },
      { label: uiText("Salvar versão"), keys: '⌘S' },
    ],
  },
  {
    title: uiText("IA"),
    items: [
      { label: uiText("Abrir o assistente de IA"), keys: '⌘J' },
      { label: uiText("Enviar o pedido"), keys: '⌘↵' },
    ],
  },
];

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Groups whose shortcuts match the query (label or keys, case and accents ignored); empty groups drop out. */
export function filterShortcuts(query: string): ShortcutGroup[] {
  const q = fold(query.trim());
  if (!q) return SHORTCUT_GROUPS;
  return SHORTCUT_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => fold(item.label).includes(q) || fold(item.keys).includes(q)) })).filter(
    (group) => group.items.length > 0,
  );
}
