import { readFiles, parseCommentsPath } from '@strukt/workspace';
import { uiText, systemMessage } from '../i18n';
import { flushCodeEdits } from '../code/registry';
import { workspace } from '../workspace/appWorkspace';
import { catalogStore } from '../workspace/catalog';
import { collaborationSession, connectRepositoryNow, joinOwnedCollaboration, leaveOwnedCollaboration } from '../workspace/boot';
import { shareClient } from './client';
import { shareStore } from './session';
import type { ShareReply } from './client';

function accepted(reply: ShareReply) {
  if (reply.kind !== 'ok') throw new Error(reply.kind === 'offline' ? reply.reason : reply.message);
  shareStore.setState({ status: reply.status, offline: false });
  return reply.status;
}

/** One explicit action prepares storage, joins the owner and releases an edit link. */
export async function releaseCollaborationLink(external = true): Promise<void> {
  if (shareStore.getState().busy) return;
  shareStore.setState({ busy: true, error: null });
  try {
    await flushCodeEdits();
    await workspace.prepareSwitch();
    if (collaborationSession()?.mode === 'cloud') {
      const status = accepted(await shareClient.status());
      if (status.active && !status.invites.some(invite => invite.role === 'edit')) accepted(await shareClient.createInvite({name:uiText('Link de colaboração'),role:'edit',ttl:'never'}));
      await shareStore.getState().refresh();
      return;
    }
    const catalog = catalogStore.getState();
    const entry = catalog.catalog?.entries.find(item => item.id === catalog.activeId);
    const dir = entry?.location.kind === 'repository' ? entry.location.root : undefined;
    let status = accepted(await shareClient.status());
    if (status.active && status.root !== dir && !collaborationSession()?.owner) throw new Error(uiText('Outro workspace está sendo compartilhado. Encerre esse compartilhamento antes de continuar.'));
    if (!status.active) {
      const storage = workspace.storage();
      if (!storage) throw new Error(uiText('Nenhum workspace aberto para copiar.'));
      const files = dir ? undefined : { ...await readFiles(storage, path => path.startsWith('versions/') || path.startsWith('context/') || parseCommentsPath(path) !== null), ...workspace.files() };
      status = accepted(await shareClient.prepare!({ ...(dir ? { dir } : { files }) }));
      if (!status.active) throw new Error(uiText('Não foi possível iniciar o compartilhamento.'));
      // Existing browser/folder storage is kept; the catalog opens the durable shared copy from now on.
      if (!dir) await connectRepositoryNow(status.root, { allowInitialize: false, quiet: true, projectId: catalog.activeId ?? undefined });
    }
    await joinOwnedCollaboration(status.root);
    if (!status.invites.some(invite => invite.role === 'edit')) {
      status = accepted(await shareClient.createInvite({ name: uiText('Link de colaboração'), role: 'edit', ttl: '24h' }));
    }
    if (external && status.active && !status.tunnel.active) accepted(await shareClient.startTunnel({ ttl: '24h' }));
    await shareStore.getState().refresh();
  } catch (error) {
    shareStore.setState({ error: systemMessage(error instanceof Error ? error.message : String(error)) });
  } finally { shareStore.setState({ busy: false }); }
}

export async function endOwnedSharing(): Promise<void> {
  const status = shareStore.getState().status;
  if (!status.active || shareStore.getState().busy) return;
  await workspace.prepareSwitch();
  await shareStore.getState().stop();
  if (collaborationSession()?.mode === 'cloud') return;
  if (!shareStore.getState().status.active) await leaveOwnedCollaboration(status.root);
}
