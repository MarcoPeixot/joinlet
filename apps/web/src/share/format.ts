import { uiText, getLocale } from '../i18n';
import type { AuditEntry, InviteRole } from './client';

const ROLE_LABELS: Record<InviteRole, string> = { edit: uiText("Editar"), comment: uiText("Comentar"), view: uiText("Só ver") };
export const roleLabel = (role: InviteRole): string => ROLE_LABELS[role];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "Sem prazo", "Expira em 5 min", "Expira em 3 h", "Expira em 3 dias": the unit grows with what is left. */
export function expiryLabel(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return uiText("Sem prazo");
  const left = expiresAt - now;
  if (left <= 0) return uiText("Expirado");
  if (left < MIN) return uiText("Expira em menos de 1 min");
  if (left < 2 * DAY) {
    if (left < HOUR) return uiText("Expira em {0} min", [Math.round(left / MIN)]);
    return uiText("Expira em {0} h", [Math.floor(left / HOUR)]);
  }
  return uiText("Expira em {0} dias", [Math.floor(left / DAY)]);
}

/** What is left of the public access: "45 min", "1 h 30 min", "2 h". */
export function remainingLabel(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return uiText("encerrando");
  if (left < MIN) return uiText("menos de 1 min");
  const minutes = Math.round(left / MIN);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export interface DescribedEntry { text: string; when: string; tone: 'normal' | 'warn' }

const time = new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** One activity line in pt-BR. Names are the invite's (the owner typed them); paths are workspace paths, never content. */
export function describeEntry(entry: AuditEntry): DescribedEntry {
  const stamp = new Date(entry.t);
  const when = Number.isNaN(stamp.getTime()) ? '' : time.format(stamp).replace(',', '');
  const who = entry.invite ? `"${entry.invite}"` : uiText("Alguém");
  const role = entry.role === 'edit' || entry.role === 'comment' || entry.role === 'view' ? roleLabel(entry.role) : null;
  const done = (text: string, tone: DescribedEntry['tone'] = 'normal'): DescribedEntry => ({ text, when, tone });
  switch (entry.type) {
    case 'share.start': return done(uiText("Compartilhamento iniciado"));
    case 'share.stop': return done(uiText("Compartilhamento encerrado"));
    case 'invite.create': return done(uiText("Convite \"{0}\" criado{1}", [entry.invite ?? '', role ? ` (${role})` : '']));
    case 'invite.revoke': return done(uiText("Convite \"{0}\" revogado", [entry.invite ?? '']));
    case 'invite.expire': return done(uiText("Convite \"{0}\" expirou", [entry.invite ?? '']));
    case 'join': return done(uiText("{0} entrou{1}", [who, role ? ` (${role})` : '']));
    case 'write': return done(`${who} ${entry.op === 'remove' ? uiText("removeu") : uiText("alterou")} ${entry.path ?? uiText("um arquivo")}`);
    case 'tunnel.start': return done(uiText("Acesso público ligado"));
    case 'tunnel.stop':
      return done(entry.reason === 'expired' ? uiText("Acesso público encerrado: o tempo acabou")
        : entry.reason === 'exited' ? uiText("Acesso público caiu (o cloudflared parou)")
        : entry.reason === 'share_stopped' ? uiText("Acesso público encerrado com o compartilhamento")
        : uiText("Acesso público desligado"));
    case 'denied':
      switch (entry.reason) {
        case 'invalid_token': return done(uiText("Convite inválido recusado"), 'warn');
        case 'ended_invite': return done(uiText("Acesso com convite revogado ou expirado recusado"), 'warn');
        case 'read_only': return done(uiText("{0} tentou alterar com acesso só de leitura", [who]), 'warn');
        case 'path_not_allowed': return done(uiText("{0} tentou gravar em arquivo não permitido{1}", [who, entry.path ? ` (${entry.path})` : '']), 'warn');
        case 'rate_limited': return done(uiText("Endereço bloqueado por tentativas demais"), 'warn');
        case 'bad_origin': return done(uiText("{0} tentou conectar de uma origem não permitida", [who]), 'warn');
        default: return done(uiText("Acesso recusado"), 'warn');
      }
    default: return done(entry.type);
  }
}
