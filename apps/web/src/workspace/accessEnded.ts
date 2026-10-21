import { uiText } from '../i18n';
/**
 * The shared session's invite was revoked or expired (the host closed the socket with 4403, or refused a request with
 * `code: 'invite_ended'`). Rooms and requests that notice it all call `accessEnded`; the app's handler (boot) locks the
 * workspace and tells the person, once.
 */
export const ACCESS_ENDED = uiText("Seu acesso a este compartilhamento terminou: o convite foi revogado ou expirou. Peça um novo link a quem compartilhou.");

let handler: ((message: string) => void) | null = null;
let ended = false;

/** A new session (or a test) starts clean. */
export function setAccessEndedHandler(next: ((message: string) => void) | null): void {
  handler = next;
  ended = false;
}

export const hasAccessEnded = (): boolean => ended;

export function accessEnded(message: string = ACCESS_ENDED): void {
  if (ended) return;
  ended = true;
  handler?.(message);
}
