import type { StorageAdapter } from "@strukt/workspace";
import type { View, WorkspaceState } from "./workspace";
export interface NavigationState {
  view: View;
  diagram: string | null;
}
const identities = new WeakMap<StorageAdapter, string>();
export function identifyNavigation<T extends StorageAdapter>(
  adapter: T,
  identity: string,
): T {
  identities.set(adapter, identity);
  return adapter;
}
export const navigationIdentity = (adapter: StorageAdapter): string | null => identities.get(adapter) ?? null;
const key = (adapter: StorageAdapter) => {
  const id = identities.get(adapter);
  return id ? `joinlet:navigation:v1:${id}` : null;
};
/** Personal browser state; never written into the shared repository or invitation. */
export const navigationPersistence = {
  read(adapter: StorageAdapter): NavigationState | null {
    try {
      const id = key(adapter);
      const value = id && globalThis.localStorage?.getItem(id);
      if (!value) return null;
      const saved = JSON.parse(value);
      if (
        !saved ||
        !saved.view ||
        !(saved.diagram === null || typeof saved.diagram === "string")
      )
        return null;
      const view = saved.view;
      if (view.kind === "board" || view.kind === "diagram")
        return { view: { kind: view.kind }, diagram: saved.diagram };
      if (
        (view.kind === "doc" || view.kind === "sketch") &&
        typeof view.slug === "string"
      )
        return {
          view: { kind: view.kind, slug: view.slug },
          diagram: saved.diagram,
        };
    } catch {
      /* Blocked storage and obsolete preferences must never prevent opening work. */
    }
    return null;
  },
  write(
    adapter: StorageAdapter,
    state: Pick<WorkspaceState, "view" | "diagram">,
  ): void {
    try {
      const id = key(adapter);
      if (id)
        globalThis.localStorage?.setItem(
          id,
          JSON.stringify({ view: state.view, diagram: state.diagram }),
        );
    } catch {
      /* Navigation is best effort; content saving has its own error handling. */
    }
  },
};
