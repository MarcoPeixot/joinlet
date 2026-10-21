import { stableStringify } from './json';

/** `.arch/assistants.json`: saved instructions the chat can run, shared through git like any other file of the workspace. */
export const ASSISTANTS_PATH = 'assistants.json';

export type AssistantScope = 'diagram' | 'workspace';

export interface Assistant {
  id: string;
  name: string;
  /** What the chat sends as the person's message; the answer is the assistant's work. */
  instruction: string;
  /** `diagram`: the chat reads only the open diagram; `workspace`: all diagrams and documents. */
  scope: AssistantScope;
  /** Also sends what changed in the diagram since its last saved version. */
  changes?: true;
}

export const MAX_ASSISTANTS = 50;
export const MAX_NAME = 60;
export const MAX_INSTRUCTION = 4_000;

/** The file as written: fixed key order, a final newline. */
export function printAssistants(assistants: readonly Assistant[]): string {
  return stableStringify({ version: 1, assistants });
}

/** `validateAssistants` without loading it up front (only an edit needs it): a pt-BR reason when the list must not be saved, else `null`. */
export async function checkAssistants(assistants: readonly Assistant[]): Promise<string | null> {
  return (await import('./assistantsParse')).validateAssistants(assistants);
}
