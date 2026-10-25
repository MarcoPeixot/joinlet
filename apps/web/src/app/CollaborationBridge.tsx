import { useEffect } from 'react';
import * as Y from 'yjs';
import { own } from '@strukt/core';
import { applyCollaborativeDiagramDelta, readCollaborativeDiagram, repairedLocalDiagram } from '@strukt/workspace/collaboration';
import { aiStore } from '../ai/session';
import { diagramStore } from '../state/appStore';
import { COLLAB_WAITING_LOCK } from '../state/locks';
import { workspace, useWorkspace } from '../workspace/appWorkspace';
import { collaborationSession } from '../workspace/boot';
import { matchesRemoteSource } from '../workspace/remote';
import { closeCollaborationClient, collaborationClient } from '../workspace/collaboration';
import { createDeltaOutbox } from '../workspace/collabOutbox';
import { setCollaborationHistory, showCollaborationClient, useCollaborationEpoch } from '../workspace/collaborationView';

const LOCAL_DIAGRAM = Symbol('local diagram');
/** The workspace loads a shared diagram with this lock; the bridge releases it once the room's state is applied. */
const WAITING = COLLAB_WAITING_LOCK;

/** Keeps the open diagram and its Yjs room in sync; docs bind directly in DocView. */
export function CollaborationBridge() {
  const slug = useWorkspace((state) => state.view.kind === 'diagram' ? state.diagram : null);
  const source = useWorkspace((state) => state.source?.label);
  const epoch = useCollaborationEpoch();

  useEffect(() => {
    const session = collaborationSession();
    if (!session || !slug || !matchesRemoteSource(session, source)) return;
    const client = collaborationClient(session, `diagram:${slug}`);
    const undo = new Y.UndoManager([
      client.doc.getMap('style'), client.doc.getMap('elements'), client.doc.getMap('edges'),
      client.doc.getMap('positions'), client.doc.getMap('element-order'), client.doc.getMap('edge-order'),
    ], { trackedOrigins: new Set([LOCAL_DIAGRAM]), captureTimeout: 500 });
    const previousUndo = diagramStore.getState().undo;
    const previousRedo = diagramStore.getState().redo;
    diagramStore.setState({
      undo: () => { if (!diagramStore.getState().readOnly) undo.undo(); },
      redo: () => { if (!diagramStore.getState().readOnly) undo.redo(); },
    });
    const updateHistory = () => setCollaborationHistory(undo.undoStack.length > 0, undo.redoStack.length > 0);
    undo.on('stack-item-added', updateHistory);
    undo.on('stack-item-popped', updateHistory);
    undo.on('stack-cleared', updateHistory);
    updateHistory();
    const stopUi = showCollaborationClient(client);
    workspace.setCollaborativeItem('diagram', slug);
    if (!client.ready && !diagramStore.getState().readOnly) diagramStore.setState({ readOnly: WAITING });
    let applying = false;
    let stopped = false;
    const outbox = createDeltaOutbox((before, after) =>
      applyCollaborativeDiagramDelta(client.doc, before, after, LOCAL_DIAGRAM));
    let initialized = false;

    const receive = (_update?: Uint8Array, origin?: unknown) => {
      if (origin === LOCAL_DIAGRAM || !client.ready) return;
      outbox.flush(); // our unsent frames go out before the remote state lands, never after it
      const snapshot = readCollaborativeDiagram(client.doc);
      if (!snapshot) return;
      if (aiStore.getState().draft) aiStore.getState().discard();
      applying = true;
      try {
        workspace.applyCollaborativeDiagram(slug, snapshot);
        if (diagramStore.getState().readOnly === WAITING) diagramStore.setState({ readOnly: null });
        initialized = true;
      } finally { applying = false; }
    };
    client.doc.on('update', receive);
    const stopReady = client.subscribe(() => {
      if (client.status !== 'connected' && !diagramStore.getState().readOnly) diagramStore.setState({ readOnly: WAITING });
      if (client.ready && !initialized) receive();
      if (client.ready && initialized && client.status === 'connected' && diagramStore.getState().readOnly === WAITING) diagramStore.setState({ readOnly: null });
    });
    const stopDiagram = diagramStore.subscribe((state, before) => {
      if (!initialized || applying || !workspace.isLocalEdit(slug)) return;
      const gestureEnded = Boolean(before.pending) && !state.pending;
      if (state.model !== before.model || state.layout.nodes !== before.layout.nodes) {
        outbox.push({ model: before.model, layout: before.layout }, { model: state.model, layout: state.layout }, Boolean(state.pending));
      }
      if (gestureEnded) outbox.flush();
      if (state.past.length > before.past.length || gestureEnded) undo.stopCapturing();
      // The host repairs what this edit breaks (a move nested too deep) and every peer shows it repaired: show it now
      // too, after this notification (not nested in it). Only for model changes, never per drag frame; the host
      // writes the repair, never this client.
      const repaired = state.model !== before.model && !state.pending ? repairedLocalDiagram({ model: state.model, layout: state.layout }) : null;
      if (repaired) queueMicrotask(() => {
        if (stopped || diagramStore.getState().model !== state.model) return;
        applying = true;
        try { workspace.applyCollaborativeDiagram(slug, repaired); }
        finally { applying = false; }
      });
    });
    return () => {
      stopped = true;
      stopDiagram();
      outbox.dispose();
      stopReady();
      client.doc.off('update', receive);
      stopUi();
      undo.destroy();
      diagramStore.setState({ undo: previousUndo, redo: previousRedo });
      setCollaborationHistory(null, null);
      workspace.setCollaborativeItem('diagram', null);
      if (diagramStore.getState().readOnly === WAITING) diagramStore.setState({ readOnly: null });
      // Deleted here: leave its room (the host sees the files gone and tells the other peers).
      if (!own(workspace.store.getState().data?.diagrams ?? {}, slug)) closeCollaborationClient(session, `diagram:${slug}`);
    };
  }, [slug, source, epoch]);

  return null;
}
