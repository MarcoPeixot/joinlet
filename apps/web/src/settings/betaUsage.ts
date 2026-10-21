import { acceptAccessPlan } from './accessPlan';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { RemoteSession } from '../workspace/remote';
import { accessEnded } from '../workspace/accessEnded';
import { systemMessage } from '../i18n';

export interface BetaUsage { scope: 'account' | 'shared'; ownedWorkspaces?: number; workspaceOwner?: boolean; participants: number }
export const betaUsageStore = createStore<{ usage: BetaUsage | null; unavailable: boolean }>()(() => ({ usage: null, unavailable: false }));
export const useBetaUsage = () => useStore(betaUsageStore);

/** Also keeps Overview/document viewers in the workspace's occupancy, without opening a diagram socket. */
export function trackBetaUsage(session: RemoteSession): () => void {
  let stopped = false;
  let pending = false;
  const controller = new AbortController();
  const refresh = async () => {
    if (pending || stopped) return;
    pending = true;
    try {
      const response = await fetch(`${session.apiBase ?? '/api'}/remote/plan`, { signal: controller.signal, cache: 'no-store' });
      const value = await response.json();
      if (stopped) return;
      if (response.status === 403 && value.code === 'PARTICIPANT_LIMIT_REACHED') {
        accessEnded(systemMessage(value.error));
        betaUsageStore.setState({ unavailable: true });
        return;
      }
      if (!response.ok || !['account', 'shared'].includes(value.scope) || typeof value.participants !== 'number') throw new Error('Plan unavailable');
      acceptAccessPlan(value, session.owner);
      betaUsageStore.setState({ usage: value, unavailable: false });
    } catch { if (!stopped) betaUsageStore.setState({ unavailable: true }); }
    finally { pending = false; }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 15_000);
  return () => { stopped = true; clearInterval(timer); controller.abort(); betaUsageStore.setState({ usage: null, unavailable: false }); };
}
