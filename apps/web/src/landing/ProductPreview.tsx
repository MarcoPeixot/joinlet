import { appUrl } from '../ui/urls';
import { uiText } from '../i18n';
import { useState } from 'react';
import { ArrowUpRight, Box, Check, ChevronRight, Database, Maximize2, Minus, Pause, Play, Plus, Search, Server, Workflow } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { BRAND_ICONS } from './brandIcons';
const NODES = [
  { id: 'web', x: 300, y: 30, title: 'Web App', tech: 'React', icon: 'react', color: '#6c9fd7', description: uiText("Interface de entrada do sistema. Conecta autenticação, inventário e pagamento.") },
  { id: 'auth', x: 82, y: 155, title: 'Auth', tech: 'Node.js', icon: 'nodejs', color: '#62a77e', description: uiText("Valida a identidade e as permissões antes de acessar o inventário.") },
  { id: 'inventory', x: 300, y: 155, title: 'Inventory', tech: 'Node.js', icon: 'nodejs', color: '#7fc54d', description: uiText("Organiza os produtos e mantém as consultas rápidas com o cache Redis.") },
  { id: 'payment', x: 518, y: 155, title: 'Payment', tech: 'Node.js', icon: 'nodejs', color: '#a193e0', description: uiText("Processa os pagamentos e guarda os comprovantes no armazenamento de objetos.") },
  { id: 'postgres', x: 82, y: 280, title: 'PostgreSQL', tech: 'Database', icon: 'postgres', color: '#6c9fd7', description: uiText("Mantém os dados de identidade e acesso persistidos.") },
  { id: 'redis', x: 300, y: 280, title: 'Redis', tech: 'Cache', icon: 'redis', color: '#df8a79', description: uiText("Cache de consultas do inventário para reduzir acessos repetidos.") },
  { id: 'storage', x: 518, y: 280, title: 'Storage', tech: 'Objects', icon: 'database', color: '#a68bd4', description: uiText("Armazena os comprovantes produzidos pelo serviço de pagamento.") },
];
const EDGES = [
  { from: 'web', to: 'auth', path: 'M370 90V116Q370 122 364 122H158Q152 122 152 128V153' },
  { from: 'web', to: 'inventory', path: 'M370 90V153' },
  { from: 'web', to: 'payment', path: 'M370 90V116Q370 122 376 122H582Q588 122 588 128V153' },
  { from: 'auth', to: 'postgres', path: 'M152 215V278' },
  { from: 'inventory', to: 'redis', path: 'M370 215V278' },
  { from: 'payment', to: 'storage', path: 'M588 215V278' },
  { from: 'auth', to: 'inventory', path: 'M222 185H298' },
];
export function ProductPreview() {
  const [selected, setSelected] = useState('inventory');
  const [query, setQuery] = useState('');
  const [flow, setFlow] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [zoom, setZoom] = useState(1);
  const node = NODES.find(n => n.id === selected)!;
  const connections = EDGES.filter(e => e.from === selected || e.to === selected);
  return <div className="product-preview interactive-preview">
    <div className="product-preview-bar"><span className="product-preview-brand"><Logo size={20} />{"Joinlet"}</span><span className="preview-location">{uiText("Meu workspace")} <ChevronRight size={12} aria-hidden /> Inventory System</span><span className="preview-live"><i />{uiText("Prévia interativa")}</span><a href={appUrl()}>{uiText("Abrir o Joinlet")} <ArrowUpRight size={12} aria-hidden /></a></div>
    <div className="product-preview-body">
      <aside aria-label={uiText("Componentes da demonstração")}><strong>Inventory System</strong><label className="preview-search"><Search size={13} aria-hidden /><input aria-label={uiText("Buscar componente na demonstração")} value={query} onChange={e=>setQuery(e.target.value)} placeholder={uiText("Buscar componente…")} /></label><p className="preview-group-label">{uiText("Componentes")} <span>{"7"}</span></p>{NODES.filter(n=>`${n.title} ${n.tech}`.toLowerCase().includes(query.toLowerCase())).map(n=><button key={n.id} aria-pressed={selected===n.id} onClick={()=>setSelected(n.id)}><Box size={13} aria-hidden />{n.title}</button>)}{query && !NODES.some(n=>`${n.title} ${n.tech}`.toLowerCase().includes(query.toLowerCase())) && <p>{uiText("Nenhum componente.")}</p>}<div className="preview-local"><Check size={13} aria-hidden />{uiText("Exemplo local")}</div></aside>
      <div className="product-preview-canvas"><div className="preview-canvas-heading"><span><Workflow size={14} aria-hidden />{uiText("Arquitetura do inventário")}</span><button aria-label={flow ? uiText("Pausar fluxo da prévia") : uiText("Animar fluxo da prévia")} aria-pressed={flow} onClick={()=>setFlow(!flow)}>{flow ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{uiText("Fluxo")}</button></div>
        <svg viewBox="0 0 740 390" role="group" aria-label={uiText("Prévia interativa do sistema de inventário")}>
          <defs><marker id="preview-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
          <g transform={`translate(370 195) scale(${zoom}) translate(-370 -195)`}>
          {EDGES.map(edge => { const active=edge.from===selected||edge.to===selected;const color=NODES.find(n=>n.id===edge.to)!.color;return <g key={edge.from+edge.to} className="preview-edge" opacity={active?1:.3}><path d={edge.path} fill="none" stroke={color} strokeWidth={active?2:1.5} markerEnd="url(#preview-arrow)" />{flow&&<circle className="pulse" r={"3"} fill={color}><animateMotion path={edge.path} dur="2.6s" repeatCount="indefinite" /></circle>}</g>;})}
          {NODES.map(n => <g key={n.id} transform={`translate(${n.x} ${n.y})`} className="preview-node" data-selected={n.id===selected||undefined} tabIndex={0} role="button" aria-label={uiText("Inspecionar {0}", [n.title])} aria-pressed={n.id===selected} onClick={()=>setSelected(n.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(n.id);}}}><rect className="preview-node-halo" x="-4" y="-4" width="148" height="68" rx="12" fill={n.color} fillOpacity=".12" /><rect width="140" height="60" rx="9" fill="var(--lp-panel)" stroke={n.color} strokeOpacity={n.id===selected?1:.55} strokeWidth={n.id===selected?2:1} /><rect x="12" y="17" width="26" height="26" rx={"7"} fill={n.color} fillOpacity=".16" />{n.icon==='database'?<Database x={17} y={22} width={16} height={16} color={n.color}/>:<svg x="17" y="22" width="16" height="16" viewBox="0 0 24 24"><path fill={n.color} d={BRAND_ICONS[n.icon]?.path}/></svg>}<text x="46" y="27" fill="var(--lp-ink)" fontSize="11" fontWeight="600">{n.title}</text><text x="46" y="43" fill="var(--lp-muted)" fontSize="10">{n.tech}</text></g>)}
          </g>
        </svg>
        <div className="preview-canvas-bottom"><span>{uiText("Selecione um componente para explorar")}</span><div className="product-preview-zoom"><button aria-label={uiText("Diminuir zoom da prévia")} disabled={zoom<=.8} onClick={()=>setZoom(z=>Math.max(.8,z-.1))}><Minus size={13}/></button><span>{Math.round(zoom*100)}{"%"}</span><button aria-label={uiText("Aumentar zoom da prévia")} disabled={zoom>=1.4} onClick={()=>setZoom(z=>Math.min(1.4,z+.1))}><Plus size={13}/></button><button aria-label={uiText("Enquadrar prévia")} onClick={()=>setZoom(1)}><Maximize2 size={13}/></button></div></div>
      </div>
      <section className="preview-inspector" aria-label={uiText("Detalhes do componente selecionado")}><p className="preview-group-label">{uiText("Componente")}</p><span className="preview-inspector-icon" style={{color:node.color}}><Server size={22} aria-hidden/></span><h2>{node.title}</h2><span className="preview-tech">{node.tech}</span><p>{node.description}</p><h3>{uiText("Conexões")} <span>{connections.length}</span></h3>{connections.map(edge=><button key={edge.from+edge.to} onClick={()=>setSelected(edge.from===selected?edge.to:edge.from)}><span>{NODES.find(n=>n.id===(edge.from===selected?edge.to:edge.from))!.title}</span><span>{edge.from===selected?uiText("Saída"):uiText("Entrada")}<ChevronRight size={12}/></span></button>)}<a href="#canvas-demo">{uiText("Experimente uma alteração")} <ArrowUpRight size={13} aria-hidden/></a></section>
    </div>
  </div>;
}
