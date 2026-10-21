import { EventScene, StoryControl, useStory } from './Story';
import { uiText } from '../i18n';
import { printDiagramJson } from '@strukt/json';
import { ArrowRight, Check, Copy, Download, GitBranch, GitPullRequest, Network, FileCode2, Sparkles, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { JsonLine } from './Workbench';
import { AGENTS_MD, BRANCH, SLUG, architectureExcerpt, baseModel, diffRows, jsonLines, layoutLines, modelFor, proposedModel } from './model';
import type { Stage } from './model';

interface StageProps { stage: Stage; setStage: (stage: Stage) => void }

const step = (index: number, base = 0): CSSProperties => ({ '--i': Math.min(index, 36), '--base': `${base}ms` } as CSSProperties);

function download(stage: Stage) {
  const url = URL.createObjectURL(new Blob([printDiagramJson(modelFor(stage))], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${SLUG}.strukt.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DiffFile({ name, before, after }: { name: string; before: string[]; after: string[] }) {
  const rows = diffRows(before, after);
  const added = rows.filter((row) => row.kind === 'add').length;
  return (
    <div className="diff-file">
      <div className="diff-file-bar"><span>{name}</span><span className="diff-count">{"+"}{added}</span></div>
      <div className="diff-lines" tabIndex={0} role="region" aria-label={uiText("Diferenças em {0}", [name])}>
        {rows.map((row, index) => row.kind === 'gap'
          ? <div key={index} className="diff-line" data-kind="gap" style={step(index)}><span className="diff-sign" aria-hidden /><code>{row.text}</code></div>
          : <div key={index} className="diff-line" data-kind={row.kind} style={step(index)}><span className="diff-sign" aria-hidden>{row.kind === 'add' ? "+" : row.kind === 'del' ? '−' : ''}</span><code><JsonLine text={row.text} /></code></div>)}
      </div>
    </div>
  );
}

const TREE: { path: string; depth: number; change?: 'M'; dir?: boolean }[] = [
  { path: '.arch/', depth: 0, dir: true },
  { path: 'strukt.json', depth: 1 },
  { path: 'strukt.schema.json', depth: 1 },
  { path: 'diagrams/', depth: 1, dir: true },
  { path: `${SLUG}.strukt.json`, depth: 2, change: 'M' },
  { path: `${SLUG}.layout.json`, depth: 2, change: 'M' },
  { path: 'docs/', depth: 1, dir: true },
  { path: 'versions/', depth: 1, dir: true },
  { path: 'context/', depth: 1, dir: true },
  { path: 'ARCHITECTURE.md', depth: 2, change: 'M' },
  { path: 'llms.txt', depth: 2 },
];

export function RepositoryStage({ stage, setStage }: StageProps) {
  const applied = stage === 'applied';
  const story = useStory();
  const [file, setFile] = useState<'diagram' | 'layout'>('diagram');
  const [diagramBefore, diagramAfter] = useMemo(() => [jsonLines(baseModel), jsonLines(proposedModel)], []);
  const [layoutBefore, layoutAfter] = useMemo(() => [layoutLines(baseModel), layoutLines(proposedModel)], []);
  const labels = [uiText('Visualize a mudança'), uiText('Revise o impacto'), uiText('Mantenha tudo junto')];
  return <div className="repo repo-story" ref={story.ref} data-applied={applied || undefined} data-playing={story.playing || undefined}>
    <header className="story-header"><span><GitBranch size={17} />{uiText('Uma mudança, do desenho ao repositório')}</span><StoryControl story={story} /></header>
    <div className="story-tabs" role="group" aria-label={uiText('Etapas da mudança')}>{labels.map((label, index) => <button key={label} onClick={() => story.select(index)} aria-pressed={story.step === index}><b>0{index + 1}</b>{label}<span /></button>)}</div>
    <div className="repo-story-body">
      <EventScene proposed applied={applied} active={story.step} />
      <div className="story-explanation" key={story.step}>
        <span className="story-eyebrow">{uiText('EXEMPLO: NOVO SERVIÇO')}</span>
        <h3>{uiText(['Adicione sem perder a visão do todo.', 'Saiba exatamente o que está aprovando.', 'O sistema e sua história, lado a lado.'][story.step]!)}</h3>
        <p>{uiText(['Notificações passa a receber os eventos do Kafka. O restante do sistema continua visível para você avaliar a conexão.', 'Um novo serviço, uma conexão. Revise a proposta antes de levar a mudança para o diagrama.', 'Diagrama, posição dos componentes e contexto dos agentes acompanham a mesma mudança no seu projeto.'][story.step]!)}</p>
        <div className="change-checklist">
          <div data-current={story.step === 0 || undefined}><Network size={17} /><span><b>+1 {uiText('componente')}</b><small>{uiText('Notificações')}</small></span><Check size={15} /></div>
          <div data-current={story.step === 1 || undefined}><GitPullRequest size={17} /><span><b>+1 {uiText('conexão')}</b><small>Kafka → {uiText('Notificações')}</small></span><Check size={15} /></div>
          <div data-current={story.step === 2 || undefined}><FileCode2 size={17} /><span><b>{uiText('3 arquivos conectados')}</b><small>{uiText('Diagrama · layout · contexto')}</small></span><Check size={15} /></div>
        </div>
        <button className="story-primary" disabled={applied} onClick={() => setStage('applied')}>{applied ? <><Check size={16} />{uiText('Proposta aplicada nesta demonstração.')}</> : <>{uiText('Aplicar a proposta')}<ArrowRight size={16} /></>}</button>
        <span className="story-disclaimer">{uiText('Demonstração interativa. Nenhum repositório é alterado.')}</span>
      </div>
    </div>
    <footer className="repo-story-footer"><span><GitBranch size={14} />{BRANCH}</span><button className="link-button" onClick={() => download(stage)}><Download size={15} />{uiText('Baixar')} {SLUG}.strukt.json</button></footer>
    <details className="repo-technical"><summary>{uiText('Explorar os arquivos e o diff')}<FileCode2 size={16} /></summary><div className="repo-technical-grid">
      <div className="repo-tree"><p className="mono-label">.arch/</p><ul aria-label={uiText('Arquivos de .arch/')}>{TREE.map(({path,depth,change}) => <li key={`${depth}${path}`} style={{paddingLeft:depth*12}}><span>{path}</span>{change && <span className="tree-mark">{applied ? 'M' : '+'}</span>}</li>)}</ul></div>
      <div className="repo-diff"><div className="repo-file-tabs" role="group" aria-label={uiText('Arquivo do diff')}><button aria-pressed={file === 'diagram'} onClick={() => setFile('diagram')}><Network size={14} />{uiText('Diagrama')}</button><button aria-pressed={file === 'layout'} onClick={() => setFile('layout')}><FileCode2 size={14} />Layout</button></div><DiffFile name={`.arch/diagrams/${SLUG}.${file === 'diagram' ? 'strukt' : 'layout'}.json`} before={file === 'diagram' ? diagramBefore : layoutBefore} after={file === 'diagram' ? diagramAfter : layoutAfter} /></div>
    </div></details>
  </div>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return <button className="copy-button" onClick={copy} aria-label={label}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}<span aria-live="polite">{copied ? uiText("Copiado") : uiText("Copiar")}</span></button>;
}


function Snippet({ title, text, label }: { title: string; text: string; label: string }) {
  return (
    <div className="snippet">
      <div className="snippet-bar"><span>{title}</span><CopyButton text={text} label={label} /></div>
      <pre>{text}</pre>
    </div>
  );
}

/** Show the outcome before offering the setup commands. */
export function AgentsStage({ stage, setStage }: StageProps) {
  const applied = stage === 'applied';
  const story = useStory();
  const excerpt = useMemo(() => architectureExcerpt(modelFor(stage)), [stage]);
  const labels = [uiText('Entende o sistema'), uiText('Encontra o contexto'), uiText('Propõe com clareza')];
  return <div className="agents agent-story" ref={story.ref} data-playing={story.playing || undefined}>
    <header className="story-header"><span><Sparkles size={17} />{uiText('Seu agente começa com o contexto certo')}</span><StoryControl story={story} /></header>
    <div className="agent-story-grid">
      <div className="agent-story-steps">
        <div className="agent-request"><span>{uiText('Você pede')}</span><p>{uiText('Adicione notificações quando um pedido for criado.')}</p></div>
        <div role="group" aria-label={uiText('Como o agente usa o contexto')}>{labels.map((label,index) => <button className="agent-story-step" aria-pressed={story.step === index} onClick={() => story.select(index)} key={label}><span>0{index+1}</span><div><h3>{label}</h3><p>{uiText(['Lê os componentes e segue as conexões existentes.', 'Identifica quem publica os eventos e quais serviços já os consomem.', 'Apresenta a nova conexão para você revisar antes de aplicar.'][index]!)}</p></div><ArrowRight size={17} /></button>)}</div>
        <p className="agent-story-footnote"><Check size={15} />{uiText('O contexto vem do seu workspace.')}</p>
      </div>
      <div className="agent-result" data-step={story.step}>
        <div className="agent-result-heading"><img src="/brand/joinlet-icon.svg" alt="" /><span>Joinlet <b>×</b> {uiText('seu agente')}</span><span className="story-status">{uiText(applied ? 'Atualizado' : 'Exemplo guiado')}</span></div>
        <EventScene proposed={story.step === 2} applied={applied} active={story.step} />
        <div className="agent-result-copy" key={story.step}><span className="story-eyebrow">0{story.step+1} / {labels[story.step]}</span><h3>{uiText(['A origem dos eventos está aqui.', 'A conexão tem uma razão.', 'Uma proposta que você pode revisar.'][story.step]!)}</h3><p>{uiText(['Pedidos publica no Kafka. Pagamentos já consome esses eventos. O agente encontra esse caminho antes de sugerir a mudança.', 'O novo serviço pode consumir do Kafka sem criar uma dependência direta com Pedidos. Você vê de onde vem essa sugestão.', 'Adicionar Notificações e conectá-lo ao Kafka. Você decide quando essa mudança entra no diagrama.'][story.step]!)}</p>
          {story.step === 2 && <button className="story-primary" disabled={applied} onClick={() => setStage('applied')}>{applied ? <><Check size={16} />{uiText('Proposta aplicada nesta demonstração.')}</> : <>{uiText('Aplicar a proposta')}<ArrowRight size={16} /></>}</button>}
        </div>
      </div>
    </div>
    <div className="agent-resources">
      <details className="agent-setup"><summary><span><Network size={17} />{uiText('Conectar ao meu projeto')}</span><span>+ MCP</span></summary>
        <ol className="agent-setup-grid" aria-label={uiText("Como conectar um agente")}><li><h3>01 / {uiText('Conecte o MCP')}</h3><p>{uiText('Um comando adiciona o Joinlet ao Claude Code. Cursor, VS Code e Codex usam o mesmo servidor.')}</p><Snippet title="Terminal" text={'claude mcp add joinlet -- \\\n  bun <repo>/apps/mcp/src/main.ts --dir .'} label={uiText('Copiar o comando de conexão')} /></li>
        <li><h3>02 / {uiText('Diga onde olhar')}</h3><p>{uiText('As instruções do projeto orientam o agente a consultar a arquitetura antes de editar.')}</p><Snippet title="AGENTS.md" text={AGENTS_MD} label={uiText('Copiar o trecho do AGENTS.md')} /></li>
        <li><h3>03 / {uiText('Mantenha o contexto atual')}</h3><p>{uiText('Verifique na CI se o contexto acompanha a versão atual do diagrama.')}</p><Snippet title="CI" text="joinlet context --check" label={uiText('Copiar o comando da CI')} /></li></ol>
      </details>
      <details className="agent-source"><summary><span><FileCode2 size={17} />{uiText('Inspecionar o contexto entregue ao agente')}</span><ArrowUpRight size={15} /></summary><div className="transcript-file" tabIndex={0} role="region" aria-label={uiText('Conteúdo de ARCHITECTURE.md')}>{[...excerpt.head,'',...excerpt.tables].map((line,index) => <div className="md-line" data-added={applied && line.includes('Notificações') || undefined} key={index}>{line || ' '}</div>)}</div></details>
    </div>
  </div>;
}
