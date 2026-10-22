import { githubUrl } from '../brand/project.json';
import { GitHubIcon } from '../brand/GitHubIcon';
import { appUrl } from '../ui/urls';
import { documentationUrl } from '../ui/documentation';
import { getLocale, uiText } from '../i18n';
import { ArrowRight, ArrowUpRight, Check, FolderTree, GitBranch, Minus, Play, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/sora';
import '@fontsource-variable/geist-mono';
import { themeAttribute } from '../ui/theme';
import { Imports } from './Imports';
import { Brand, SiteNav } from './Nav';
import { AgentsStage, RepositoryStage } from './Stages';
import { useActiveSection, useReveal } from './motion';
import { Workbench } from './Workbench';
import type { Stage } from './model';
import { Integrations } from './Integrations';
import { JoIllustration } from './JoIllustration';
import { FeatureShowcase } from './FeatureShowcase';
import { ProviderCarousel } from './ProviderCarousel';
import './landing.css';
import { AnalyticsConsent } from '../analytics/AnalyticsConsent';
import { startAnalytics } from '../analytics/client';

const THEME_KEY = 'strukt:theme';
function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch { /* unavailable */ }
      if (saved !== 'system') return;
      const attr = themeAttribute('system', query.matches);
      document.documentElement.dataset.theme = attr;
      setDark(attr !== 'light');
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return [dark, () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* applies for this visit */ }
    setDark(!dark);
  }];
}

const QUESTIONS = [
  [uiText("Preciso criar uma conta para experimentar?"), uiText("Não. Abra o editor e comece no navegador, sem conta. Seus itens ficam salvos localmente. Para usar IA, execute o Joinlet localmente e conecte um provedor nas configurações.")],
  [uiText("Onde o meu trabalho fica salvo?"), uiText("Por padrão, no seu navegador, em IndexedDB. Você também pode conectar uma pasta para trabalhar com arquivos em .arch/ e versioná-los no Git. A conexão direta com pastas depende do suporte do navegador à File System Access API.")],
  [uiText("Posso escolher o modelo e o provedor de IA?"), uiText("Com o servidor local do Joinlet ativo, conecte OpenCode Go, OpenCode Zen, OpenRouter, Anthropic, Gemini, DeepSeek, Groq, Mistral AI ou uma API compatível com OpenAI nas configurações. Use sua própria chave e escolha o provedor e o modelo no chat. A disponibilidade dos modelos e o custo dependem do provedor conectado.")],
  [uiText("O que o agente pode fazer no workspace?"), uiText("Criar e editar diagramas, documentos e sketches, dividir diagramas e organizar itens em pastas. Também pode pesquisar na web quando necessário. As alterações aplicadas oferecem a opção de desfazer, e você pode manter várias conversas com histórico por workspace.")],
  [uiText("Como os agentes de código acessam a arquitetura?"), uiText("O servidor MCP permite consultar e editar a arquitetura em .arch/ a partir de clientes como Claude Code, Cursor, VS Code e Codex. Os arquivos gerados em .arch/context/ também entregam contexto legível em Markdown.")],
  [uiText("Posso levar meu trabalho para outras ferramentas?"), uiText("Sim. Exporte diagramas como SVG, PNG, Mermaid ou PlantUML e documentos em PDF. A seleção de componentes também pode ser copiada como PNG transparente. Você pode baixar o workspace completo em .zip.")],
];
const SECTIONS = ['canvas-demo', 'recursos', 'agentes', 'perguntas'];

function SectionHead({ kicker, id, title, children }: { kicker: string; id: string; title: ReactNode; children?: ReactNode }) {
  return <header className="section-head" data-reveal><p className="kicker">{kicker}</p><h2 id={id}>{title}</h2>{children && <p className="section-lede">{children}</p>}</header>;
}

function Landing() {
  const [stage, setStage] = useState<Stage>('idle');
  const [dark, toggleTheme] = useTheme();
  const current = useActiveSection(SECTIONS);
  useReveal();
  useEffect(() => {
    const reveal = () => { const target = document.getElementById(location.hash.slice(1)); if (target instanceof HTMLDetailsElement) target.open = true; };
    reveal(); window.addEventListener('hashchange', reveal); return () => window.removeEventListener('hashchange', reveal);
  }, []);
  return <>
    <a className="skip-link" href="#conteudo">{uiText("Pular para o conteúdo")}</a>
    <SiteNav dark={dark} toggleTheme={toggleTheme} current={current} />
    <main id="conteudo">
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap hero-head">
          <div className="hero-copy">
            <a className="hero-chip" href="#recursos">{uiText("Desenhe · Documente · Conecte")}<ArrowRight size={14} aria-hidden /></a>
            <h1 id="hero-title"><span>{uiText("Transforme sistemas complexos em")}</span><span><em>{uiText("diagramas claros.")}</em></span></h1>
            <p className="hero-lede">{uiText("Um workspace visual para desenhar, explorar e documentar a arquitetura de software. Conecte ideias. Construa sistemas.")}</p>
            <div className="hero-actions"><a className="button on-color" href={appUrl()}>{uiText("Abrir o app")} <ArrowRight size={17} aria-hidden /></a><a className="button outline-color" href="#canvas-demo"><Play size={15} aria-hidden />{uiText("Ver demonstração")}</a></div>
            <ul className="hero-reassurance"><li><Check size={14} aria-hidden />{uiText("Sem conta")}</li><li><Check size={14} aria-hidden />{uiText("No seu navegador")}</li><li><Check size={14} aria-hidden />{uiText("Suas ideias, conectadas")}</li></ul>
          </div>
          <div className="hero-illustration">
            <JoIllustration />

          </div>
        </div>
        <div className="wrap hero-stage" id="canvas-demo" tabIndex={-1}><Workbench stage={stage} setStage={setStage} dark={dark} /><p className="preview-caption">{uiText("Demonstração interativa")} · {uiText("Explore as abas ou experimente uma alteração no diagrama.")}</p></div>
      </section>

      <Integrations />
      <section className="workspace-section wrap" id="recursos" tabIndex={-1} aria-labelledby="workspace-title">
        <SectionHead kicker={uiText("Recursos")} id="workspace-title" title={<>{uiText("Tudo para desenhar,")}<br />{uiText("documentar e evoluir.")}</>}>{uiText("Um workspace moderno e intuitivo para a arquitetura do seu software.")}</SectionHead>
        <FeatureShowcase />
        <div className="workspace-footnote"><FolderTree size={16} aria-hidden /><p>{uiText("Pastas, histórico e contexto compartilhado. Tudo dentro do seu projeto.")}</p></div>
      </section>

      <section className="ai-section wrap" id="inteligencia" aria-labelledby="ai-title">
        <div className="ai-copy"><SectionHead kicker={uiText("Um agente dentro do seu projeto")} id="ai-title" title={<>{uiText("Da conversa")}<br /><em>{uiText("para o canvas.")}</em></>}>{uiText("Peça uma nova arquitetura, documente uma decisão ou organize o workspace. O agente usa o contexto do seu projeto para colocar a ideia em prática.")}</SectionHead><ul className="benefits"><li><Check size={16} aria-hidden />{uiText("Cria e edita diagramas, documentos e sketches")}</li><li><Check size={16} aria-hidden />{uiText("Pesquisa na web e traz as fontes")}</li><li><Check size={16} aria-hidden />{uiText("Várias conversas, histórico e respostas em streaming")}</li></ul><a className="text-link" href={appUrl()}>{uiText("Comece uma conversa")}<ArrowRight size={16} aria-hidden /></a></div>
        <p className="ai-setup-note">{uiText("O editor funciona no navegador. Para usar IA, execute o Joinlet localmente e conecte seu provedor.")} <a href={`/setup/?lang=${getLocale()}`}>{uiText("Como configurar a IA")}</a></p><ProviderCarousel />
      </section>

      <details className="engineering-details wrap" id="repositorio"><summary><GitBranch size={20} /><span>{uiText("Sua arquitetura no Git")}<small>{uiText("Explore versões, mudanças e arquivos do projeto.")}</small></span><Plus size={18} /></summary><section className="stage" aria-labelledby="repo-title">
        <div className="section-heading-row"><SectionHead kicker={uiText("Feito para o seu fluxo de engenharia")} id="repo-title" title={<>{uiText("Sua arquitetura.")}<br /><em>{uiText("No seu repositório.")}</em></>}>{uiText("Arquivos legíveis, histórico no Git e um diff que mostra o que mudou no sistema. O desenho e as decisões acompanham o projeto.")}</SectionHead><span className="section-marker"><GitBranch size={16} aria-hidden />{".arch/"}</span></div>
        <div data-reveal><RepositoryStage stage={stage} setStage={setStage} /></div>
      </section>

      </details>
      <details className="engineering-details wrap" id="agentes"><summary><Sparkles size={20} /><span>{uiText("Conecte seus agentes de código")}<small>{uiText("Veja como o MCP leva a arquitetura ao seu agente.")}</small></span><Plus size={18} /></summary><section className="stage agents-section" aria-labelledby="agents-title">
        <SectionHead kicker={uiText("Contexto para quem constrói com você")} id="agents-title" title={<>{uiText("O agente entende o sistema.")}<br /><em>{uiText("Antes de mudar o código.")}</em></>}>{uiText("Conecte seu agente de código pelo MCP. Componentes, dependências e decisões deixam de ser contexto perdido e passam a fazer parte do trabalho.")}</SectionHead>
        <div data-reveal><AgentsStage stage={stage} setStage={setStage} /></div>
      </section>

      </details>
      <Imports />

      <section className="faq wrap" id="perguntas" tabIndex={-1} aria-labelledby="faq-title">
        <SectionHead kicker={uiText("Bom saber")} id="faq-title" title={<>{uiText("Menos dúvidas.")}<br /><em>{uiText("Mais ideias.")}</em></>} />
        <div className="faq-list">{QUESTIONS.map(([question, answer]) => <details key={question}><summary>{question}<Plus className="faq-plus" size={18} aria-hidden /><Minus className="faq-minus" size={18} aria-hidden /></summary><div className="faq-answer"><p>{answer}</p></div></details>)}</div>
      </section>
      <section className="closing wrap" aria-labelledby="closing-title"><div className="closing-panel"><img src="/brand/jo-celebrating.webp" width="1536" height="1024" loading="lazy" alt="" /><div><p className="kicker">{uiText("Duas ideias. Novas possibilidades.")}</p><h2 id="closing-title">{uiText("Pronto para conectar")}<br /><em>{uiText("suas ideias?")}</em></h2><p>{uiText("Seu próximo sistema começa com uma conexão.")}</p><div className="closing-actions"><a className="button on-color" href={appUrl()}>{uiText("Abrir o Joinlet")}<ArrowRight size={17} aria-hidden /></a><a className="button outline-color" href="#canvas-demo"><Play size={15} aria-hidden />{uiText("Ver demonstração")}</a></div></div></div></section>
    </main>
    <footer className="site-footer"><div className="wrap footer-grid"><div className="footer-brand"><Brand /><p>{uiText("Conecte ideias. Construa sistemas.")}</p></div><div><h2>{"Explore"}</h2><a href="#canvas-demo">{uiText("O produto")}</a><a href="#recursos">{uiText("Seu workspace")}</a><a href="#inteligencia">{uiText("Agente de IA")}</a></div><div><h2>{uiText("Construa")}</h2><a href="#repositorio">{uiText("Arquitetura no Git")}</a><a href="#agentes">{uiText("MCP e agentes")}</a><a href="#importa">{uiText("Importadores")}</a></div><div><h2>{uiText("Comece")}</h2><a href={documentationUrl()}>{uiText("Documentação")}</a><a href={githubUrl}><GitHubIcon size={15} />GitHub<ArrowUpRight size={14} aria-hidden /></a><a href="#perguntas">{uiText("Perguntas frequentes")}</a><a href={appUrl()}>{uiText("Abrir o editor")}<ArrowUpRight size={14} aria-hidden /></a></div></div><div className="wrap footer-bottom"><span>Joinlet · joinlet.co</span><span>{uiText("Feito para pensar e construir, juntos.")}</span></div></footer>
  </>;
}
startAnalytics();
createRoot(document.getElementById('root')!).render(<><Landing /><AnalyticsConsent /></>);
