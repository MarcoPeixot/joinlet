import { writeBatch } from '@strukt/workspace/repository-transaction';
import type { Request, Response, NextFunction } from "express";
import { BetaLimitError } from "@strukt/workspace";
import { refreshGeneratedContext } from "@strukt/workspace/context-storage";
import { serializeWorkspaceWrite } from "../../server/src/workspaceWrite";
import type { RemoteAuth, RemoteAuthOptions } from "./auth";
import {
  createHostedStore,
  HostedError,
  type HostedAccess,
} from "./hostedStore";
import { createPasswordAuth } from './passwordAuth';
import { createHostedAi } from "./hostedAi";

export const heldCookie = (header: string | undefined, name: string) =>
  header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
export function createHostedBackend(
  options: RemoteAuthOptions,
  auth: RemoteAuth,
) {
  const store = createHostedStore(
    auth.database,
    auth,
    options.encryptionKey,
    options.now,
  );
  const ai = createHostedAi(store, options.fetch);
  const cookieOptions = {
    httpOnly: true,
    secure: auth.publicUrl.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
  let changed: (workspace: string, path: string) => void = () => {};
  let accessChanged: () => void = () => {};
  let nextCleanup = 0;
  const writeRates = new Map<string, { at: number; n: number }>();
  const attempts = new Map<string, { at: number; n: number }>();
  const limit = (req: Request) => {
    const now = Date.now();
    for (const [ip, row] of attempts)
      if (row.at + 60_000 < now) attempts.delete(ip);
    const ip = req.ip ?? "unknown",
      row = attempts.get(ip) ?? { at: now, n: 0 };
    row.n++;
    attempts.set(ip, row);
    if (row.n > 30 || attempts.size > 10_000)
      throw new HostedError(
        429,
        "Too many sign-in attempts. Try again in a minute.",
      );
  };
  const context = (cookies: string | undefined, requestedWorkspace?: string): HostedAccess | null => {
    const guest = heldCookie(cookies, "joinlet_guest");
    if (guest) {
      const access = store.guest(guest);
      if (!access)
        throw new HostedError(
          401,
          "This invitation has expired or was revoked. Ask for a new link.",
          "invite_ended",
        );
      if(requestedWorkspace && requestedWorkspace!==access.workspace)throw new HostedError(403,'This invitation cannot access that workspace.');
      return access;
    }
    const token = heldCookie(cookies, "joinlet_session"),
      session = token ? auth.webSession(token) : null;
    if (!session) return null;
    if (session.repo) return null;
    const access = store.access(session, requestedWorkspace);
    access.valid = () => !!auth.webSession(token!);
    return access;
  };
  const guard = (req: Request, access: { csrf: string }) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    if (
      req.header("x-strukt-csrf") !== access.csrf ||
      (req.header("origin") && req.header("origin") !== auth.publicUrl) ||
      req.header("sec-fetch-site") === "cross-site"
    )
      throw new HostedError(
        403,
        "Invalid session or CSRF token. Refresh and try again.",
      );
    if (!req.is("application/json"))
      throw new HostedError(415, "Send JSON (Content-Type: application/json).");
  };
  const status = (access: HostedAccess) => ({
    active: true,
    hosted: true,
    root: access.workspace,
    people: store.people(access.workspace),
    invites: store.invites(access.workspace, auth.publicUrl),
    tunnel: { active: false },
    startedAt: 0,
  });
  const passwordAuth = createPasswordAuth(options, auth, guest => { if (guest) store.leave(guest); accessChanged(); });
  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (req.path.startsWith("/api/auth/")) return await passwordAuth(req, res, next);
      if (req.path === "/auth/login" && req.method === "GET") {
        if (!options.githubClientId || !options.githubClientSecret) return res.status(503).json({ error: "GitHub sign-in is not enabled." });
        limit(req);
        const flow = auth.startWebLogin();
        res.cookie("joinlet_oauth", flow.verifier, {
          ...cookieOptions,
          maxAge: 10 * 60_000,
        });
        return res.redirect(flow.url);
      }
      if (
        req.path === "/github/callback" &&
        typeof req.query.state === "string" &&
        auth.isWebFlow(req.query.state)
      ) {
        limit(req);
        if (typeof req.query.code !== "string")
          throw new HostedError(400, "GitHub sign-in was canceled.");
        const session = await auth
          .finishWebLogin(
            req.query.code,
            req.query.state,
            heldCookie(req.headers.cookie, "joinlet_oauth") ?? "",
          )
          .catch(() => {
            throw new HostedError(
              400,
              "Sign-in expired or was refused. Please try again.",
            );
          });
        res.clearCookie("joinlet_oauth", { path: "/" });
        res.clearCookie("joinlet_guest", { path: "/" });
        if (session.browserToken)
          res.cookie("strukt_session", session.browserToken, {
            ...cookieOptions,
            maxAge: 30 * 86400_000,
          });
        else res.clearCookie("strukt_session", { path: "/" });
        res.cookie("joinlet_session", session.token, {
          ...cookieOptions,
          maxAge: 30 * 86400_000,
        });
        return res.redirect(options.siteUrl ? "/" : "/app/");
      }
      if (req.path.startsWith("/join/") && req.method === "GET") {
        limit(req);
        const value = req.path.slice(6);
        if (!/^[\w-]{43}$/.test(value))
          throw new HostedError(401, "Invalid invitation.", "invite_ended");
        const current = heldCookie(req.headers.cookie, "joinlet_guest");
        const guest = store.join(value, current);
        res.cookie("joinlet_guest", guest, {
          ...cookieOptions,
          maxAge: 86400_000,
        });
        return res.redirect(options.siteUrl ? "/" : "/app/");
      }
      const handled =
        req.path.startsWith("/api/remote/") ||
        req.path.startsWith("/api/share") ||
        req.path.startsWith("/api/settings") ||
        req.path.startsWith("/api/ai/");
      if (!handled) return next();
      if (Date.now() > nextCleanup) {
        nextCleanup = Date.now() + 60_000;
        auth.database
          .query(
            "DELETE FROM records WHERE expires IS NOT NULL AND expires < ?",
          )
          .run((options.now ?? Date.now)());
        auth.database
          .query("DELETE FROM hosted_guests WHERE expires < ?")
          .run((options.now ?? Date.now)());
        for (const [id, row] of writeRates)
          if (row.at + 60_000 < Date.now()) writeRates.delete(id);
      }
      const requestedWorkspace=req.header('x-joinlet-workspace') ?? (typeof req.query.workspace==='string'?req.query.workspace:typeof req.query.repo==='string'&&req.query.repo.startsWith('cloud:')?req.query.repo:typeof req.body?.repo==='string'&&req.body.repo.startsWith('cloud:')?req.body.repo:undefined);
      const access = context(req.headers.cookie, requestedWorkspace);
      const personal =
        req.path.startsWith("/api/settings") || req.path.startsWith("/api/ai/");
      if (personal) {
        if (access && !access.owner)
          throw new HostedError(
            403,
            "Sign in to your own workspace to connect and use your AI provider.",
          );
        let identity: { userId: number; csrf: string } | null = access?.userId
          ? { userId: access.userId, csrf: access.csrf }
          : null;
        if (!identity) {
          const token = heldCookie(req.headers.cookie, "strukt_session"),
            grant = token ? auth.browserGrant(token) : null;
          if (grant) {
            const github = await auth.githubForGrant(grant);
            identity = { userId: github.userId, csrf: grant.csrf };
          }
        }
        if (!identity)
          throw new HostedError(401, "Sign in to connect your AI provider.");
        guard(req, identity);
        if (req.method !== "GET" && req.method !== "POST")
          throw new HostedError(405, "Method not allowed.");
        return await ai(req, res, identity.userId);
      }
      if (!access) return next();
      guard(req, access);
      if (req.method !== "GET") {
        const row = writeRates.get(access.member) ?? { at: Date.now(), n: 0 };
        row.n++;
        writeRates.set(access.member, row);
        if (row.n > 180)
          throw new HostedError(
            429,
            "Too many changes. Wait a minute before trying again.",
          );
      }
      if (!access.valid()) throw new HostedError(401, "Sign in again.");
      if(req.path==='/api/remote/workspaces') {
        if(!access.owner||!access.userId)throw new HostedError(403,'Sign in to manage your workspaces.');
        if(req.method==='GET')return res.json({workspaces:store.listWorkspaces(access.userId),activeId:access.workspace});
        if(req.method==='POST')return res.status(201).json({id:store.createWorkspace(access.userId,req.body?.name)});
        throw new HostedError(405,'Method not allowed.');
      }
      const presence = auth.beta.presence(access.workspace);
      store.touch(access);
      const plan = () => ({
        ...auth.beta.status(access.ownerId, access.workspace),
        scope: access.owner ? "account" : "shared",
        workspaceOwner: access.owner,
        accountPlan: access.userId
          ? auth.beta.accountPlan(access.userId)
          : undefined,
      });
      if (req.path === "/api/remote/session" && req.method === "GET") {
        store.opened(access.workspace);
        const storage=store.adapter(access.workspace);
        if(await storage.read('context/ARCHITECTURE.md')===null)await refreshGeneratedContext(storage);
        return res.json({
          repo: access.workspace,
          csrf: access.csrf,
          mcpUrl: auth.resource,
          mode: "cloud",
          owner: access.owner,
          role: access.role,
          readOnly: access.role !== "edit",
          member: access.member,
          beta: plan(),
        });
      }
      if (req.path === "/api/remote/plan" && req.method === "GET")
        return res.json(plan());
      if (req.path === "/api/remote/disconnect" && req.method === "POST") {
        const guest = heldCookie(req.headers.cookie, "joinlet_guest"),
          token = heldCookie(req.headers.cookie, "joinlet_session");
        if (guest) store.leave(guest);
        else if (token) auth.revokeWebSession(token);
        presence.leave(access.member);
        accessChanged();
        res.clearCookie(guest ? "joinlet_guest" : "joinlet_session", {
          path: "/",
        });
        return res.json({ ok: true });
      }
      if (req.path === "/api/remote/init" && req.method === "POST")
        return res.json({ ok: true, setup: { conflicts: [] } });
      if (req.path === "/api/remote/revision" && req.method === "GET")
        return res.json({ revision: store.revision(access.workspace) });
      if (req.path === "/api/remote/pr" && req.method === "GET")
        return res.json({ url: null });
      if (req.path === "/api/remote/workspace") {
        const requested =
          req.method === "GET" ? req.query.repo : req.body?.repo;
        if (requested !== access.workspace)
          throw new HostedError(
            403,
            "This session cannot access that workspace.",
          );
        const storage = store.adapter(access.workspace);
        if (req.method === "GET")
          return res.json(
            typeof req.query.path === "string"
              ? { text: await storage.read(req.query.path) }
              : {
                  files: await storage.list(),
                  repo: access.workspace,
                  revision: store.revision(access.workspace),
                },
          );
        if (req.method !== "POST")
          throw new HostedError(405, "Method not allowed.");
        if (Array.isArray(req.body?.changes)) {
          if(access.role !== 'edit' || req.body.changes.length > 2000) throw new HostedError(403,'Batch editing is unavailable.');
          const changes=req.body.changes as {path:string;text:string|null;expected:string|null}[];
          if(changes.some(c=>!c || typeof c.path!=='string' || (c.text!==null&&typeof c.text!=='string') || (c.expected!==null&&typeof c.expected!=='string'))) throw new HostedError(400,'Invalid workspace batch.');
          await writeBatch(storage,changes); await refreshGeneratedContext(storage);
          for(const change of changes) changed(access.workspace,change.path);
          return res.json({ok:true,revision:store.revision(access.workspace)});
        }
        if (
          typeof req.body?.path !== "string" ||
          (req.body.remove !== true && typeof req.body.text !== "string")
        )
          throw new HostedError(400, "Invalid file request.");
        await serializeWorkspaceWrite(storage.label, async () => {
          await store.write(
            access,
            req.body.path,
            req.body.remove === true ? null : req.body.text,
            req.body.expected,
          );
          await refreshGeneratedContext(storage);
          changed(access.workspace, req.body.path);
        });
        return res.json({
          ok: true,
          revision: store.revision(access.workspace),
        });
      }
      if (req.path.startsWith("/api/share")) {
        if (!access.owner)
          throw new HostedError(
            403,
            "Only the workspace owner can manage invitations.",
          );
        if (req.path === "/api/share/audit" && req.method === "GET")
          return res.json({ entries: store.activity(access.workspace) });
        if (req.path === "/api/share/invites" && req.method === "POST")
          store.createInvite(access, req.body ?? {});
        else if (
          req.path === "/api/share/invites/revoke" &&
          req.method === "POST"
        ) {
          if (typeof req.body?.id !== "string")
            throw new HostedError(400, "Invalid invitation.");
          store.revoke(access, req.body.id);
          accessChanged();
        } else if (req.path === "/api/share/stop" && req.method === "POST") {
          store.revoke(access);
          accessChanged();
        } else if (
          !["/api/share", "/api/share/prepare", "/api/share/start"].includes(
            req.path,
          )
        )
          throw new HostedError(404, "Unknown sharing endpoint.");
        return res.json(status(access));
      }
      throw new HostedError(404, "Unknown cloud endpoint.");
    } catch (error) {
      if (error instanceof BetaLimitError)
        return res.status(403).json(error.toJSON());
      if (error instanceof HostedError) {
        if (error.code === "invite_ended" && req.path.startsWith("/api/"))
          res.clearCookie("joinlet_guest", { path: "/" });
        return res.status(error.status).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      // Do not expose provider bodies, credential rows, SQLite errors or private content.
      if (!res.headersSent)
        return res.status(500).json({
          error: "Joinlet could not complete this request. Please try again.",
        });
    }
  };
  return {
    middleware,
    store,
    context,
    notify(workspace: string, path: string) { changed(workspace, path); },
    onChanged(listener: typeof changed) {
      const previous = changed;
      changed = (workspace, path) => { previous(workspace, path); listener(workspace, path); };
    },
    onAccessChanged(listener: typeof accessChanged) {
      accessChanged = listener;
    },
  };
}
export type HostedBackend = ReturnType<typeof createHostedBackend>;
