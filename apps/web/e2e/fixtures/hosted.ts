import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteApp } from "../../../remote/src/app";
import { createRemoteCollaboration } from "../../../remote/src/collaboration";
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const dir = await mkdtemp(join(tmpdir(), "joinlet-hosted-browser-"));
const origin = `http://127.0.0.1:${port}`;
const options = {
  deploymentMode: 'cloud' as const,
  optionalLogin: process.env.JOINLET_BROWSER_OPTIONAL_LOGIN === '1',
  publicUrl: origin,
  ...(process.env.JOINLET_BROWSER_PASSWORD_ONLY === '1' ? {} : {
    githubClientId: "browser-test", githubClientSecret: "browser-test",
  }),
  encryptionKey: "d".repeat(64),
  databasePath: join(dir, "remote.sqlite"),
  fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "github.com")
      return Response.json({ access_token: "browser-test" });
    if (url.pathname === "/user")
      return Response.json({ id: 303, login: "browser-test" });
    throw Error("Unexpected upstream in hosted browser fixture.");
  }) as typeof fetch,
};
const remote = createRemoteApp(options),
  collaboration = createRemoteCollaboration(
    options,
    remote.auth,
    remote.hosted,
  );
const server = remote.app.listen(port, "127.0.0.1", () => console.log(origin));
server.on(
  "upgrade",
  (req, socket, head) => void collaboration.upgrade(req, socket, head),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  remote.drain();
  await collaboration.shutdown();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  remote.auth.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
