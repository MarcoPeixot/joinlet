import { describe, expect, it } from "vitest";
import { SPECIALIST_COMPONENT_PRESETS } from "@strukt/core/specialist";
import icons from "./specialist-icons.json";
import { loadIcon, iconSvg } from "./registry";
import { loadIconCatalog, searchIcons } from "./catalog";
describe("specialist icon pack", () => {
  it("loads unique, passive vector glyphs for every new concept and tool", async () => {
    expect(new Set(icons.map((i) => i.name)).size).toBe(102);
    expect(new Set(icons.map((i) => i.body)).size).toBe(102);
    for (const glyph of icons) {
      const icon = await loadIcon(glyph.name);
      expect(icon?.mode, glyph.name).toBe("stroke");
      expect(icon?.body).not.toMatch(
        /<script|foreignObject|<image|\son\w+=|href=|url\(/i,
      );
      for (const theme of ["light", "dark"] as const)
        expect(iconSvg(icon!, 0, 0, 24, "#123456", theme)).toContain(
          'stroke="#123456"',
        );
    }
    for (const preset of SPECIALIST_COMPONENT_PRESETS)
      expect(await loadIcon(preset.icon!), preset.id).toBeTruthy();
  });
  it("discovers new domains in the same searchable picker as existing icons", async () => {
    const catalog = await loadIconCatalog();
    expect(
      catalog.entries.filter((i) => i.source === "specialist"),
    ).toHaveLength(102);
    for (const query of ["qubit", "merkle", "embedding", "bloom", "dijkstra"])
      expect(
        searchIcons(catalog, query).some(
          (icon) => icon.source === "specialist",
        ),
        query,
      ).toBe(true);
    expect(
      searchIcons(catalog, "", "domain-quantum").length,
    ).toBeGreaterThanOrEqual(10);
  });
});

it('exposes requested Web3 marks under Blockchain and resolves each brand asset', async()=>{
 const catalog=await loadIconCatalog();
 for(const name of ['bitcoin','ethereum','solidity','cardano','polygon','walletconnect','ipfs']){
  expect(catalog.entries.find(icon=>icon.name===name)?.category,name).toBe('domain-blockchain');
  expect((await loadIcon('si:'+name))?.body,name).toBeTruthy();
 }
});
