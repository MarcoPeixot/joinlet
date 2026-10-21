import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createRemoteApp } from "./app";
import { createRemoteCollaboration } from "./collaboration";
import { backupDatabase } from "./backup";
import { privateValues } from "./secrets";
import { hostedProviderFetch } from "./hostedAi";
import { WebSocket } from "ws";
import * as Y from "yjs";
import {
  COLLAB_UPDATE,
  COLLAB_ACK,
  collaborationPacket,
} from "@strukt/workspace/collaboration";

const dir = await mkdtemp(join(tmpdir(), "joinlet-hosted-smoke-"));
let pendingAi: (() => void) | undefined;
let holdAi = false;
let aiCalls: string[] = [];
const upstream = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "github.com")
    return Response.json({
      access_token: `github-${JSON.parse(String(init?.body)).code}`,
    });
  if (url.pathname === "/user") {
    const headers = new Headers(init?.headers);
    const id = Number(headers.get("authorization")!.split("-").pop());
    return Response.json({ id, login: `user-${id}` });
  }
  if (url.origin === "https://api.openai.com") {
    const headers = new Headers(init?.headers);
    aiCalls.push(headers.get("authorization") ?? "");
    if (url.pathname.endsWith("/models"))
      return Response.json({ data: [{ id: "test-model" }] });
    const params = JSON.parse(String(init?.body));
    assert.match(
      JSON.stringify(params),
      /Respond in English|português do Brasil/,
    );
    if (holdAi)
      await new Promise<void>((resolve) => {
        pendingAi = resolve;
        init?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    if (params.stream)
      return new Response(
        "data: " +
          JSON.stringify({
            choices: [
              { delta: { content: "Cloud answer" }, finish_reason: null },
            ],
          }) +
          "\n\ndata: " +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    return Response.json({
      id: "answer",
      choices: [
        {
          message: { role: "assistant", content: "Cloud answer" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
  }
  throw Error(`Unexpected upstream ${url.origin}${url.pathname}`);
}) as typeof fetch;
const options = {
  deploymentMode: process.env.JOINLET_SMOKE_MODE === 'self-hosted' ? 'self-hosted' as const : 'cloud' as const,
  publicUrl: "http://localhost:8788",
  githubClientId: "smoke",
  githubClientSecret: "smoke",
  encryptionKey: "b".repeat(64),
  databasePath: join(dir, "remote.sqlite"),
  fetch: upstream,
};
let remote = createRemoteApp(options);
let collaboration = createRemoteCollaboration(
  options,
  remote.auth,
  remote.hosted,
);
let server = remote.app.listen(0, "127.0.0.1");
server.on(
  "upgrade",
  (req, socket, head) => void collaboration.upgrade(req, socket, head),
);
await once(server, "listening");
let base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const request = (path: string, init?: RequestInit) =>
  fetch(`${base}${path}`, { redirect: "manual", ...init });
const post = (cookie: string, csrf: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: {
    cookie,
    "content-type": "application/json",
    "x-strukt-csrf": csrf,
    origin: options.publicUrl,
  },
  body: JSON.stringify(body),
});
const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))!
    .split(";")[0]!;
async function login(id: number) {
  const start = await request("/auth/login");
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")!).searchParams.get(
    "state",
  )!;
  const verifier = cookieOf(start, "joinlet_oauth");
  const callback = await request(`/github/callback?state=${state}&code=${id}`, {
    headers: { cookie: verifier },
  });
  assert.equal(callback.status, 302, await callback.clone().text());
  assert.equal(callback.headers.get("location"), "/app/");
  assert.match(callback.headers.get("set-cookie")!, /HttpOnly/);
  const cookie = cookieOf(callback, "joinlet_session");
  const sessionResponse = await request("/api/remote/session", {
    headers: { cookie },
  });
  assert.equal(
    sessionResponse.status,
    200,
    await sessionResponse.clone().text(),
  );
  const session = (await sessionResponse.json()) as {
    repo: string;
    csrf: string;
    mode: string;
  };
  assert.equal(session.mode, "cloud");
  return { cookie, ...session };
}
async function connect(cookie: string, repo: string) {
  const socket = new WebSocket(
    base.replace("http:", "ws:") +
      `/api/collaboration?repo=${encodeURIComponent(repo)}&kind=doc&slug=notes`,
    { headers: { cookie, origin: options.publicUrl } },
  );
  const doc = new Y.Doc();
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => (readyResolve = resolve));
  socket.on("message", (data) => {
    const packet = new Uint8Array(data as Buffer);
    if (packet[0] === COLLAB_UPDATE) {
      Y.applyUpdate(doc, packet.slice(1));
      readyResolve();
    }
  });
  await Promise.race([
    ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Socket sync timed out.")), 4000).unref(),
    ),
  ]);
  return { socket, doc };
}
const sockets: WebSocket[] = [];
try {
  const start = await request("/auth/login"),
    state = new URL(start.headers.get("location")!).searchParams.get("state");
  assert.equal(
    (await request(`/github/callback?state=${state}&code=1`)).status,
    400,
  ); // Generic refusal, no credentials issued without the bound cookie.
  const owner = await login(101),
    other = await login(202);
  assert.notEqual(owner.repo, other.repo);
  assert.equal(
    (
      await request(
        `/api/remote/workspace?repo=${encodeURIComponent(owner.repo)}`,
        { headers: { cookie: other.cookie } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/remote/session", {
        headers: { cookie: owner.cookie },
      })
    ).status,
    200,
  );
  const again = await login(101);
  assert.equal(again.repo, owner.repo);
  assert.equal(remote.auth.beta.accountPlan(101).id, options.deploymentMode === 'cloud' ? 'free-beta' : 'self-hosted');
  if (options.deploymentMode === 'cloud') assert.throws(() => remote.auth.beta.claim(101, "org/second"), /workspace/);
  else assert.doesNotThrow(() => remote.auth.beta.claim(101, "org/second"));
  const write = (path: string, text: string | null, expected: string | null) =>
    request(
      "/api/remote/workspace",
      post(owner.cookie, owner.csrf, {
        repo: owner.repo,
        path,
        ...(text === null ? { remove: true } : { text }),
        expected,
      }),
    );
  assert.equal(
    (await write("docs/notes.md", "# Shared notes", null)).status,
    200,
  );
  assert.equal((await write("../private", ".env", null)).status, 403);
  assert.equal((await write("docs/notes.md", "stale", null)).status, 409);
  assert.equal(
    (
      await request(
        "/api/remote/workspace",
        post(owner.cookie, "wrong", {
          repo: owner.repo,
          path: "docs/notes.md",
          text: "oops",
          expected: "# Shared notes",
        }),
      )
    ).status,
    403,
  );
  const manifest = (await (
    await request(
      `/api/remote/workspace?repo=${encodeURIComponent(owner.repo)}&path=strukt.json`,
      { headers: { cookie: owner.cookie } },
    )
  ).json()) as { text: string };
  const next = JSON.parse(manifest.text);
  next.docs.push({ slug: "notes", title: "Notes" });
  assert.equal(
    (await write("strukt.json", JSON.stringify(next), manifest.text)).status,
    200,
  );
  const tooMany = {
    ...next,
    // A client-controlled field cannot promote a Cloud account.
    deploymentMode: 'self-hosted',
    diagrams: Array.from({ length: 21 }, (_, i) => ({
      slug: `map-${i}`,
      title: `Map ${i}`,
    })),
  };
  assert.equal(
    (await write("strukt.json", JSON.stringify(tooMany), JSON.stringify(next)))
      .status,
    options.deploymentMode === 'cloud' ? 403 : 200,
  );
  if (options.deploymentMode === 'self-hosted') assert.equal((await write('strukt.json', JSON.stringify(next), JSON.stringify(tooMany))).status, 200);
  const inviteResponse = await request(
    "/api/share/invites",
    post(owner.cookie, owner.csrf, {
      name: "Team",
      role: "edit",
      ttl: "never",
    }),
  );
  assert.equal(inviteResponse.status, 200);
  const shared = (await inviteResponse.json()) as {
    invites: { id: string; url: string }[];
  };
  const invite = shared.invites[0]!;
  const entered = await request(new URL(invite.url).pathname);
  assert.equal(entered.status, 302);
  const guest = cookieOf(entered, "joinlet_guest");
  const guestSession = (await (
    await request("/api/remote/session", { headers: { cookie: guest } })
  ).json()) as { csrf: string; member: string; owner: boolean };
  assert.equal(guestSession.owner, false);
  assert.equal(
    (await request("/api/settings", { headers: { cookie: guest } })).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/share/invites",
        post(guest, guestSession.csrf, {
          name: "bad",
          role: "edit",
          ttl: "never",
        }),
      )
    ).status,
    403,
  );
  const original = await connect(owner.cookie, owner.repo),
    peer = await connect(guest, owner.repo);
  sockets.push(original.socket, peer.socket);
  assert.equal(peer.doc.getText("content").toString(), "# Shared notes");
  const update = await new Promise<Uint8Array>((resolve) => {
    peer.doc.once("update", resolve);
    peer.doc
      .getText("content")
      .insert(peer.doc.getText("content").length, " from guest");
  });
  peer.socket.send(collaborationPacket(COLLAB_UPDATE, update));
  await new Promise<void>((resolve, reject) => {
    const end = setTimeout(
      () => reject(Error("Live update did not reach owner.")),
      4000,
    ).unref();
    const check = () => {
      if (original.doc.getText("content").toString().endsWith(" from guest")) {
        clearTimeout(end);
        original.doc.off("update", check);
        resolve();
      }
    };
    original.doc.on("update", check);
    check();
  });
  const closed = once(peer.socket, "close");
  assert.equal(
    (
      await request(
        "/api/share/invites/revoke",
        post(owner.cookie, owner.csrf, { id: invite.id }),
      )
    ).status,
    200,
  );
  assert.equal((await closed)[0], 4401);
  assert.equal(
    (await request("/api/remote/session", { headers: { cookie: guest } }))
      .status,
    401,
  );
  assert.equal((await request(new URL(invite.url).pathname)).status, 401);
  assert.equal(
    (
      await request(
        "/api/share/invites",
        post(owner.cookie, owner.csrf, {
          name: "Read only",
          role: "view",
          ttl: "1h",
        }),
      )
    ).status,
    200,
  );
  const viewStatus = (await (
    await request("/api/share", { headers: { cookie: owner.cookie } })
  ).json()) as typeof shared;
  const viewer = await request(new URL(viewStatus.invites[0]!.url).pathname),
    viewCookie = cookieOf(viewer, "joinlet_guest");
  const viewSession = (await (
    await request("/api/remote/session", { headers: { cookie: viewCookie } })
  ).json()) as { csrf: string };
  assert.equal(
    (
      await request(
        "/api/remote/workspace",
        post(viewCookie, viewSession.csrf, {
          repo: owner.repo,
          path: "docs/notes.md",
          text: "overwrite",
          expected: "# Shared notes",
        }),
      )
    ).status,
    403,
  );
  const commentInvite = await request(
    "/api/share/invites",
    post(owner.cookie, owner.csrf, {
      name: "Comments",
      role: "comment",
      ttl: "1h",
    }),
  );
  assert.equal(commentInvite.status, 200);
  const commentLink = (
    (await commentInvite.json()) as typeof shared
  ).invites.find((invite) => invite.id !== viewStatus.invites[0]!.id)!;
  const commentCookie = cookieOf(
    await request(new URL(commentLink.url).pathname),
    "joinlet_guest",
  );
  const commentSession = (await (
    await request("/api/remote/session", { headers: { cookie: commentCookie } })
  ).json()) as { csrf: string };
  assert.equal(
    (
      await request(
        "/api/remote/workspace",
        post(commentCookie, commentSession.csrf, {
          repo: owner.repo,
          path: "comments/doc-notes.json",
          text: JSON.stringify({ version: 1, threads: [] }),
          expected: null,
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/remote/workspace",
        post(commentCookie, commentSession.csrf, {
          repo: owner.repo,
          path: "docs/notes.md",
          text: "forged",
          expected: null,
        }),
      )
    ).status,
    403,
  );
  // One owner slot is reserved, even when the owner is not in a diagram room.
  const linkPath = new URL(viewStatus.invites[0]!.url).pathname;
  assert.equal((await request(linkPath)).status, 302);
  assert.equal((await request(linkPath)).status, 302);
  assert.equal((await request(linkPath)).status, options.deploymentMode === 'cloud' ? 403 : 302);
  const settings = (key: string) => ({
    provider: "openai",
    keys: { openai: key },
    openai: { baseUrl: "https://api.openai.com/v1" },
    models: { openai: { edit: "test-model" } },
  });
  assert.equal(
    (
      await request(
        "/api/settings",
        post(owner.cookie, owner.csrf, settings("private-key-owner")),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/settings",
        post(other.cookie, other.csrf, settings("private-key-other")),
      )
    ).status,
    200,
  );
  const ownSettings = await (
    await request("/api/settings", { headers: { cookie: owner.cookie } })
  ).text();
  assert(!ownSettings.includes("private-key-owner"));
  assert(ownSettings.includes("…wner"));
  assert(
    !JSON.stringify(
      remote.auth.database.query("SELECT * FROM hosted_settings").all(),
    ).includes("private-key"),
  );
  assert.equal(
    (
      await request(
        "/api/settings",
        post(owner.cookie, owner.csrf, {
          openai: { baseUrl: "http://169.254.169.254/latest" },
        }),
      )
    ).status,
    400,
  );
  for (const address of [
    "http://localhost:8787",
    "https://127.0.0.1",
    "https://api.openai.com.evil.test",
    "https://api.openai.com@evil.test",
  ])
    await assert.rejects(hostedProviderFetch(upstream)(address));
  const chat = {
    messages: [{ role: "user", content: "What does this system do?" }],
    context: "",
    locale: "en",
  };
  const answer = await request(
    "/api/ai/chat",
    post(owner.cookie, owner.csrf, chat),
  );
  assert.equal(answer.status, 200, await answer.clone().text());
  assert.match(await answer.text(), /Cloud answer/);
  const stream = await request(
    "/api/ai/chat",
    post(other.cookie, other.csrf, { ...chat, stream: true }),
  );
  assert.equal(stream.status, 200);
  const lines = await stream.text();
  assert.match(lines, /Cloud answer/);
  assert.match(lines, /done/);
  assert(aiCalls.includes("Bearer private-key-owner"));
  assert(aiCalls.includes("Bearer private-key-other"));
  holdAi = true;
  const pending = request("/api/ai/chat", post(owner.cookie, owner.csrf, chat));
  while (!pendingAi) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    (await request("/api/ai/chat", post(owner.cookie, owner.csrf, chat)))
      .status,
    429,
  );
  pendingAi();
  await pending;
  holdAi = false;
  const cipher = privateValues(options.encryptionKey),
    sealed = cipher.seal("secret", "user:one");
  assert.throws(() => cipher.open(sealed, "user:two"));
  await collaboration.shutdown();
  sockets.length = 0;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await backupDatabase(options.databasePath, join(dir, "snapshot.sqlite"));
  remote.auth.close();
  remote = createRemoteApp({
    ...options,
    databasePath: join(dir, "snapshot.sqlite"),
  });
  collaboration = createRemoteCollaboration(
    { ...options, databasePath: join(dir, "snapshot.sqlite") },
    remote.auth,
    remote.hosted,
  );
  server = remote.app.listen(0, "127.0.0.1");
  server.on(
    "upgrade",
    (req, socket, head) => void collaboration.upgrade(req, socket, head),
  );
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const restored = await request("/api/remote/session", {
    headers: { cookie: owner.cookie },
  });
  assert.equal(restored.status, 200);
  assert.equal(((await restored.json()) as { repo: string }).repo, owner.repo);
  const text = (await (
    await request(
      `/api/remote/workspace?repo=${encodeURIComponent(owner.repo)}&path=docs/notes.md`,
      { headers: { cookie: owner.cookie } },
    )
  ).json()) as { text: string };
  assert.match(text.text, /from guest/);
  assert.equal(
    (await request("/api/settings", { headers: { cookie: other.cookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/remote/disconnect",
        post(owner.cookie, owner.csrf, {}),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/remote/session", {
        headers: { cookie: owner.cookie },
      })
    ).status,
    401,
  );
  console.log(
    "Joinlet hosted smoke passed: website login, ownership, encrypted BYOK, AI streaming, limits, scoped links, live collaboration, revocation and restored persistence.",
  );
} finally {
  for (const socket of sockets) socket.terminate();
  await collaboration.shutdown();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  remote.auth.close();
  await rm(dir, { recursive: true, force: true });
}
