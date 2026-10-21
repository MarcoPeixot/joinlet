import { systemMessage } from '../i18n';
import { createStore } from 'zustand/vanilla';
import type { ActivityReply, AuditEntry, NewInvite, ShareClient, ShareReply, ShareStatus, TunnelTtl } from './client';

export interface ShareState {
  open: boolean;
  status: ShareStatus;
  busy: boolean;
  error: string | null;
  /** The local server is not running: nothing to share through. */
  offline: boolean;
  /** The owner's audit log, newest first. */
  activity: AuditEntry[];
  activityError: string | null;
  setOpen(open: boolean): void;
  refresh(): Promise<void>;
  start(dir: string): Promise<void>;
  stop(): Promise<void>;
  createInvite(invite: NewInvite): Promise<boolean>;
  revokeInvite(id: string): Promise<void>;
  startTunnel(ttl: TunnelTtl): Promise<void>;
  stopTunnel(): Promise<void>;
  loadActivity(): Promise<void>;
}

export function createShareStore({ client }: { client: ShareClient }) {
  return createStore<ShareState>()((set, get) => {
    const settle = (reply: ShareReply, clearError = true): boolean => {
      if (reply.kind === 'ok') set({ status: reply.status, ...(clearError || get().offline ? { error: null } : {}), offline: false });
      else if (reply.kind === 'offline') set({ offline: true, error: reply.reason });
      else set({ error: systemMessage(reply.message) });
      return reply.kind === 'ok';
    };
    const settleActivity = (reply: ActivityReply) => {
      if (reply.kind === 'ok') set({ activity: reply.entries, activityError: null });
      else set({ activityError: reply.kind === 'offline' ? reply.reason : reply.message });
    };
    /** Runs an action with `busy` up; what it changed shows in the activity right after. */
    const act = async (work: () => Promise<ShareReply>): Promise<boolean> => {
      set({ busy: true, error: null });
      try {
        const ok = settle(await work());
        if (ok) void get().loadActivity();
        return ok;
      } catch (error) { set({ error: systemMessage(error instanceof Error ? error.message : String(error)) }); return false; }
      finally { set({ busy: false }); }
    };
    return {
      open: false,
      status: { active: false },
      busy: false,
      error: null,
      offline: false,
      activity: [],
      activityError: null,
      setOpen(open) {
        set({ open });
        if (open) {
          void get().refresh();
          void get().loadActivity();
        }
      },
      async refresh() {
        if (get().busy) return;
        settle(await client.status(), false);
      },
      async start(dir) {
        await act(() => client.start(dir));
      },
      async stop() {
        await act(() => client.stop());
      },
      createInvite: (invite) => act(() => client.createInvite(invite)),
      async revokeInvite(id) {
        await act(() => client.revokeInvite(id));
      },
      async startTunnel(ttl) {
        await act(() => client.startTunnel({ ttl }));
      },
      async stopTunnel() {
        await act(() => client.stopTunnel());
      },
      async loadActivity() {
        settleActivity(await client.activity());
      },
    };
  });
}
