import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
it.each(["cloud", "self-hosted"])("%s: isolates hosted accounts and providers, enforces invitations, syncs real sockets and restores a snapshot", (mode) => {
  const output = execFileSync(
    "bun",
    [new URL("./hostedSmoke.ts", import.meta.url).pathname],
    { encoding: "utf8", timeout: 45_000, env: { ...process.env, JOINLET_SMOKE_MODE: mode } },
  );
  expect(output).toContain("Joinlet hosted smoke passed:");
}, 50_000);
