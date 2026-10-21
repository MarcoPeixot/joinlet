import { uiText } from '../i18n';
import { Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Field, inputClass } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import type { InviteRole, InviteTtl, InviteView, NewInvite } from './client';
import { expiryLabel, roleLabel } from './format';

export const ROLE_HINTS: Record<InviteRole, string> = {
  edit: uiText("Edita junto com você."),
  comment: uiText("Vê ao vivo e comenta; não altera diagramas nem documentos."),
  view: uiText("Vê e navega ao vivo, mas não altera nada."),
};

export const TTL_OPTIONS: ReadonlyArray<{ value: InviteTtl; label: string }> = [
  { value: '1h', label: uiText("1 hora") },
  { value: '24h', label: uiText("24 horas") },
  { value: '7d', label: uiText("7 dias") },
  { value: 'never', label: uiText("Sem prazo") },
];

const ROLE_OPTIONS: InviteRole[] = ['edit', 'comment', 'view'];

/** The link a guest should get: the public one while public access is on, else the local-network one. */
export const linkOf = (invite: InviteView): string => invite.publicUrl ?? invite.url;

export function InviteRow({ invite, now, busy, onCopy, onRevoke }: { invite: InviteView; now: number; busy: boolean; onCopy(url: string): void; onRevoke(invite: InviteView): void }) {
  const url = linkOf(invite);
  const name = invite.name;
  return (
    <li data-invite={name} className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className="rounded-full border border-line px-2 py-0.5 text-caption text-muted">{roleLabel(invite.role)}</span>
        <span className="text-caption text-faint">{expiryLabel(invite.expiresAt, now)}</span>
      </div>
      <div className="flex items-center gap-2">
        <input aria-label={name} readOnly value={url} onFocus={(event) => event.currentTarget.select()} className={`${inputClass} h-8 min-w-0 flex-1 font-mono text-caption`} />
        <IconButton label={uiText("Copiar {0}", [name.toLowerCase()])} onClick={() => onCopy(url)}>
          <Copy />
          <span className="text-caption font-medium">{uiText("Copiar")}</span>
        </IconButton>
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={uiText("Abrir {0} em outra aba", [name.toLowerCase()])} title={uiText("Abrir em outra aba")} className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-panel-2 hover:text-ink">
          <ExternalLink size={16} />
        </a>
        <IconButton label={uiText("Revogar {0}", [name.toLowerCase()])} disabled={busy} onClick={() => onRevoke(invite)}>
          <Trash2 />
        </IconButton>
      </div>
      <p className="text-caption text-faint">{ROLE_HINTS[invite.role]}</p>
    </li>
  );
}

export function InviteList({ invites, now, busy, onCopy, onRevoke }: { invites: readonly InviteView[]; now: number; busy: boolean; onCopy(url: string): void; onRevoke(invite: InviteView): void }) {
  if (!invites.length) return <p className="rounded-control border border-dashed border-line px-3 py-3 text-muted">{uiText("Nenhum convite ativo. Crie um abaixo.")}</p>;
  return (
    <ul aria-label={uiText("Convites ativos")} className="flex flex-col overflow-hidden rounded-control border border-line">
      {invites.map((invite) => <InviteRow key={invite.id} invite={invite} now={now} busy={busy} onCopy={onCopy} onRevoke={onRevoke} />)}
    </ul>
  );
}

/** Name, role and validity of a new invite; the server checks them again. */
export function NewInviteForm({ busy, onCreate }: { busy: boolean; onCreate(invite: NewInvite): Promise<boolean> }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<InviteRole>('view');
  const [ttl, setTtl] = useState<InviteTtl>('24h');
  const submit = async () => {
    if (await onCreate({ name: name.trim(), role, ttl })) setName('');
  };
  return (
    <form
      aria-label={uiText("Novo convite")}
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="sk-label">{uiText("Novo convite")}</h3>
      <Field label={uiText("Nome (quem vai usar)")}>
        <input className={`${inputClass} h-8`} value={name} maxLength={60} placeholder={uiText("Ex.: Ana, time de plataforma")} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={uiText("Papel")}>
          <select className={`${inputClass} h-8`} value={role} onChange={(event) => setRole(event.target.value as InviteRole)}>
            {ROLE_OPTIONS.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}
          </select>
        </Field>
        <Field label={uiText("Validade")}>
          <select className={`${inputClass} h-8`} value={ttl} onChange={(event) => setTtl(event.target.value as InviteTtl)}>
            {TTL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-caption text-faint">{ROLE_HINTS[role]}</p>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={busy || !name.trim()}>{uiText("Criar convite")}</Button>
      </div>
    </form>
  );
}
