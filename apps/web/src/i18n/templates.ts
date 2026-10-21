import { BASIC_TEMPLATES } from '@strukt/workspace';
import { uiText } from './index';
/** Translate built-in metadata; saved user templates and diagram identifiers stay untouched. */
export const localizeTemplate = (item: import('@strukt/workspace').DiagramTemplate) => ({ ...item, title: uiText(item.title), description: uiText(item.description), category: item.category ? uiText(item.category) : undefined, ops: item.ops.map(op => op.op === 'add_node' || op.op === 'add_group' ? { ...op, ...(op.label ? {label: uiText(op.label)} : {}), ...('description' in op && op.description ? {description: uiText(op.description)} : {}) } : op.op === 'connect' && op.label ? {...op, label: uiText(op.label)} : op) });

export const localizedTemplates = BASIC_TEMPLATES.map(localizeTemplate);
