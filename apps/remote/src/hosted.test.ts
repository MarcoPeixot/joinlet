import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
it("isolates hosted accounts and providers, enforces invitations, syncs real sockets and restores a snapshot", () => {
  const output = execFileSync(
    "bun",
    [new URL("./hostedSmoke.ts", import.meta.url).pathname],
    { encoding: "utf8", timeout: 45_000 },
  );
  expect(output).toContain("Joinlet hosted smoke passed:");
}, 50_000);
