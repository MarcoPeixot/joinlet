import { appUrl } from '../ui/urls';
import { getLocale, uiText } from '../i18n';
import type { ID } from '@strukt/core';
import { ArrowUpRight, Check, Code2, FileText, Folder, MessageSquare, Network, PanelLeft, PenTool, RotateCcw, Sparkles, Waves } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Logo } from '../ui/Logo';
import { Diagram, useWide } from './Diagram';
import { PROMPT, SLUG, baseModel, blockOf, changes, diffRows, jsonLines, modelFor, proposedModel } from './model';
import type { Stage } from './model';

const DRAFT_ADDED: ReadonlySet<string> = new Set([...changes.elements.added, ...changes.edges.added]);
const ADDED_LINES: ReadonlySet<number> = new Set(diffRows(jsonLines(baseModel), jsonLines(proposedModel), Number.MAX_SAFE_INTEGER).flatMap((row) => (row.kind === 'add' ? [row.line] : [])));
const LINE_HEIGHT = 20;

/** Colors one JSON line for the editor's code pane: keys, strings and punctuation only. */
export function JsonLine({ text }: { text: string }) {
  const parts: ReactElement[] = [];
  const token = /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],])|(-?\d+|true|false|null)/g;
  let last = 0;
  for (let match = token.exec(text); match; match = token.exec(text)) {
    if (match.index > last) parts.push(<span key={last}>{text.slice(last, match.index)}</span>);
    const cls = match[1] ? (match[2] ? 'tk-key' : 'tk-str') : match[3] ? 'tk-punct' : 'tk-num';
    parts.push(<span key={match.index} className={cls}>{match[1] ?? match[3] ?? match[4]}{match[2] ? <span className="tk-punct">{match[2]}</span> : null}</span>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

const FIRST_ADDED = Math.min(...ADDED_LINES) - 1;

function CodePane({ stage, highlight }: { stage: Stage; highlight: [number, number] | null }) {
  const lines = useMemo(() => jsonLines(modelFor(stage)), [stage]);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pane.current;
    if (!el || !highlight) return;
    const top = highlight[0] * LINE_HEIGHT;
    const bottom = (highlight[1] + 1) * LINE_HEIGHT;
    if (top >= el.scrollTop && bottom <= el.scrollTop + el.clientHeight) return;
    el.scrollTo({ top: Math.max(0, top - LINE_HEIGHT * 3), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [highlight]);
  useEffect(() => {
    const el = pane.current;
    if (stage !== 'applied' || !el) return;
    el.scrollTo({ top: Math.max(0, (FIRST_ADDED - 4) * LINE_HEIGHT), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [stage]);
  return (
    <div className="code-pane">
      <div className="code-pane-bar"><Code2 size={14} aria-hidden /><span>{SLUG}{".strukt.json"}</span><span className="code-pane-state">{stage === 'proposed' ? uiText("somente leitura: há uma proposta") : uiText("canônico: chaves em ordem fixa")}</span></div>
      <div className="code-pane-lines" ref={pane} tabIndex={0} role="region" aria-label={uiText("Código do diagrama, {0} linhas", [lines.length])}>
        {lines.map((text, index) => {
          const marked = highlight && index >= highlight[0] && index <= highlight[1];
          return <div key={index} className="code-line" data-active={marked || undefined} data-added={stage === 'applied' && ADDED_LINES.has(index + 1) || undefined}><span className="code-no" aria-hidden>{index + 1}</span><code><JsonLine text={text} /></code></div>;
        })}
      </div>
    </div>
  );
}

export function Workbench({ stage, setStage, dark }: { stage: Stage; setStage: (stage: Stage) => void; dark: boolean }) {
  const wide = useWide();
  const [view, setView] = useState<'diagram' | 'document' | 'sketch'>('diagram');
  const [code, setCode] = useState(false);
  const [hover, setHover] = useState<ID | null>(null);
  const [pinned, setPinned] = useState<ID | null>(null);
  const active = hover ?? pinned;
  const [flow, setFlow] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const model = stage === 'idle' ? baseModel : proposedModel;
  const lines = useMemo(() => jsonLines(modelFor(stage)), [stage]);
  const highlight = useMemo(() => (active ? blockOf(lines, active) : null), [active, lines]);
  const message = stage === 'proposed' ? uiText("Proposta em revisão: 1 componente e 1 conexão novos, em verde.") : stage === 'applied' ? uiText("Proposta aplicada ao diagrama.") : '';
  const choose = (next: typeof view) => { setView(next); setCode(false); setHover(null); setPinned(null); };
  const views = [{ id: 'diagram', label: uiText("Diagramas"), icon: Network }, { id: 'document', label: uiText("Documentos"), icon: FileText }, { id: 'sketch', label: 'Sketches', icon: PenTool }] as const;
  return (
    <div className="workbench">
      <div className="wb-bar">
        <span className="wb-title"><Logo size={18} /><strong>{uiText("Meu workspace")}</strong><span className="save-dot" aria-hidden /></span>
        <span className="wb-hint">{uiText("Explore o Joinlet")}</span>
        <a href={appUrl(`?example=orders&stage=${stage === 'applied' ? 'applied' : 'base'}&lang=${getLocale()}`)} className="wb-open">{uiText("Abrir este exemplo")}<ArrowUpRight size={13} aria-hidden /></a>
      </div>
      <div className="wb-preview-tabs" role="group" aria-label={uiText("Explorar o workspace")}>
        {views.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={view === id} onClick={() => choose(id)}><Icon size={15} aria-hidden />{label}</button>)}
      </div>
      <div className="wb-body">
        <aside className="wb-sidebar" aria-label={uiText("Itens do workspace de demonstração")}>
          <p><PanelLeft size={14} aria-hidden />{uiText("Meu workspace")}</p>
          <span className="wb-folder"><Folder size={13} aria-hidden />{uiText("Arquitetura")}</span>
          {views.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} aria-pressed={view === id} onClick={() => choose(id)}><Icon size={14} aria-hidden />{id === 'diagram' ? uiText('Pedidos') : id === 'document' ? uiText('Decisões') : uiText("Ideias")}</button>)}
          <span className="wb-local"><span className="save-dot" aria-hidden />{uiText("Workspace local")}</span>
        </aside>
        {view === 'diagram' ? <div className="wb-canvas">
          <div className="wb-canvas-tools"><span>{uiText("Arquitetura de pedidos")}</span><div><button className="flow-toggle" aria-pressed={flow} onClick={() => setFlow(!flow)}><Waves size={14} aria-hidden /><span>{uiText("Fluxo")}</span></button><button className="flow-toggle" aria-label={code ? uiText("Mostrar conversa de exemplo") : uiText("Mostrar código do diagrama")} aria-pressed={code} onClick={() => setCode(!code)}><Code2 size={14} aria-hidden /></button></div></div>
          <Diagram model={model} draftAdded={stage === 'proposed' ? DRAFT_ADDED : undefined} active={active} flow={flow} entering={stage === 'idle' ? undefined : DRAFT_ADDED} onActive={setHover} onPin={(id) => { setCode(true); setPinned((current) => (current === id ? null : id)); }} wide={wide} dark={dark} />
          <div className="wb-canvas-footer"><span><span className="save-dot" aria-hidden />{stage === 'applied' ? uiText("Alteração aplicada") : uiText("Tudo conectado")}</span><span>{"Canvas · JSON · Git"}</span></div>
          <p className="sr-only" role="status">{message}</p>
        </div> : view === 'document' ? <div className="wb-document" role="region" aria-label={uiText("Prévia de documento")}><div className="wb-doc-bar"><FileText size={13} aria-hidden />{uiText("Documentos / Decisões")}<span>Markdown</span></div><article><p className="doc-kicker">{uiText("REGISTRO DE DECISÃO · 001")}</p><h2>{uiText("Eventos que conectam")}<br />{uiText("o sistema.")}</h2><span className="doc-status"><span className="save-dot" aria-hidden />{uiText("Aceito")}</span><h3>{uiText("Contexto")}</h3><p>{uiText("Pedidos, pagamentos e notificações evoluem em ritmos diferentes. Precisamos conectá-los sem criar dependências diretas.")}</p><h3>{uiText("Decisão")}</h3><p>{uiText("Publicar eventos de domínio no Kafka. Cada serviço processa os eventos que precisa, de forma independente.")}</p><blockquote>{uiText("Uma decisão documentada hoje é contexto para quem constrói amanhã.")}</blockquote></article></div> : <div className="wb-sketch" role="region" aria-label={uiText("Prévia de sketch")}><span className="sketch-note">{uiText("Ideias antes da arquitetura.")}</span>{wide ? <svg viewBox="0 0 600 360" role="img" aria-label={uiText("Rascunho de uma ideia de pedido até uma entrega")}><g className="sketch-lines"><path d="M32 122Q96 116 164 122L166 201Q98 207 32 201ZM242 119Q308 114 373 121L374 201Q310 206 241 200ZM452 122Q516 117 579 122L580 201Q518 204 451 199ZM174 158Q203 153 230 158M218 148L231 158L219 170M385 159Q413 155 440 160M427 149L440 160L428 171M308 212Q312 286 455 275M441 266L457 275L441 285" /></g><g className="sketch-labels"><text x="99" y="166">{uiText("Pedido")}</text><text x="308" y="166">{uiText("Evento")}</text><text x="516" y="166">{uiText("Entrega")}</text><text x="403" y="311">{uiText("e se usarmos uma fila?")}</text></g></svg> : <svg viewBox="0 0 300 410" role="img" aria-label={uiText("Rascunho de uma ideia de pedido até uma entrega")}><g className="sketch-lines"><path d="M70 20Q150 16 230 20L230 78Q150 82 70 78ZM70 145Q150 141 230 145L230 203Q150 207 70 203ZM70 270Q150 266 230 270L230 328Q150 332 70 328ZM150 87Q147 110 150 134M140 122L150 135L160 122M150 212Q153 235 150 260M140 248L150 261L160 248" /></g><g className="sketch-labels"><text x="150" y="55">{uiText("Pedido")}</text><text x="150" y="180">{uiText("Evento")}</text><text x="150" y="305">{uiText("Entrega")}</text><text x="150" y="380" fontSize="14">{uiText("e se usarmos uma fila?")}</text></g></svg>}<p>{uiText("Rascunhe. Conecte. Repense.")}</p></div>}
        {view === 'diagram' && code ? <CodePane stage={stage} highlight={highlight} /> : <div className="wb-chat">
          <div className="wb-chat-heading"><MessageSquare size={15} aria-hidden /><strong>{uiText("Agente")}</strong><Sparkles size={14} aria-hidden /></div>
          <span className="wb-chat-context">{uiText("Lendo:")} {view === 'diagram' ? uiText('Pedidos') : view === 'document' ? uiText('Decisões') : uiText("Ideias")}</span>
          <div className="wb-chat-copy"><span className="agent-avatar"><Sparkles size={18} aria-hidden /></span><p className="wb-chat-title">{view === 'diagram' ? uiText("Uma ideia. Um próximo passo.") : view === 'document' ? uiText("O porquê também importa.") : uiText("Toda arquitetura começa com uma ideia.")}</p><p className="wb-chat-description">{view === 'diagram' ? uiText("Explore a arquitetura e experimente adicionar um serviço ao diagrama.") : view === 'document' ? uiText("No app, peça ao agente para documentar decisões e explicar a arquitetura.") : uiText("No app, desenhe livremente ou peça ao agente para criar um sketch.")}</p></div>
          {view === 'diagram' && <div className="composer">
            {stage === 'idle' && <button className="composer-ask" onClick={() => setStage('proposed')}><Sparkles size={15} aria-hidden /><span>{uiText(PROMPT)}</span><ArrowUpRight size={15} aria-hidden /></button>}
            {stage === 'proposed' && <div className="review-bar" role="group" aria-label={uiText("Revisão da proposta")}><span><strong>{uiText("Proposta pronta")}</strong><br />{uiText("1 componente, 1 conexão")}</span><div><button className="ghost" onClick={() => setStage('idle')}>{uiText("Descartar")}</button><button className="solid" onClick={() => setStage('applied')}>{uiText("Aplicar")}</button></div></div>}
            {stage === 'applied' && <div className="composer-sent"><Check size={16} aria-hidden /><span>{uiText("Notificações adicionado.")}</span><button className="ghost" onClick={() => setStage('idle')}><RotateCcw size={14} aria-hidden />{uiText("Desfazer")}</button></div>}
          </div>}
          <div className="wb-chat-bottom"><span className="save-dot" aria-hidden />{uiText("Contexto do workspace")}<span>{uiText("Exemplo local")}</span></div>
        </div>}
      </div>
    </div>
  );
}
