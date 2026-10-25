import { createRepositoryHub } from './repositoryHub';
import { withAccessPlan, setRequestPlans } from '@strukt/workspace/access-context';
import { BetaLimitError } from '@strukt/workspace';
import express from 'express';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createStruktServer } from '@strukt/mcp';
import type { McpWorkspace } from '@strukt/mcp';
import { loadWorkspace, newWorkspace, workspaceFiles } from '@strukt/workspace';
import { writeWorkspace } from '@strukt/workspace/fs';
import { createRemoteAuth } from './auth';
import type { RemoteAuthOptions } from './auth';
import { GithubHttpError, githubApi, openAgentPull, openGithubWorkspace } from './githubWorkspace';
import { createHostedBackend } from './hosted';
import { webHosting } from './webHosting';
import { accountDirectory } from './accountDirectory';

const html = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const cookie = (header: string | undefined, name: string) => header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

export function createRemoteApp(options: RemoteAuthOptions) {
  const hosting = webHosting(options.publicUrl, options.siteUrl, options.analyticsPath);
  const auth = createRemoteAuth(options);
  const app = express();
  const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  let draining = false;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    if (auth.publicUrl.startsWith('https:')) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (['/api/', '/mcp', '/github/', '/auth/', '/join/'].some(path => req.path.startsWith(path))) res.set('Cache-Control', 'no-store');
    if (draining && !['/health', '/ready'].includes(req.path)) return res.status(503).json({ error: 'Joinlet is restarting. Try again shortly.' });
    next();
  });
  app.use(hosting.gate);
  app.use((_req, _res, next) => withAccessPlan(auth.accessPlan, next));
  app.set('trust proxy', options.trustProxyHops ?? 1);
  app.use('/api/repositories/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use('/api/repository-connector', express.json({ limit: '22mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true, mode: 'remote' }));
  app.get('/ready', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (draining) return res.status(503).json({ ok: false });
    try {
      auth.healthy();
      await Promise.all(['index.html', 'app/index.html', 'docs/en/index.html'].map(path => access(`${dist}/${path}`)));
      return res.json({ ok: true });
    } catch { return res.status(503).json({ ok: false }); }
  });

  const hosted = createHostedBackend(options, auth);
  app.use(accountDirectory(auth, options.accountDirectoryToken));
  const repositories = createRepositoryHub(options, auth, hosted);
  hosted.onChanged(repositories.changed);
  app.use(repositories.router);
  app.use(hosted.middleware);

  const issuerUrl = new URL(`${auth.publicUrl}/`);
  const resourceServerUrl = new URL(auth.resource);
  const oauth = { provider: auth.provider, issuerUrl, resourceServerUrl, scopesSupported: ['strukt'], resourceName: 'Joinlet', clientRegistrationOptions: { clientSecretExpirySeconds: 0 } };
  app.use(mcpAuthRouter(oauth));

  app.get('/github/callback', async (req, res) => {
    try {
      if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string') return res.status(400).send('Login GitHub inválido.');
      const { state, repos, client, redirectOrigin } = await auth.githubCallback(req.query.code, req.query.state);
      const repoOptions = repos.map((repo) => `<option value="${html(repo)}">${html(repo)}</option>`).join('');
      res.set('Content-Security-Policy', "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
      const install = options.githubAppSlug && /^[a-z0-9-]+$/.test(options.githubAppSlug)
        ? `<a href="https://github.com/apps/${options.githubAppSlug}/installations/new">Escolher repositórios no GitHub</a>`
        : '';
      res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Autorizar Joinlet</title><body style="font:16px system-ui;max-width:36rem;margin:5rem auto;padding:1rem"><h1>Autorizar agente no Joinlet</h1><p><strong>${html(client)}</strong> (${html(redirectOrigin)}) solicita acesso. Escolha o repositório que o agente poderá ler e alterar. As mudanças serão propostas em um pull request.</p>${repos.length ? `<form method="post" action="/github/select"><input type="hidden" name="state" value="${html(state)}"><label>Repositório <select name="repo">${repoOptions}</select></label><button type="submit">Autorizar este repositório</button></form>` : `<p>Nenhum repositório com acesso de escrita está disponível para esta GitHub App. ${install} Instale a App no repositório e tente novamente.</p>`}</body></html>`);
    } catch {
      res.status(400).send('O login expirou ou o GitHub recusou o acesso. Volte ao agente e tente novamente.');
    }
  });

  app.post('/github/select', async (req, res) => {
    try {
      if (typeof req.body.state !== 'string' || typeof req.body.repo !== 'string') return res.status(400).send('Seleção inválida.');
      const github = auth.githubForFlow(req.body.state, req.body.repo);
      const adapter = await openGithubWorkspace({ ...github, userId: 0, fetch: options.fetch });
      auth.beta.claim(github.userId, github.repo);
      setRequestPlans(auth.beta.accountPlan(github.userId), auth.beta.workspacePlan(github.repo));
      adapter.setupAgents(auth.resource);
      if ((await adapter.read('strukt.json')) === null) await writeWorkspace(adapter, newWorkspace(github.repo.split('/')[1]!));
      await adapter.flush();
      const selected = auth.selectRepo(req.body.state, req.body.repo);
      res.clearCookie('joinlet_session', { path: '/' });
      res.clearCookie('joinlet_guest', { path: '/' });
      res.cookie('strukt_session', selected.browserToken, { httpOnly: true, secure: auth.publicUrl.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60_000 });
      return res.redirect(selected.redirect);
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(400).send('A autorização expirou. Volte ao agente e tente novamente.'); }
  });

  const bearer = requireBearerAuth({ verifier: auth.provider, requiredScopes: ['strukt'], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl) });
  app.options('/mcp', (_req, res) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'Access-Control-Expose-Headers': 'mcp-session-id' });
    res.sendStatus(204);
  });
  app.use('/mcp', (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Expose-Headers', 'mcp-session-id');
    next();
  }, bearer);

  app.all('/mcp', async (req, res) => {
    const access = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!access) return res.sendStatus(401);
    try {
      const grant = await auth.githubToken(access);
      const adapter = await openGithubWorkspace({ ...grant, userId: 0, fetch: options.fetch });
      auth.beta.claim(grant.userId, grant.repo);
      setRequestPlans(auth.beta.accountPlan(grant.userId), auth.beta.workspacePlan(grant.repo));
      const loaded = await loadWorkspace(adapter);
      const data = loaded?.data ?? newWorkspace(grant.repo.split('/')[1]!);
      if (!loaded) await writeWorkspace(adapter, data);
      const disk = Object.fromEntries(await Promise.all(Object.keys(workspaceFiles(data)).map(async (path) => [path, await adapter.read(path)] as const)));
      const ws: McpWorkspace = {
        root: `https://github.com/${grant.repo}`, archDir: `${grant.repo}/.arch`, adapter,
        data, warnings: loaded?.warnings ?? [], disk,
      };
      const server = createStruktServer(ws, { githubTools: false });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.on('close', () => { void transport.close(); void server.close(); });
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof BetaLimitError && !res.headersSent) return res.status(403).json(error.toJSON());
      if (!res.headersSent) res.status(502).json({ error: error instanceof Error ? error.message : 'Não foi possível acessar o repositório.' });
    }
  });

  app.get('/api/remote/session', async (req, res) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant) return res.status(401).json({ error: 'Entre pelo agente para conectar um repositório.', mcpUrl: auth.resource });
    try {
      const github = await auth.githubForGrant(grant);
      auth.beta.presence(grant.repo).touch(String(github.userId));
      return res.json({ repo: grant.repo, csrf: grant.csrf, mcpUrl: auth.resource, beta: auth.beta.status(github.userId, grant.repo) });
    } catch (error) { return res.status(error instanceof BetaLimitError ? 403 : 401).json(error instanceof BetaLimitError ? error.toJSON() : { error: 'Sign in again to connect your workspace.' }); }
  });

  app.get('/api/remote/plan', async (req, res) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant) return res.status(401).json({ error: 'Sign in to see your beta usage.' });
    try {
      const github = await auth.githubForGrant(grant);
      auth.beta.presence(grant.repo).touch(String(github.userId));
      res.set('Cache-Control', 'no-store');
      return res.json(auth.beta.status(github.userId, grant.repo));
    } catch (error) { return res.status(error instanceof BetaLimitError ? 403 : 401).json(error instanceof BetaLimitError ? error.toJSON() : { error: 'Sign in again.' }); }
  });

  app.get('/api/remote/revision', async (req, res) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant || req.query.repo !== grant.repo) return res.status(401).json({ error: 'Sessão inválida.' });
    try {
      const github = await auth.githubForGrant(grant);
      const api = githubApi(github.token, options.fetch);
      const base = `/repos/${grant.repo}`;
      const branch = (await openAgentPull(api, grant.repo, 0))?.head.ref;
      let ref: { object: { sha: string } };
      try {
        if (!branch) throw new GithubHttpError(404, base);
        ref = await api(`${base}/git/ref/heads/${encodeURIComponent(branch)}`);
      }
      catch (error) {
        if (!(error instanceof GithubHttpError) || error.status !== 404) throw error;
        const repo = await api<{ default_branch: string }>(base);
        ref = await api(`${base}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
      }
      return res.json({ revision: Number.parseInt(ref.object.sha.slice(0, 12), 16) });
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no GitHub.' }); }
  });

  app.get('/api/remote/pr', async (req, res) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant || req.query.repo !== grant.repo) return res.status(401).json({ error: 'Sessão inválida.' });
    try {
      const github = await auth.githubForGrant(grant);
      const pull = await openAgentPull(githubApi(github.token, options.fetch), grant.repo, 0);
      return res.json({ url: pull?.html_url ?? null });
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no GitHub.' }); }
  });

  app.post('/api/remote/disconnect', (req, res) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant || req.header('x-strukt-csrf') !== grant.csrf) return res.status(401).json({ error: 'Sessão inválida.' });
    auth.revokeBrowser(token!);
    const webToken = cookie(req.headers.cookie, 'joinlet_session');
    if (webToken) auth.revokeWebSession(webToken);
    res.clearCookie('joinlet_session', { path: '/' });
    res.clearCookie('strukt_session', { path: '/' });
    return res.json({ ok: true });
  });

  const browser = async (req: express.Request, res: express.Response) => {
    const token = cookie(req.headers.cookie, 'strukt_session');
    const grant = token ? auth.browserGrant(token) : null;
    if (!grant || (req.method !== 'GET' && req.header('x-strukt-csrf') !== grant.csrf)) {
      res.status(401).json({ error: 'Sessão inválida.' });
      return null;
    }
    const requestedRepo = req.method === 'GET' ? req.query.repo : req.body?.repo;
    if (requestedRepo !== grant.repo) {
      res.status(409).json({ error: 'Outro repositório está conectado.' });
      return null;
    }
    const github = await auth.githubForGrant(grant);
    const adapter = await openGithubWorkspace({ ...github, userId: 0, fetch: options.fetch });
    auth.beta.claim(github.userId, github.repo);
      setRequestPlans(auth.beta.accountPlan(github.userId), auth.beta.workspacePlan(github.repo));
    auth.beta.presence(grant.repo).touch(String(github.userId));
    return adapter;
  };

  app.post('/api/remote/init', async (req, res) => {
    try {
      const adapter = await browser(req, res);
      if (!adapter) return;
      const setup = adapter.setupAgents(auth.resource);
      if ((await adapter.read('strukt.json')) === null) {
        await writeWorkspace(adapter, newWorkspace(adapter.repo.split('/')[1]!));
      }
      return res.json({ ok: true, setup, pullRequest: await adapter.flush() });
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no GitHub.' }); }
  });

  app.get('/api/remote/workspace', async (req, res) => {
    try {
      const adapter = await browser(req, res);
      if (!adapter) return;
      const path = req.query.path;
      if (typeof path === 'string') return res.json({ text: await adapter.read(path) });
      const files = await adapter.list();
      const stamps = Object.fromEntries(files.map((file) => [file, adapter.revision]));
      return res.json({ files, stamps, repo: adapter.repo });
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no GitHub.' }); }
  });

  app.post('/api/remote/workspace', async (req, res) => {
    try {
      const adapter = await browser(req, res);
      if (!adapter) return;
      const { path, text, remove, expected } = req.body as { path?: unknown; text?: unknown; remove?: unknown; expected?: unknown };
      if (typeof path !== 'string' || (text !== undefined && typeof text !== 'string') || (expected !== undefined && expected !== null && typeof expected !== 'string')) {
        return res.status(400).json({ error: 'Arquivo inválido.' });
      }
      if (expected !== undefined && await adapter.read(path) !== expected) return res.status(409).json({ error: 'O arquivo mudou no GitHub. Recarregue antes de salvar.' });
      if (remove === true) await adapter.remove(path);
      else if (typeof text === 'string') await adapter.write(path, text);
      else return res.status(400).json({ error: 'Informe text ou remove.' });
      return res.json({ ok: true, pullRequest: await adapter.flush(), revision: adapter.revision });
    } catch (error) { if (error instanceof BetaLimitError) return res.status(403).json(error.toJSON()); return res.status(502).json({ error: error instanceof Error ? error.message : 'Falha no GitHub.' }); }
  });

  app.get('/robots.txt', hosting.robots);
  app.get('/index.html', (_req, res) => res.redirect('/'));
  app.get(['/app', '/app/', '/app/index.html'], async (_req, res) => {
    try { res.set('Cache-Control', 'no-cache').type('html').send(await hosting.page(dist, 'app/index.html')); }
    catch { res.status(404).send('Frontend não compilado. Rode bun run build.'); }
  });
  app.use(hosting.docs(dist));
  app.use(express.static(dist, { index: false }));
  app.use('/docs', express.static(`${dist}/docs`, { index: 'index.html' }));
  app.get(['/setup', '/setup/'], async (_req, res) => {
    try { res.type('html').send(await hosting.page(dist, 'setup/index.html')); }
    catch { res.status(404).send('Joinlet setup guide is unavailable. Run bun run build.'); }
  });
  app.get('/', async (_req, res) => {
    try { res.set('Cache-Control', 'no-cache').type('html').send(await hosting.page(dist, hosting.split && hosting.isAppHost(_req.headers.host) ? 'app/index.html' : 'index.html')); }
    catch { res.status(404).send('Frontend não compilado. Rode bun run build.'); }
  });
  const errors: express.ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON body.' : 'Joinlet could not complete this request.' });
  };
  app.use(errors);
  return { app, auth, hosted, repositories, drain: () => { draining = true; repositories.close(); } };
}
