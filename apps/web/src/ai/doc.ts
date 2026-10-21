import { uiText } from '../i18n';
import { printDiagramJson } from '@strukt/json';
import { createStore } from 'zustand/vanilla';
import type { DiagramStore } from '../state/diagramStore';
import type { DocReply } from './client';

export interface DocState {
  open: boolean;
  status: 'loading' | 'ready' | 'error';
  markdown: string;
  error: string | null;
}

export interface DocDeps {
  requestDoc: (json: string, signal?: AbortSignal) => Promise<DocReply>;
  flushCode?: () => Promise<void>;
}

/** "Gerar documentação": the architecture doc of the current diagram, shown in a modal (M4 will store it). */
export function createDocSession(diagram: DiagramStore, deps: DocDeps) {
  const store = createStore<DocState>()(() => ({ open: false, status: 'loading', markdown: '', error: null }));
  let request = 0;
  // Aborted by close(), so a request abandoned mid-flight stops instead of billing on.
  let controller: AbortController | null = null;

  async function generate(): Promise<void> {
    const ticket = ++request;
    controller = new AbortController();
    store.setState({ open: true, status: 'loading', markdown: '', error: null });
    try {
      await deps.flushCode?.();
      if (ticket !== request || !store.getState().open) return; // closed (or asked again) during the flush
      const { model } = diagram.getState();
      if (!model.order.length) {
        store.setState({ status: 'error', error: uiText("O diagrama está vazio.") });
        return;
      }
      const reply = await deps.requestDoc(printDiagramJson(model), controller.signal);
      if (ticket !== request || !store.getState().open) return; // closed or asked again meanwhile
      if (reply.kind === 'ok') store.setState({ status: 'ready', markdown: reply.markdown });
      else if (reply.kind === 'offline') store.setState({ status: 'error', error: uiText("Gerar documentação precisa do servidor de IA. {0}", [reply.reason]) });
      else store.setState({ status: 'error', error: reply.message });
    } catch (err) {
      if (ticket === request) store.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  function close(): void {
    request++;
    controller?.abort();
    store.setState({ open: false });
  }

  return { store, generate, close };
}
