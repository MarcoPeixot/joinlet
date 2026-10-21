import { expect, test } from "@playwright/test";

test("F5 restores a document, a non-first diagram and Overview in the same workspace", async ({
  page,
}) => {
  await page.goto("/app/?lang=en");
  await expect(
    page.getByRole("navigation", { name: "Workspace" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const { workspace } = await import("/src/workspace/appWorkspace.ts");
    await workspace.create("diagram", "Second architecture");
    await workspace.create(
      "doc",
      "Decisions",
      "# Decisions\n\nKeep this document open after refresh.",
    );
    await workspace.flush();
  });
  await expect(
    page.getByLabel("Document editor").locator(".cm-content"),
  ).toContainText("Keep this document");
  await page.reload();
  await expect(
    page.getByLabel("Document editor").locator(".cm-content"),
  ).toContainText("Keep this document");
  await page.evaluate(async () => {
    const { workspace } = await import("/src/workspace/appWorkspace.ts");
    await workspace.openDiagram("second-architecture");
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { workspace } = await import("/src/workspace/appWorkspace.ts");
        return {
          diagram: workspace.store.getState().diagram,
          view: workspace.store.getState().view,
        };
      }),
    )
    .toEqual({ diagram: "second-architecture", view: { kind: "diagram" } });
  await page.evaluate(async () => {
    const { workspace } = await import("/src/workspace/appWorkspace.ts");
    await workspace.show({ kind: "board" });
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { workspace } = await import("/src/workspace/appWorkspace.ts");
        return workspace.store.getState().view;
      }),
    )
    .toEqual({ kind: "board" });
});

test("the inspector changes a card into a circle and undo restores its card presentation", async ({
  page,
}) => {
  await page.goto("/app/?lang=en");
  await expect(page.locator('[data-id="Kafka"]')).toBeVisible();
  await page.evaluate(async () => {
    const { diagramStore } = await import("/src/state/appStore.ts");
    diagramStore
      .getState()
      .apply(
        [
          {
            op: "add_node",
            id: "Vertex",
            presentation: "card",
            icon: "server",
          },
        ],
        { Vertex: { x: 200, y: 200, w: 240, h: 100 } },
      );
    diagramStore.getState().select({ nodes: ["Vertex"], edges: [] });
    const { uiStore } = await import("/src/ui/uiStore.ts");
    uiStore.setState({ rightPanel: null });
  });
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Circle", exact: true }).click();
  await expect(
    page.locator('.react-flow__node-shape[data-id="Vertex"]'),
  ).toBeVisible();
  const shape = await page.evaluate(async () => {
    const { diagramStore } = await import("/src/state/appStore.ts");
    const s = diagramStore.getState();
    return {
      presentation: s.model.elements.Vertex.presentation ?? null,
      shape: s.model.elements.Vertex.shape,
      w: s.layout.nodes.Vertex.w,
      h: s.layout.nodes.Vertex.h,
    };
  });
  expect(shape.presentation).toBeNull();
  expect(shape.shape).toBe("circle");
  expect(shape.w).toBe(shape.h);
  await page.getByRole("button", { name: "Undo (⌘Z)", exact: true }).click();
  await expect(
    page.locator('.react-flow__node-card[data-id="Vertex"]'),
  ).toBeVisible();
});
