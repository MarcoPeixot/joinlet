import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
it('migrates existing accounts to multiple isolated Cloud workspaces',()=>{
  expect(execFileSync('bun',[new URL('./hostedWorkspacesSmoke.ts',import.meta.url).pathname],{encoding:'utf8',timeout:30_000})).toContain('Joinlet multiple workspaces smoke passed');
},35_000);
it.each(["cloud", "self-hosted"])("%s: isolates hosted accounts and providers, enforces invitations, syncs real sockets and restores a snapshot", (mode) => {
  const output = execFileSync(
    "bun",
    [new URL("./hostedSmoke.ts", import.meta.url).pathname],
    { encoding: "utf8", timeout: 45_000, env: { ...process.env, JOINLET_SMOKE_MODE: mode } },
  );
  expect(output).toContain("Joinlet hosted smoke passed:");
}, 50_000);
