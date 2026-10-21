import { useAccessPlan } from '../settings/accessPlan';
import { useBetaUsage } from '../settings/betaUsage';
import { uiText } from '../i18n';
import { Share2, Square, Link2, Globe, Copy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { initials } from '../app/PresenceAvatars';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/uiStore';
import { ActivityList } from './ActivitySection';
import { InviteList, NewInviteForm } from './InviteSection';
import { collaborationSession } from '../workspace/boot';
import { releaseCollaborationLink, endOwnedSharing } from './quickShare';
import { closeShare, shareStore, useShare } from './session';

const copyLink = (url: string) =>
  navigator.clipboard.writeText(url).then(
    () => showToast(uiText("Link copiado.")),
    () => showToast(uiText("Não foi possível copiar o link.")),
  );

const TICK_MS = 15_000;
const ACTIVITY_MS = 5_000;

/** The clock the expiry labels read; it ticks while the dialog is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Releases the folder's workspace as live links (named invites with a role and an expiry), and lists who is connected. */
export function ShareDialog() {
  const { plan } = useAccessPlan();
  const open = useShare((s) => s.open);
  const status = useShare((s) => s.status);
  const busy = useShare((s) => s.busy);
  const error = useShare((s) => s.error);
  const offline = useShare((s) => s.offline);
  const activity = useShare((s) => s.activity);
  const activityError = useShare((s) => s.activityError);
  const [scope, setScope] = useState<'internet' | 'network'>('internet');
  const editInvite = status.active ? status.invites.find(invite => invite.role === 'edit') : undefined;
  const url = editInvite ? scope === 'internet' ? editInvite.publicUrl : editInvite.url : null;
  const hosted = collaborationSession()?.mode === 'cloud';
  const ready = Boolean(url) && !busy && collaborationSession()?.owner === true;
  const now = useNow();
  const beta = useBetaUsage();
  const actions = shareStore.getState();
  // Guests join and write while the dialog is open: the activity follows.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void shareStore.getState().loadActivity(), ACTIVITY_MS);
    return () => clearInterval(timer);
  }, [open]);
  return (
    <Modal open={open} onClose={closeShare} label={uiText("Compartilhar workspace")} title={uiText("Compartilhar workspace")} icon={<Share2 size={16} />} closeLabel={uiText("Fechar compartilhamento")} width={580}>
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5 text-body">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-accent-soft p-3 text-accent"><Users size={23} /></span>
          <div><h3 className="font-semibold text-ink">{uiText("Convide com um link. Editem juntos.")}</h3>
            <p className="mt-1 leading-relaxed text-muted">{uiText("Quem abrir o link entra no workspace e pode editar com você, sem cadastro ou aprovação.")}</p></div>
        </div>
        <p className="text-caption text-muted">{plan.name} · {plan.limits.participants === null ? uiText('Participantes sem limite de plano') : uiText('Até {0} pessoas, incluindo quem compartilhou', [plan.limits.participants])}{beta.usage && !beta.unavailable ? ` · ${beta.usage.participants}/${plan.limits.participants ?? '∞'}` : ''}</p>
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2 p-4" aria-label={uiText("Link de colaboração")}>
          <label className="flex items-center gap-2 font-medium"><Globe size={16} className="shrink-0" /><span className="whitespace-nowrap">{uiText("Acesso pelo link")}</span>
            <select aria-label={uiText("Alcance do link")} hidden={hosted} className={`${inputClass} ml-auto`} style={{ width: 'auto', maxWidth: '55%' }} value={scope} disabled={busy} onChange={event => { setScope(event.target.value as 'internet' | 'network'); shareStore.setState({ error: null }); }}>
              <option value="internet">{uiText("Qualquer lugar")}</option><option value="network">{uiText("Mesma rede")}</option>
            </select>
          </label>
          <p className="text-caption leading-relaxed text-muted">{hosted ? uiText("O workspace fica online no Joinlet. Revogue o link a qualquer momento nas opções abaixo.") : uiText("Qualquer pessoa com este link pode editar. Mantenha o Joinlet e este computador ligados durante a colaboração.")}</p>
          {ready ? <>
            <div className="flex gap-2"><input aria-label={uiText("Link para participar")} readOnly value={url!} onFocus={event => event.currentTarget.select()} className={`${inputClass} min-w-0 flex-1 font-mono text-caption`} />
              <Button variant="primary" icon={<Copy size={15} />} onClick={() => void copyLink(url!)}>{uiText("Copiar link")}</Button></div>
            <p role="status" className="text-caption text-accent">{uiText("Pronto para colaborar. Envie o link para sua equipe.")}</p>
          </> : <Button variant="primary" disabled={busy || offline} icon={<Link2 size={15} />} onClick={() => void releaseCollaborationLink(scope === 'internet')}>
            {busy ? uiText("Preparando colaboração…") : uiText("Liberar link de colaboração")}
          </Button>}
          {!hosted && scope === 'internet' && !ready && <p className="text-caption text-muted">{uiText("O acesso externo usa uma conexão temporária de até 24 horas. O servidor local precisa ter o cloudflared instalado.")}</p>}
        </section>
        {!hosted && !status.active && <p className="text-caption leading-relaxed text-muted">{uiText("Se o workspace estiver só no navegador ou em uma pasta aberta, criaremos uma cópia de trabalho salva neste computador. O original será preservado.")}</p>}
        {status.active && <>
          <section className="flex flex-col gap-2">
            <h3 className="sk-label">{uiText("Online agora ·")} {status.people.length}</h3>
            {status.people.length ? <ul aria-label={uiText("Pessoas online")} className="flex flex-wrap gap-2">
              {status.people.map((person, index) => <li key={`${index}:${person.name}`} data-person={person.name} className="flex items-center gap-2 rounded-full border border-line py-1.5 pl-1.5 pr-3">
                <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: person.color }}>{initials(person.name)}</span>
                <span className="max-w-40 truncate">{person.name}</span><span className="h-1.5 w-1.5 rounded-full bg-accent" />
              </li>)}
            </ul> : <p className="text-muted">{uiText("Ninguém conectado ainda. Envie o link.")}</p>}
          </section>
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer font-medium">{uiText("Permissões e opções avançadas")}</summary>
            <div className="mt-4 flex flex-col gap-4">
              <InviteList invites={status.invites} now={now} busy={busy} onCopy={link => void copyLink(link)} onRevoke={invite => void actions.revokeInvite(invite.id)} />
              <NewInviteForm busy={busy} onCreate={invite => actions.createInvite(invite)} />
              {status.tunnel.active && <Button disabled={busy} onClick={() => void actions.stopTunnel()}>{uiText("Desligar acesso público")}</Button>}
              <ActivityList entries={activity} error={activityError} onRefresh={() => void actions.loadActivity()} />
            </div>
          </details>
          <div className="flex justify-end"><Button disabled={busy} icon={<Square size={14} />} onClick={() => void endOwnedSharing().catch(error => shareStore.setState({ error: String(error.message) }))}>{uiText("Parar de compartilhar")}</Button></div>
        </>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
