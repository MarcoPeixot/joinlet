import { describe, expect, it } from "vitest";
import { applyOps, emptyModel } from "@strukt/core";
import { SPECIALIST_TEMPLATES } from "./templates";
const template = (id: string) => {
  const item = SPECIALIST_TEMPLATES.find((t) => t.id === id)!;
  const result = applyOps(emptyModel(), item.ops);
  if (!result.ok) throw Error(result.error.message);
  return result.model;
};
describe("specialist template semantics", () => {
  it("uses real graph topology and positive Dijkstra weights, with a shortest cost of six", () => {
    const model = template("graph-dijkstra"),
      distance = new Map([["A", 0]]),
      pending = new Set(model.order);
    expect(model.edges.every((e) => Number(e.label) >= 0)).toBe(true);
    while (pending.size) {
      const current = [...pending].sort(
        (a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity),
      )[0]!;
      pending.delete(current);
      for (const edge of model.edges.filter((e) => e.from === current))
        distance.set(
          edge.to,
          Math.min(
            distance.get(edge.to) ?? Infinity,
            (distance.get(current) ?? Infinity) + Number(edge.label),
          ),
        );
    }
    expect(distance.get("E")).toBe(6);
  });
  it("encodes an acyclic dependency graph", () => {
    const model = template("graph-dependency-dag"),
      seen = new Set<string>(),
      visiting = new Set<string>();
    const visit = (id: string) => {
      expect(visiting.has(id)).toBe(false);
      if (seen.has(id)) return;
      visiting.add(id);
      for (const edge of model.edges.filter((e) => e.from === id))
        visit(edge.to);
      visiting.delete(id);
      seen.add(id);
    };
    model.order.forEach(visit);
    expect(seen.size).toBe(model.order.length);
  });
  it("keeps bipartite edges between people and tasks and has no directional arrows", () => {
    const model = template("graph-bipartite-matching");
    for (const edge of model.edges) {
      expect(["Alice", "Bob", "Carol"]).toContain(edge.from);
      expect(["T1", "T2", "T3"]).toContain(edge.to);
      expect(edge.connector).toBe("-");
    }
  });
  it("preserves the min-heap parent/child ordering", () => {
    const model = template("ds-min-heap");
    for (const edge of model.edges)
      expect(Number(model.elements[edge.from]?.label)).toBeLessThanOrEqual(
        Number(model.elements[edge.to]?.label),
      );
  });
  it("does not bypass human approval on the agent tool path", () => {
    const model = template("ai-agentic-rag");
    expect(model.edges.filter((e) => e.to === "H").map((e) => e.from)).toEqual([
      "G",
    ]);
    expect(model.edges.some((e) => e.from === "F" && e.to === "G")).toBe(true);
  });
  it("includes both lexical and vector candidates in hybrid retrieval", () => {
    const model = template("ai-hybrid-retrieval");
    expect(
      model.edges
        .filter((e) => e.to === "D")
        .map((e) => e.from)
        .sort(),
    ).toEqual(["C", "Lexical"]);
  });
  it("estimates VQE energy from measurement outcomes before optimizing again", () => {
    const model = template("quantum-vqe");
    expect(model.edges.some((e) => e.from === "E" && e.to === "D")).toBe(true);
    expect(model.edges.some((e) => e.from === "D" && e.to === "A")).toBe(true);
  });
});

describe('specialist visual notation',()=>{
 it('uses circular vertices for weighted graphs and circular qubits in Bell diagrams',()=>{
  for(const node of Object.values(template('graph-dijkstra').elements)){
   expect(node.kind).toBe('node');if(node.kind!=='node')throw Error('Expected graph vertex');expect(node.shape).toBe('circle');expect(node.presentation).toBeUndefined();
  }
  const bell=template('quantum-bell');expect(bell.elements.q0).toMatchObject({kind:'node',shape:'circle'});expect(bell.elements.q1).toMatchObject({kind:'node',shape:'circle'});
 });
});
