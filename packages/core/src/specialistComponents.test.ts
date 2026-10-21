import { describe, expect, it } from "vitest";
import {
  COMPONENT_LIBRARIES,
  SPECIALIST_COMPONENT_PRESETS,
  COMPONENT_PRESETS,
} from "./componentCatalog";
import { catalogMatches } from "./catalogSearch";
import { applyOps } from "./applyOps";
import { emptyModel } from "./model";

describe("specialist content libraries", () => {
  it("keeps component IDs unique and basic building blocks first", () => {
    expect(COMPONENT_PRESETS[0]?.id).toBe("service");
    expect(new Set(COMPONENT_PRESETS.map((p) => p.id)).size).toBe(
      COMPONENT_PRESETS.length,
    );
    expect(new Set(COMPONENT_LIBRARIES.map((p) => p.id)).size).toBe(8);
    for (const pack of COMPONENT_LIBRARIES)
      expect(
        SPECIALIST_COMPONENT_PRESETS.filter((p) => p.libraryId === pack.id)
          .length,
        pack.id,
      ).toBeGreaterThanOrEqual(12);
  });
  it("finds domain concepts by English and Portuguese names and technical aliases", () => {
    const find = (query: string) =>
      SPECIALIST_COMPONENT_PRESETS.filter((p) =>
        catalogMatches(query, p.label, p.description, p.tech, p.keywords),
      ).map((p) => p.id);
    expect(find("qubit")).toContain("qubit");
    expect(find("caminho minimo")).toContain("graph-dijkstra");
    expect(find("shortest non-negative")).toContain("graph-dijkstra");
    expect(find("bloom false positives")).toContain("ds-bloom");
    expect(find("tabela hash")).toContain("ds-hash-table");
    expect(find("GraphRAG")).toContain("ai-graph-rag");
    expect(find("Qiskit")).toContain("tech-qiskit");
  });
  it("every preset creates a valid editable component without copying discovery metadata", () => {
    for (const preset of SPECIALIST_COMPONENT_PRESETS) {
      const result = applyOps(emptyModel(), [
        {
          op: "add_node",
          id: preset.id,
          label: preset.label,
          icon: preset.icon,
          tech: preset.tech,
          description: preset.description,
          presentation: preset.presentation,
          color: preset.color,
        },
      ]);
      expect(result.ok, preset.id).toBe(true);
      if (!result.ok) continue;
      expect(result.model.elements[preset.id]).not.toHaveProperty("libraryId");
      expect(result.model.elements[preset.id]).not.toHaveProperty("keywords");
    }
  });
});
