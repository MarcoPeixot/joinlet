/** Storage-less description of which conversations belong to the open workspace. */
export interface ChatBinding {
  /** Where the conversations live (`ws:<catalog id>` or, without an id, the legacy `<where>::<name>`). */
  key: string;
  /** The key earlier versions used (`<where>::<name>`): its conversations move to `key` the first time. */
  legacy: string;
}

/** Remote sessions (GitHub, rede local) are never in the project list: there is no stable id for them. */
const REMOTE = /^(GitHub:|Rede local:|Local network:)/;

export const isRemoteLabel = (label: string): boolean => REMOTE.test(label);

/**
 * The key is the project list's id when the workspace has one (a rename or a re-opened folder keeps its
 * conversations); otherwise it falls back to where it lives plus its name, as before.
 */
export function chatBinding(workspace: { name: string; label: string; catalogId: string | null }): ChatBinding {
  const legacy = `${workspace.label}::${workspace.name}`;
  return { key: workspace.catalogId && !isRemoteLabel(workspace.label) ? `ws:${workspace.catalogId}` : legacy, legacy };
}
