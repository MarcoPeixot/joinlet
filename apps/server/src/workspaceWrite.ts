const pending = new Map<string, Promise<unknown>>();

/** Serialize read/compare/write inside this server process, including separate HTTP handlers. */
export function serializeWorkspaceWrite<T>(workspace: string, work: () => Promise<T>): Promise<T> {
  const run = (pending.get(workspace) ?? Promise.resolve()).then(work, work);
  pending.set(workspace, run);
  const clear = () => { if (pending.get(workspace) === run) pending.delete(workspace); };
  void run.then(clear, clear);
  return run;
}
