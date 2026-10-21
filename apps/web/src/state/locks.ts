import { uiText } from '../i18n';
/** Reasons the diagram store can be `readOnly` (each owner releases only its own). Leaf module: no store imports. */
export const DRAFT_LOCK = uiText("Revise a proposta da IA: aplique ou descarte antes de editar.");
export const COMPARE_LOCK = uiText("Comparando versões: restaure a versão ou saia da comparação para editar.");
export const BRANCH_COMPARE_LOCK = uiText("Comparando arquitetura com uma ref do Git. Encerre a comparação para editar.");
/** A read-only link's session: edits are refused for as long as the page lives (the host drops them anyway). */
export const VIEW_LOCK = uiText("Você abriu um link somente leitura: dá para ver, mas não para editar.");
export const PRESENT_LOCK = uiText("Modo apresentação: saia para editar.");
/**
 * A shared session's diagram is loaded with this lock and the collaboration bridge releases it once the room's state
 * is applied: an edit made before that would bypass the room. Never refuses a switch (a load replaces it).
 */
export const COLLAB_WAITING_LOCK = uiText("Conectando à colaboração…");

const AI_LOCKED = uiText("Aplique ou descarte a proposta da IA antes de trocar de diagrama.");

/** Why a diagram switch was refused, worded for the lock that actually holds the store. */
export function switchLockedMessage(reason: string | null): string {
  switch (reason) {
    case PRESENT_LOCK: return uiText("Saia do modo apresentação antes de trocar de diagrama.");
    case COMPARE_LOCK: return uiText("Saia da comparação de versões antes de trocar de diagrama.");
    case BRANCH_COMPARE_LOCK: return uiText("Encerre a comparação com o Git antes de trocar de diagrama.");
    default: return AI_LOCKED;
  }
}
