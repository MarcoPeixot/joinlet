import { githubUrl } from '../brand/project.json';
import { GitHubIcon } from '../brand/GitHubIcon';
import { appUrl } from '../ui/urls';
import { uiText } from '../i18n';
import { ArrowUpRight, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { Logo } from '../ui/Logo';
import { documentationUrl } from '../ui/documentation';

const LINKS = [
  { label: uiText("Produto"), href: '#canvas-demo', id: 'canvas-demo' },
  { label: "Workspace", href: '#recursos', id: 'recursos' },
  { label: uiText("Para agentes"), href: '#agentes', id: 'agentes' },
  { label: uiText("Perguntas"), href: '#perguntas', id: 'perguntas' },
  { label: uiText("Documentação"), href: documentationUrl(), id: 'docs' },
];

export function Brand() {
  return <a className="brand" href="/" aria-label={uiText("Joinlet, início")}><Logo size={25} /><span>{"Joinlet"}</span></a>;
}

export function SiteNav({ dark, toggleTheme, current }: { dark: boolean; toggleTheme: () => void; current: string | null }) {
  const [drawer, setDrawer] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('main, footer'));
    const previous = surfaces.map(el => el.inert);
    surfaces.forEach(el => { el.inert = true; });
    header.current?.querySelector<HTMLAnchorElement>('nav a')?.focus();
    return () => {
      document.body.style.overflow = original;
      surfaces.forEach((el, index) => { el.inert = previous[index]!; });
    };
  }, [drawer]);
  useEffect(() => {
    const media = matchMedia('(min-width: 961px)');
    const close = () => { if (media.matches) setDrawer(false); };
    media.addEventListener('change', close);
    return () => media.removeEventListener('change', close);
  }, []);
  return <div ref={header} className="site-header" role={drawer ? 'dialog' : 'banner'} aria-modal={drawer || undefined} aria-label={drawer ? uiText("Navegação do site") : undefined} onKeyDown={(event) => {
    if (!drawer) return;
    if (event.key === 'Escape') { setDrawer(false); toggle.current?.focus(); }
    if (event.key === 'Tab') {
      const items = Array.from(header.current?.querySelectorAll<HTMLElement>('a, button, select') ?? []).filter(el => el.getClientRects().length > 0);
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="header-inner">
      <Brand />
      <nav id="site-nav" className={drawer ? 'navigation is-open' : 'navigation'} aria-label={uiText("Navegação principal")}>
        <ul className="nav-list">{LINKS.map((link) => <li key={link.id}><a className="nav-link" href={link.href} aria-current={current === link.id ? 'location' : undefined} onClick={() => { setDrawer(false); if(link.href.startsWith('#')) requestAnimationFrame(() => document.querySelector<HTMLElement>(link.href)?.focus({ preventScroll: true })); }}>{link.label}</a></li>)}<li className="github-menu-item"><a className="nav-link" href={githubUrl} onClick={() => setDrawer(false)}><GitHubIcon />GitHub<ArrowUpRight size={14} aria-hidden /></a></li></ul>
      </nav>
      <div className="header-actions">
        <a className="github-header" href={githubUrl} aria-label="GitHub" title="GitHub"><GitHubIcon /></a>
        <LanguagePicker />
        <button type="button" className="theme-toggle" aria-label={dark ? uiText("Usar tema claro") : uiText("Usar tema escuro")} onClick={toggleTheme}>{dark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}</button>
        <a data-analytics-cta="header" className="button header-cta" href={appUrl()}>{uiText("Abrir o editor")} <ArrowUpRight size={15} aria-hidden /></a>
        <button ref={toggle} type="button" className="menu-toggle" aria-label={drawer ? uiText("Fechar menu") : uiText("Abrir menu")} aria-expanded={drawer} aria-controls="site-nav" onClick={() => setDrawer(!drawer)}>{drawer ? <X size={21} aria-hidden /> : <Menu size={21} aria-hidden />}</button>
      </div>
    </div>
  </div>;
}
