import { uiText } from '../i18n';
import type { ItemKind } from '@strukt/workspace';
import { FileText, PenTool, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const ITEM_LABELS: Record<ItemKind, { section: string; one: string; placeholder: string }> = {
  diagram: { section: uiText("Diagramas"), one: uiText("diagrama"), placeholder: uiText("Nome do diagrama") },
  doc: { section: uiText("Documentos"), one: uiText("documento"), placeholder: uiText("Nome do documento") },
  sketch: { section: 'Sketches', one: 'sketch', placeholder: uiText("Nome do sketch") },
};

export const ITEM_ICONS: Record<ItemKind, LucideIcon> = { diagram: Workflow, doc: FileText, sketch: PenTool };
