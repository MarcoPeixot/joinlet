import type { ComponentPreset } from '@strukt/core';
import { systemMessage, uiText } from './index';
export function componentCopy(item: ComponentPreset): ComponentPreset {
  return { ...item, label: uiText(item.label), description: systemMessage(item.description), category: uiText(item.category) };
}
