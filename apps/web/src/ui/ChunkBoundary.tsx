import { uiText } from '../i18n';
import { Component } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { closeRightPanel, showToast, toggleRightPanel, uiStore } from './uiStore';
import type { RightPanel } from './uiStore';

export const CHUNK_ERROR_MESSAGE = uiText("Não foi possível carregar este painel. Verifique a conexão e tente de novo.");

/** Browsers cache a failed module fetch for the life of the page, so a second failure is answered with a reload. */
const failedBefore = new Set<string>();
/** Test hook. */
export const resetChunkFailures = () => failedBefore.clear();
const reloadPage = () => window.location.reload();

/** Tells the visitor a lazy chunk failed; a right-slot panel also frees the slot and offers to reopen it (fresh import). */
export function reportChunkFailure(panel?: RightPanel): void {
  if (!panel) {
    showToast(CHUNK_ERROR_MESSAGE);
    return;
  }
  closeRightPanel(panel);
  const again = failedBefore.has(panel);
  failedBefore.add(panel);
  showToast(CHUNK_ERROR_MESSAGE, again
    ? { label: uiText("Recarregar a página"), run: reloadPage }
    : { label: uiText("Tentar de novo"), run: () => { if (uiStore.getState().rightPanel !== panel) toggleRightPanel(panel); } });
}

const CHUNK_PATTERN = /dynamically imported module|importing a module script failed|loading (css )?chunk|unable to preload/i;

/** True for the errors browsers throw when a lazy chunk cannot be fetched; anything else is a bug in our own render. */
export function isChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_PATTERN.test(error.message);
}

const GENERIC_ERROR_MESSAGE = uiText("Algo deu errado neste painel.");

interface Props {
  children: ReactNode;
  /** The right-slot panel this boundary guards: on failure the slot closes and the toast reopens it. */
  panel?: RightPanel;
  /** Fills the container (a doc or sketch view) instead of a compact inline message. */
  fill?: boolean;
  /** Runs when the guarded part fails (either kind), e.g. to release state a failed modal would keep. */
  onError?: () => void;
  /** A small decoration (a badge): a failure is toasted but leaves nothing on screen. */
  quiet?: boolean;
  /** Shows the failure as a modal-shaped overlay instead of inline (for modals that render nothing while loading). */
  overlay?: boolean;
}

/**
 * Keeps one failing part from blanking the whole app. A rejected lazy import keeps the connection message
 * (toast + retry); any other error is a render bug: it is logged and shown as a generic "algo deu errado" with retry.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean; chunk: boolean; attempts: number }> {
  state = { failed: false, chunk: true, attempts: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, chunk: isChunkError(error) };
  }

  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reportChunkFailure(this.props.panel);
    else console.error(uiText("Erro ao renderizar um painel:"), error);
    this.props.onError?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    const alert = (
      <div role="alert" className={`flex flex-col items-center justify-center gap-3 p-4 text-center text-body text-muted ${this.props.fill && !this.props.overlay ? 'h-full' : ''}`}>
        <p>{this.state.chunk ? uiText("Não foi possível carregar esta parte.") : GENERIC_ERROR_MESSAGE}</p>
        {this.state.attempts > 0 && this.state.chunk
          ? <Button size="sm" onClick={reloadPage}>{uiText("Recarregar a página")}</Button>
          : <Button size="sm" onClick={() => this.setState((s) => ({ failed: false, attempts: s.attempts + 1 }))}>{uiText("Tentar de novo")}</Button>}
      </div>
    );
    if (!this.props.overlay) return alert;
    return (
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
        <div className="sk-pop sk-elev-2 pointer-events-auto max-w-sm rounded-panel bg-panel">{alert}</div>
      </div>
    );
  }
}
