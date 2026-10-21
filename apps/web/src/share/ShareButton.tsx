import { uiText } from '../i18n';
import { Globe, Share2 } from 'lucide-react';
import { useEffect } from 'react';
import { PresenceAvatars } from '../app/PresenceAvatars';
import { IconButton } from '../ui/IconButton';
import type { ShareStatus } from './client';
import { openShare, shareStore, useShare } from './session';

const POLL_MS = 4000;

/** "Compartilhar": opens the share dialog; while a link is live it also shows who is online right now. */
export function ShareButton() {
  const status = useShare((s) => s.status);
  const active = status.active;
  // Find out once whether a share from before a reload is still running, then follow the people while it lives.
  useEffect(() => {
    void shareStore.getState().refresh();
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void shareStore.getState().refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active]);
  return <ShareButtonView status={status} />;
}

/** The button and what it shows about a live share: who is online, and a mark while it is reachable from the internet. */
export function ShareButtonView({ status }: { status: ShareStatus }) {
  const active = status.active;
  const people = status.active ? status.people : [];
  const published = status.active && status.tunnel.active;
  const online = people.length;
  return (
    <span className="flex items-center gap-1" data-share={active ? 'on' : 'off'}>
      {published && (
        <span role="status" aria-label={uiText("Acesso público ligado")} title={uiText("O workspace está acessível pela internet com os convites. Abra Compartilhar para desligar.")} className="flex items-center gap-1 px-1 text-caption text-muted">
          <Globe size={13} aria-hidden />
          <span className="hidden lg:inline">{uiText("Público")}</span>
        </span>
      )}
      {active && (
        <span role="status" aria-label={online ? `${online} ${online === 1 ? uiText("pessoa online") : uiText("pessoas online")}` : uiText("Link ativo, ninguém conectado")} className="flex items-center gap-1.5 px-1 text-caption text-muted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-accent' : 'bg-line-strong'}`} />
          <PresenceAvatars people={people.map((person, index) => ({ ...person, id: `${index}:${person.name}` }))} />
          <span className="hidden lg:inline">{online ? `${online} online` : uiText("Link ativo")}</span>
        </span>
      )}
      <IconButton label={uiText("Compartilhar workspace")} title={uiText("Compartilhar: convide sua equipe para editar ao vivo")} active={active} onClick={openShare}>
        <Share2 />
      </IconButton>
    </span>
  );
}
