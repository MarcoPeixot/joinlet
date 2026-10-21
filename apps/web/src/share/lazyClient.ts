import { uiText } from '../i18n';
import type { ActivityReply, ShareClient, ShareReply } from './client';

const UNLOADABLE = uiText("Não foi possível carregar o compartilhamento. Recarregue a página.");

/**
 * The share client, loaded on first use: the top bar's button needs the store at startup, but the client (validators
 * for the server's replies) only when the status is read, so it stays out of the initial bundle.
 */
export function lazyShareClient(load: () => Promise<ShareClient>): ShareClient {
  let loaded: Promise<ShareClient> | null = null;
  const client = () => (loaded ??= load().catch((error: unknown) => { loaded = null; throw error; }));
  const share = async (call: (client: ShareClient) => Promise<ShareReply>): Promise<ShareReply> => {
    try { return await call(await client()); } catch { return { kind: 'offline', reason: UNLOADABLE }; }
  };
  return {
    status: () => share((c) => c.status()),
    prepare: (input) => share((c) => c.prepare!(input)),
    start: (dir) => share((c) => c.start(dir)),
    stop: () => share((c) => c.stop()),
    createInvite: (invite) => share((c) => c.createInvite(invite)),
    revokeInvite: (id) => share((c) => c.revokeInvite(id)),
    startTunnel: (options) => share((c) => c.startTunnel(options)),
    stopTunnel: () => share((c) => c.stopTunnel()),
    async activity(): Promise<ActivityReply> {
      try { return await (await client()).activity(); } catch { return { kind: 'offline', reason: UNLOADABLE }; }
    },
  };
}
