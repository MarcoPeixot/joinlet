import { expect, test } from "@playwright/test";
import { readFile, savedDiagram } from "./storage";
for (const language of ["pt-BR", "en"] as const)
  test(`specialist content: quantum components and weighted graphs in ${language}`, async ({
    page,
  }) => {
    const en = language === "en";
    await page.goto(`/app/?lang=${language}`);
    await expect(
      page.locator('.react-flow__node[data-id="Kafka"]'),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: en ? "Component library" : "Biblioteca de componentes",
        exact: true,
      })
      .click();
    const library = page.getByRole("dialog", {
      name: en ? "Component library" : "Biblioteca de componentes",
    });
    await library
      .getByRole("combobox", {
        name: en ? "Component library" : "Biblioteca de componentes",
      })
      .selectOption("quantum");
    await library
      .getByRole("textbox", {
        name: en ? "Search component" : "Buscar componente",
      })
      .fill("qubit");
    await library
      .getByRole("button", {
        name: en ? "Add Qubit" : "Adicionar Qubit",
        exact: true,
      })
      .click();
    await page.locator(".strukt-label-input").press("Enter");
    await expect(
      page.locator('.react-flow__node[data-id="Qubit"]'),
    ).toBeVisible();
    await expect
      .poll(async () => (await savedDiagram(page, JSON.parse((await readFile(page, 'strukt.json'))!).diagrams[0].slug))?.model.elements.Qubit?.icon)
      .toBe("domain:qubit");
    await page
      .getByRole("button", {
        name: en ? "Diagram templates" : "Modelos de diagramas",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", {
        name: en ? "Explore templates" : "Explorar modelos",
        exact: true,
      })
      .click();
    const gallery = page.getByRole("dialog", {
      name: en ? "Diagram templates" : "Modelos de diagramas",
    });
    await gallery
      .getByRole("button", {
        name: en ? "Graphs & algorithms" : "Grafos e algoritmos",
        exact: true,
      })
      .click();
    await gallery
      .getByRole("button", {
        name: en
          ? "View template Weighted shortest path"
          : "Ver modelo Caminho mínimo ponderado",
        exact: true,
      })
      .click();
    await expect(gallery.getByRole("img")).toBeVisible();
    await gallery
      .getByRole("button", {
        name: en ? "Use template" : "Usar modelo",
        exact: true,
      })
      .click();
    await expect(gallery).toHaveCount(0);
    await expect(page.locator('.react-flow__node[data-id="A"]')).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="E"]')).toBeVisible();
    await expect
      .poll(async () => (await savedDiagram(page, en ? 'weighted-shortest-path' : 'caminho-minimo-ponderado'))?.model.edges.length)
      .toBe(7);
    await page.screenshot({path:`/tmp/joinlet-rounded-graph-${language}.png`});
    await page.reload();
    await page.getByRole("navigation", {name: "Workspace"}).getByRole("button", {name: en ? "Weighted shortest path" : "Caminho mínimo ponderado", exact: true}).click();
    await expect(page.locator('.react-flow__node[data-id="E"]')).toBeVisible();
  });
