import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { liveThreads } from '@strukt/workspace';
import { AnimatePresence } from 'motion/react';
import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { docCommentBridge } from '../docs/commentBridge';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { PanelSkeleton } from '../ui/PanelSkeleton';
import { uiStore, useUi } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { useCollaborationSlice } from '../workspace/collaborationView';
import CommentsBadge from './CommentsBadge';
import CommentTool from './CommentTool';
import { CommentLayer } from './CommentLayer';
import { commentKey } from './keys';
import { commentSelection } from './selection';
import { comments, rememberRoom, targetOf, useComments, useWho } from './session';

const CommentsPanel = lazyWithRetry(() => import('./CommentsPanel').then((m) => ({ default: m.CommentsPanel })));

const DocComments=lazyWithRetry(()=>import('./DocComments'));

/** An empty element the bar or the palette left for the comments (see comments/lazy.tsx), found again when the view changes. */
function useSlot(name: string, key: unknown): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setElement(document.querySelector<HTMLElement>(`[data-slot="${name}"]`));
    find();
    const frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [name, key]);
  return element;
}

/** `C` and Escape for the comment tool of the canvas. */
function useToolKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const action = commentKey(event, comments.store.getState().tool);
      if (!action) return;
      event.preventDefault();
      comments.setTool(action === 'toggle' ? !comments.store.getState().tool : false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}

/**
 * Everything the comments need on screen: it follows the open item (loading and polling its comments file), draws the
 * pins on a diagram or the marks in a doc, and shows the panel when its slot is chosen. It is loaded on demand, after
 * the first paint; the panel itself is a chunk of its own, loaded when it is opened.
 */
export default function CommentsHost() {
  const view = useWorkspace((state) => state.view);
  const diagram = useWorkspace((state) => state.diagram);
  const source = useWorkspace((state) => state.source?.label);
  const presenting = useUi((state) => state.presenting);
  const panel = useUi((state) => state.rightPanel === 'comments');
  const target = targetOf(view, diagram);
  const kind = target?.kind;
  const slug = target?.slug;
  const room = useCollaborationSlice((state) => state.others.map((person) => `${person.name}|${person.color}`).join("\n"));
  const who = useWho();

  useEffect(() => {
    comments.attach(kind && slug ? { kind, slug } : null);
    return () => comments.attach(null);
  }, [kind, slug, source]);
  useEffect(() => { rememberRoom(); }, [room]);
  useToolKeys(kind === 'diagram' && who.canWrite && !presenting);
  const where = `${kind}:${presenting}`;
  const badgeSlot = useSlot('comments-badge', where);
  const toolSlot = useSlot('comments-tool', where);

  if (!target || presenting) return null;
  return (
    <>
      {badgeSlot && createPortal(<CommentsBadge />, badgeSlot)}
      {toolSlot && createPortal(<CommentTool />, toolSlot)}
      {target.kind === 'diagram' ? <CommentLayer /> : <Suspense fallback={null}><DocComments slug={target.slug}/></Suspense>}
      <AnimatePresence>
        {panel && <ChunkBoundary key="comments" panel="comments"><Suspense fallback={<PanelSkeleton label={uiText("Comentários")} />}><CommentsPanel /></Suspense></ChunkBoundary>}
      </AnimatePresence>
    </>
  );
}
