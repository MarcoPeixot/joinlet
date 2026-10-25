import { getLocale } from '../i18n';
import { sketchContext } from '../sketch/context';
import { captureChatEdit, flushChatEdits } from './edit';
import { printDiagramJson } from '@strukt/json';
import { useStore } from 'zustand';
import { requestChat } from '../ai/client';
import { diagramStore } from '../state/appStore';
import { workspace } from '../workspace/appWorkspace';
import { catalogStore } from '../workspace/catalog';
import { buildChatContext } from './context';
import { createChatStore } from './store';
import { chatBinding, isRemoteLabel } from './workspaceKey';
import type { ChatState } from './store';
import {repositoryAnalysisContext,repositoryAnalysisText,verifyRepositoryAnalysisContext,followRepositoryAnalysisConversation} from '../workspace/repositoryAnalysis';

export interface ChatContextOptions {
  /** `diagram`: only the diagram of the workspace (an assistant scoped to it). */
  scope?: 'diagram' | 'workspace';
  /** Adds the diff against the diagram's latest saved version (asynchronous: reads the version). */
  changes?: true;
}

/**
 * What the assistant reads: the open diagram as the canvas has it right now, the rest as last saved. An assistant's run
 * narrows it (`scope`) and may add the diff against the last version (`changes`, so the answer is then asynchronous).
 */
export function currentChatContext(options?: ChatContextOptions): string | Promise<string> {
  return options?.changes ? import('./changes').then((m) => m.currentChanges()).then((extra) => buildContext(options, extra)) : buildContext(options);
}

function buildContext(options?: ChatContextOptions, extra?: string): string {
  const { data, view, diagram } = workspace.store.getState();
  if (!data) return '';
  const diagrams = data.manifest.diagrams.map((item) => ({
    slug: item.slug,
    title: item.title,
    json: printDiagramJson(item.slug === diagram ? diagramStore.getState().model : (data.diagrams[item.slug]?.model ?? diagramStore.getState().model)),
  }));
  const sketches = data.manifest.sketches.map((item) => ({ slug: item.slug, title: item.title, json: sketchContext(data.sketches[item.slug] ?? '') }));
  const docs = data.manifest.docs.map((item) => ({ slug: item.slug, title: item.title, markdown: data.docs[item.slug] ?? '' }));
  const scoped = options?.scope === 'diagram' && diagram !== null;
  const open =
    scoped ? ({ kind: 'diagram', slug: diagram } as const)
    : view.kind === 'board' ? ({ kind: 'board' } as const)
    : view.kind === 'diagram' ? ({ kind: 'diagram', slug: diagram ?? '' } as const)
    : view.kind === 'doc' ? ({ kind: 'doc', slug: view.slug } as const)
    : ({ kind: 'sketch', slug: view.slug, title: data.manifest.sketches.find((item) => item.slug === view.slug)?.title } as const);
  const sourceContext=repositoryAnalysisText();
  return (getLocale() === 'en' ? 'Interface language: English. Respond in English unless the user requests another language. Preserve all existing workspace identifiers and user-authored content.\n\n' : '') + buildChatContext({ workspace: data.manifest.name, open, diagrams, docs, sketches, ...(options?.scope ? { scope: options.scope } : {}), ...((extra||sourceContext)?{extra:[extra,sourceContext].filter(Boolean).join('\n\n')}:{}) });
}

/** Conversations live in the browser (per workspace); a blocked storage (private window) just means they are not kept. */
const storage = {
  get: (key: string) => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set: (key: string, value: string) => { try { globalThis.localStorage?.setItem(key, value); } catch { /* not kept */ } },
};

export const chatStore = createChatStore({
  request: async (turns, context, signal, onText, sessionId, selection, onSearch, onActivity) => {
    const captured = captureChatEdit();
    const repositoryContext=repositoryAnalysisContext();
    if(repositoryContext)try{await verifyRepositoryAnalysisContext(repositoryContext);}catch(error){return {kind:'error',message:error instanceof Error?error.message:String(error)};}
    const reply = await requestChat(turns, context, undefined, signal, onText, captured.target?.kind === 'sketch' ? { ...captured.target, content: sketchContext(captured.target.content) } : captured.target, sessionId, selection, onSearch);
    if (reply.kind !== 'ok' || !reply.edit || signal.aborted) return reply;
    onActivity?.('applying');
    try { await verifyRepositoryAnalysisContext(repositoryContext);return { ...reply, change: await captured.apply(reply.edit, signal) }; }
    catch (err) { return { kind: 'error', message: err instanceof Error ? err.message : String(err) }; }
  },
  getContext: async (options) => { await flushChatEdits(); return currentChatContext(options); },
  storage,
});
chatStore.subscribe((state,previous)=>{if(state.activeId!==previous.activeId)followRepositoryAnalysisConversation(state.activeId);});

/**
 * Which conversations belong to the open workspace: its id in the project list (a rename or a re-opened folder keeps
 * them), or where it lives plus its name when it has none (remote sessions, unavailable list). The list learns the id
 * only after the workspace opens, so an id-keyed workspace switch is followed from the catalog's change, not the workspace's.
 */
const follow = () => {
  const { data, source } = workspace.store.getState();
  if (!data || !source) return;
  const { key, legacy } = chatBinding({ name: data.manifest.name, label: source.label, catalogId: catalogStore.getState().activeId });
  chatStore.getState().bind(key, legacy);
};
workspace.store.subscribe((state) => {
  if (!state.data || !state.source) return;
  // A listed workspace is followed through the catalog (its change comes after the open); renaming it moves nothing.
  if (!isRemoteLabel(state.source.label) && catalogStore.getState().activeId !== null) return;
  follow();
});
catalogStore.subscribe(follow);
follow();

export function useChat<T>(selector: (state: ChatState) => T): T {
  return useStore(chatStore, selector);
}

// A reload or background page eviction preserves the partial answer and cancels pending edits.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => chatStore.getState().stop());
