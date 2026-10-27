import type { RequestHandler } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Origins come from validated configuration, never from forwarded request headers. */
export function webHosting(publicUrl: string, siteUrl?: string, analyticsPath?: string, optionalLogin = false) {
  const split = !!siteUrl;
  const appHost = new URL(publicUrl).host;
  const siteHost = siteUrl ? new URL(siteUrl).host : null;
  const appBase = split ? `${publicUrl}/` : '/app/';
  const siteBase = siteUrl ? `${siteUrl}/` : '/';
  const isAppHost = (host?: string) => host?.toLowerCase() === appHost;
  const gate: RequestHandler = (req, res, next) => {
    if (!split || ['/health', '/ready'].includes(req.path)) return next();
    const host = req.headers.host?.toLowerCase();
    if (host !== appHost && host !== siteHost) return res.sendStatus(421);
    if (host === siteHost) {
      if (['GET', 'HEAD'].includes(req.method) && /^\/(?:app(?:\/|$)|auth(?:\/|$)|github(?:\/|$)|join(?:\/|$)|setup(?:\/|$))/.test(req.path)) {
        const target = req.originalUrl.replace(/^\/app(?:\/index\.html|\/)?(?=\?|$)/, '/');
        return res.redirect(302, publicUrl + target);
      }
      // The public site never handles sessions, mutations, OAuth or MCP discovery.
      if (!['GET', 'HEAD'].includes(req.method) || !/^\/(?:$|index\.html$|docs(?:\/|$)|assets\/|brand\/|robots\.txt$|sitemap\.xml$|favicon\.)/.test(req.path)) return res.sendStatus(404);
    } else {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      if (/^\/app(?:\/index\.html|\/)?$/.test(req.path)) return res.redirect(302, `${publicUrl}/${req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''}`);
      if (/^\/docs(?:\/|$)/.test(req.path)) return res.redirect(302, siteUrl + req.originalUrl);
    }
    next();
  };
  const robots: RequestHandler = (req, res) => res.type('text').send(split && isAppHost(req.headers.host)
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\nSitemap: ${siteUrl ?? publicUrl}/docs/sitemap.xml\n`);
  const render = (source: string, surface: string = 'site') => source
    .replaceAll('https://joinlet.co', escape(siteUrl ?? publicUrl))
    .replace(/href="\/app\/(\?[^"]*)?"/g, (_match, query = '') => `href="${escape(appBase)}${query}"`)
    .replace('</head>', `<meta name="strukt-mode" content="remote"><meta name="joinlet-app-url" content="${escape(appBase)}"><meta name="joinlet-site-url" content="${escape(siteBase)}">${analyticsPath ? `<meta name="joinlet-analytics" content="${escape(analyticsPath)}"><meta name="joinlet-analytics-source" content="${surface}">` : ''}</head>`);
  const page = async (dist: string, file: string) => {
    const html = render(await readFile(resolve(dist, file), 'utf8'), file === 'app/index.html' ? 'editor' : 'site');
    return optionalLogin && file === 'app/index.html' ? html.replace('</head>', '<meta name="joinlet-optional-login" content="true"></head>') : html;
  };
  const docs = (dist: string): RequestHandler => async (req, res, next) => {
    if (!/^\/docs(?:\/|$)/.test(req.path)) return next();
    let path: string;
    try { path = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
    if (!/\.[a-z]+$/.test(path)) path = path.replace(/\/$/, '') + '/index.html';
    if (!path.endsWith('.html') && path !== '/docs/sitemap.xml') return next();
    const file = resolve(dist, '.' + path);
    if (!file.startsWith(resolve(dist, 'docs') + sep)) return res.sendStatus(404);
    try {
      res.set('Cache-Control', 'no-cache').type(path.endsWith('.xml') ? 'xml' : 'html').send(render(await readFile(file, 'utf8')));
    } catch { next(); }
  };
  return { split, gate, page, docs, robots, isAppHost };
}
