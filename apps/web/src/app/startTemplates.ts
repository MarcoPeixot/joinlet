import type { DiagramTemplate } from '@strukt/workspace';
import { aiStore } from '../ai/session';

/** The templates the empty state shows: the preferred ids first, then one per category (variety), then the rest in order. */
export function pickStartTemplates(all: readonly DiagramTemplate[], limit = 4, preferred: readonly string[] = []): DiagramTemplate[] {
  const picked: DiagramTemplate[] = [];
  for (const id of preferred) {
    const found = all.find((template) => template.id === id);
    if (found && picked.length < limit && !picked.includes(found)) picked.push(found);
  }
  const seen = new Set(picked.map((template) => template.category ?? `\0${template.id}`));
  for (const template of all) {
    const key = template.category ?? `\0${template.id}`;
    if (picked.length < limit && !seen.has(key)) {
      seen.add(key);
      picked.push(template);
    }
  }
  for (const template of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(template)) picked.push(template);
  }
  return picked;
}

/** Sends the empty-state prompt to the AI composer (draft → "Aplicar"). Blank text does nothing. */
export function startFromPrompt(text: string): boolean {
  const prompt = text.trim();
  if (!prompt) return false;
  const ai = aiStore.getState();
  ai.setMode('generate');
  ai.setPrompt(prompt);
  ai.setOpen(true);
  void ai.submit();
  return true;
}
