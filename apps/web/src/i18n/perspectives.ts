import { allPerspectives, type Perspective } from '@strukt/workspace';
import { uiText } from './index';
export function localizedPerspectives(saved: readonly Perspective[] | undefined): Perspective[] {
  return allPerspectives(saved).map(item => saved?.some(own=>own.id===item.id) ? item : { ...item, name: uiText(item.name), description: item.description ? uiText(item.description) : undefined });
}
