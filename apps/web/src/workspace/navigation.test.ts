import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryAdapter, newWorkspace } from "@strukt/workspace";
import { createDiagramStore } from "../state/diagramStore";
import { createWorkspace } from "./workspace";
import { identifyNavigation, navigationPersistence } from "./navigation";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());
const create = () => {
  const diagram = createDiagramStore();
  return createWorkspace(diagram, {
    saveDelay: 0,
    navigation: navigationPersistence,
  });
};
describe("workspace navigation restoration", () => {
  for (const kind of ["doc", "sketch", "board", "diagram"] as const)
    it(`reopens the last ${kind} instead of the first diagram`, async () => {
      const adapter = identifyNavigation(createMemoryAdapter(), "first");
      const ws = create();
      await ws.open(adapter, () => newWorkspace("Same name"));
      const diagram = await ws.create("diagram", "Architecture");
      const doc = await ws.create("doc", "Decision", "# Decision");
      const sketch = await ws.create("sketch", "Sketch");
      if (kind === "diagram") await ws.openDiagram(diagram);
      else
        await ws.show(
          kind === "board"
            ? { kind }
            : { kind, slug: kind === "doc" ? doc : sketch },
        );
      await ws.close();
      const restored = create();
      const fresh = identifyNavigation(
        createMemoryAdapter(Object.fromEntries(adapter.files)),
        "first",
      );
      await restored.open(fresh, () => {
        throw Error("Must load existing files");
      });
      expect(restored.store.getState().view).toEqual(
        kind === "diagram" || kind === "board"
          ? { kind }
          : { kind, slug: kind === "doc" ? doc : sketch },
      );
      expect(restored.store.getState().diagram).toBe(diagram);
      await restored.close();
    });
  it("isolates same-named workspaces and falls back safely when the remembered item was deleted", async () => {
    const first = identifyNavigation(createMemoryAdapter(), "one"),
      second = identifyNavigation(createMemoryAdapter(), "two");
    const ws = create();
    await ws.open(first, () => newWorkspace("Same name"));
    await ws.create("doc", "Notes", "text");
    await ws.close();
    await ws.open(second, () => newWorkspace("Same name"));
    expect(ws.store.getState().view).toEqual({ kind: "board" });
    await ws.close();
    navigationPersistence.write(first, {
      diagram: "deleted",
      view: { kind: "doc", slug: "deleted" },
    });
    await ws.open(first, () => {
      throw Error("exists");
    });
    expect(ws.store.getState().view).toEqual({ kind: "board" });
    await ws.close();
  });
  it("ignores corrupted and blocked browser preferences", async () => {
    const adapter = identifyNavigation(createMemoryAdapter(), "first");
    localStorage.setItem("joinlet:navigation:v1:first", "invalid json");
    expect(navigationPersistence.read(adapter)).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    const ws = create();
    await ws.open(adapter, () => newWorkspace("Project"));
    await ws.show({ kind: "board" });
    await ws.close();
  });
});
