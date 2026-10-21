import { readFileSync } from 'node:fs';
import { Marked } from 'marked';
import pages from './content.json' with { type: 'json' };

export const languages = ['en', 'pt-BR'];
export const groups = {
  start: ['Start here', 'Comece aqui'], workspace: ['Your workspace', 'Seu workspace'],
  team: ['Work with your team', 'Trabalhe em equipe'], agents: ['Agents and automation', 'Agentes e automação'],
  reference: ['Reference', 'Referência'],
};
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text = value => value.replace(/<[^>]*>/g, '').replace(/[`*_#]/g, '');
export const pageUrl = (slug, lang) => `/docs/${lang}/${slug}/`;
export const summary = (page, lang) => text(page[lang].body.split('\n\n')[0]);

export function renderPage(page, lang) {
  const pt = lang === 'pt-BR';
  const t = (en, br) => pt ? br : en;
  const current = page[lang];
  const toc = [];
  const ids = new Set();
  const markdown = new Marked({ renderer: { heading({ tokens, depth }) {
    const title = this.parser.parseInline(tokens);
    const base = text(title).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    let id = base; let i = 2; while (ids.has(id)) id = `${base}-${i++}`; ids.add(id);
    if (depth === 2) toc.push({id, title:text(title)});
    return `<h${depth} id="${id}">${title}<a class="heading-link" href="#${id}" aria-label="${esc(t('Link to','Link para')+' '+text(title))}">#</a></h${depth}>`;
  } } });
  const body = markdown.parse(current.body, { async:false });
  const nav = Object.entries(groups).map(([key,names])=>`<div class="nav-group"><p>${names[pt?1:0]}</p>${pages.filter(p=>p.group===key).map(p=>`<a href="${pageUrl(p.slug,lang)}" ${p.slug===page.slug?'aria-current="page"':''}>${esc(p[lang].title)}</a>`).join('')}</div>`).join('');
  const index = pages.findIndex(p=>p.slug===page.slug);
  const previous = pages[index-1], next = pages[index+1];
  const alternate = pt ? 'en' : 'pt-BR';
  const canonical = `https://joinlet.co${pageUrl(page.slug,lang)}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pageUrl(page.slug,lang)}"><title>${esc(current.title)} · Joinlet Docs</title><meta name="description" content="${esc(summary(page,lang))}"><meta name="color-scheme" content="light dark"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="https://joinlet.co${pageUrl(page.slug,'en')}"><link rel="alternate" hreflang="pt-BR" href="https://joinlet.co${pageUrl(page.slug,'pt-BR')}"><link rel="icon" href="/brand/joinlet-icon.svg"><link rel="stylesheet" href="/docs/style.css"><script src="/docs/client.js" defer></script></head><body data-lang="${lang}">
<a class="skip" href="#content">${t('Skip to content','Pular para o conteúdo')}</a>
<header class="docs-header"><a class="brand" href="/?lang=${lang}" aria-label="${t('Joinlet home','Joinlet, início')}"><img src="/brand/joinlet-icon.svg" alt="" width="28" height="28">Joinlet <span>Docs</span></a><div class="search" hidden><label class="sr-only" for="docs-search">${t('Search documentation','Buscar na documentação')}</label><input id="docs-search" type="search" placeholder="${t('Search documentation…','Buscar na documentação…')}" autocomplete="off" aria-controls="search-results"><kbd>/</kbd><div class="search-results" id="search-results" hidden><p role="status"></p><ul></ul></div></div><div class="header-tools"><a class="language" href="${pageUrl(page.slug,alternate)}" lang="${alternate}" hreflang="${alternate}">${pt?'English':'PT-BR'}</a><button class="theme" type="button" hidden aria-label="${t('Switch color theme','Alternar tema de cores')}">◐</button><a class="open-app" href="/app/?lang=${lang}">${t('Open app','Abrir app')} ↗</a></div></header>
<div class="docs-layout"><aside class="sidebar" aria-label="${t('Guide navigation','Navegação dos guias')}"><details class="docs-menu" open><summary>${t('Documentation menu','Menu da documentação')}</summary><nav aria-label="${t('Documentation','Documentação')}">${nav}</nav></details></aside><main id="content" tabindex="-1"><div class="breadcrumb">${t('Documentation','Documentação')} <span>/</span> ${groups[page.group][pt?1:0]}</div><article><h1>${esc(current.title)}</h1>${body}</article><nav class="page-navigation" aria-label="${t('Previous and next guides','Guias anterior e próximo')}">${previous?`<a href="${pageUrl(previous.slug,lang)}"><small>← ${t('Previous','Anterior')}</small>${esc(previous[lang].title)}</a>`:'<span></span>'}${next?`<a href="${pageUrl(next.slug,lang)}"><small>${t('Next','Próximo')} →</small>${esc(next[lang].title)}</a>`:''}</nav><footer>Joinlet · <a href="${pageUrl('references',lang)}">${t('Scope and sources','Escopo e fontes')}</a></footer></main><aside class="toc" aria-label="${t('Page outline','Estrutura da página')}"><nav aria-label="${t('On this page','Nesta página')}"><p>${t('On this page','Nesta página')}</p>${toc.map(h=>`<a href="#${h.id}">${esc(h.title)}</a>`).join('')}</nav></aside></div></body></html>`;
}

export function documentationAssets() {
  const assets = new Map();
  for (const name of ['style.css','client.js','mcp-tools.json','diagram.schema.json']) assets.set(`docs/${name}`,readFileSync(new URL(name,import.meta.url),'utf8'));
  for (const lang of languages) {
    for (const page of pages) assets.set(`docs/${lang}/${page.slug}/index.html`,renderPage(page,lang));
    assets.set(`docs/${lang}/index.html`,renderPage(pages[0],lang));
    assets.set(`docs/${lang}/search.json`,JSON.stringify(pages.map(p=>({title:p[lang].title,url:pageUrl(p.slug,lang),summary:summary(p,lang),text:text(p[lang].body)}))));
  }
  assets.set('docs/index.html',renderPage(pages[0],'en'));
  assets.set('docs/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${languages.flatMap(lang=>pages.map(page=>`<url><loc>https://joinlet.co${pageUrl(page.slug,lang)}</loc></url>`)).join('')}</urlset>`);
  return assets;
}

/** Same static HTML in development and production; no client-side routing dependency. */
export function documentationPlugin() {
  let assets;
  const getAssets = () => assets ??= documentationAssets();
  return {
    name:'joinlet-documentation',
    configureServer(server) {
      for (const file of ['content.json','style.css','client.js','mcp-tools.json','diagram.schema.json']) server.watcher.add(new URL(file,import.meta.url).pathname);
      server.watcher.on('change',file=>{ if(file.includes('/docs/')) { assets=undefined; server.ws.send({type:'full-reload'}); } });
      server.middlewares.use((req,res,next)=>{
        const pathname = new URL(req.url,'http://localhost').pathname;
        if (pathname!='/docs' && !pathname.startsWith('/docs/')) return next();
        let file = pathname.slice(1);
        if (!/\.[a-z]+$/.test(file)) file=file.replace(/\/$/,'')+'/index.html';
        const content=getAssets().get(file);
        if (content===undefined) {res.statusCode=404;res.end('Documentation page not found.');return;}
        const ext=file.split('.').pop();
        res.setHeader('Content-Type',({html:'text/html',css:'text/css',js:'text/javascript',json:'application/json',xml:'application/xml'}[ext]??'text/plain')+'; charset=utf-8');
        res.setHeader('Cache-Control','no-cache');res.end(content);
      });
    },
    generateBundle() { for (const [fileName,source] of getAssets()) this.emitFile({type:'asset',fileName,source}); },
  };
}
