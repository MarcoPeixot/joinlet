import { uiText } from '../i18n';
import { Globe, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Field, inputClass } from '../ui/controls';
import type { TunnelStatus, TunnelTtl } from './client';
import { remainingLabel } from './format';

export const TUNNEL_OPTIONS: ReadonlyArray<{ value: TunnelTtl; label: string }> = [
  { value: '30m', label: uiText("30 minutos") },
  { value: '2h', label: uiText("2 horas") },
  { value: '24h', label: uiText("24 horas") },
];

/**
 * Opt-in public access through a tunnel to the collaboration host. The warning comes first and the button stays off
 * until it is acknowledged (the server asks for the acknowledgement too).
 */
export function PublicAccess({ tunnel, now, busy, onStart, onStop }: { tunnel: TunnelStatus; now: number; busy: boolean; onStart(ttl: TunnelTtl): void; onStop(): void }) {
  const [ttl, setTtl] = useState<TunnelTtl>('2h');
  const [acknowledged, setAcknowledged] = useState(false);
  // Every time it is turned on is a new decision: the warning is acknowledged again.
  useEffect(() => setAcknowledged(false), [tunnel.active]);
  if (tunnel.active) {
    return (
      <section aria-label={uiText("Acesso público")} className="flex flex-col gap-2 rounded-control border border-line p-3">
        <h3 className="sk-label flex items-center gap-1.5"><Globe size={13} /> {uiText("Acesso público · ligado")}</h3>
        <p className="leading-relaxed text-muted">{uiText("Os links acima já usam o endereço público")} <span className="font-mono text-caption text-ink">{new URL(tunnel.url).host}</span>{uiText(". Cai sozinho em")} {remainingLabel(tunnel.expiresAt, now)}{uiText(". Revogar um convite derruba quem está usando.")}</p>
        <div className="flex justify-end">
          <Button disabled={busy} onClick={onStop}>{uiText("Desligar acesso público")}</Button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label={uiText("Acesso público")} className="flex flex-col gap-3 rounded-control border border-line p-3">
      <h3 className="sk-label flex items-center gap-1.5"><Globe size={13} /> {uiText("Acesso público")}</h3>
      <p className="leading-relaxed text-muted">{uiText("Por padrão os links só funcionam na sua rede. Para quem está fora dela, o Joinlet pode abrir um túnel temporário (cloudflared, precisa estar instalado).")}</p>
      <div role="note" className="flex gap-2 rounded-control border border-line bg-panel-2 px-3 py-2.5 text-caption leading-relaxed text-ink">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <span>{uiText("Qualquer pessoa na internet com um link de convite poderá abrir este workspace, com o papel do convite. Só o servidor de colaboração fica exposto (nunca o seu servidor local, a IA ou o Git). Os convites têm token de 256 bits e tentativas inválidas são bloqueadas, mas quem receber o link de edição pode alterar tudo: compartilhe só com quem confia e revogue depois.")}</span>
      </div>
      <label className="flex items-start gap-2 text-body">
        <input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>{uiText("Entendo os riscos e quero ligar o acesso público.")}</span>
      </label>
      <div className="flex items-end justify-between gap-3">
        <Field label={uiText("Duração")}>
          <select className={`${inputClass} h-8`} value={ttl} onChange={(event) => setTtl(event.target.value as TunnelTtl)}>
            {TUNNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Button variant="primary" disabled={busy || !acknowledged} onClick={() => onStart(ttl)}>{uiText("Ligar acesso público")}</Button>
      </div>
    </section>
  );
}
