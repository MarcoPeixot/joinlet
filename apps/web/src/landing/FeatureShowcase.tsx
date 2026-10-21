import { useState } from 'react';
import { ArrowUpRight, Bell, Blocks, Check, Database, FileText, GitBranch, Network, Server, Users, Workflow } from 'lucide-react';
import { uiText } from '../i18n';

export function FeatureShowcase() {
  const [component, setComponent] = useState(0);
  const components = [{ icon: Database, label: uiText('Banco de dados') }, { icon: Server, label: 'API' }, { icon: Bell, label: uiText('Notificações') }];
  const Component = components[component]!.icon;
  return <div className="features-grid feature-showcase">
    <article className="feature-card feature-tone-0 feature-model" data-reveal>
      <div className="feature-visual model-visual" aria-hidden="true"><div className="visual-toolbar"><span /><span /><span /><b>checkout / overview</b></div><svg viewBox="0 0 500 160"><path d="M125 80H240V35H360 M240 80V125H360" /></svg><span className="mini-service service-api"><Server size={20} /><b>API</b></span><span className="mini-service service-db"><Database size={19} />PostgreSQL</span><span className="mini-service service-queue"><Workflow size={19} />Kafka</span><span className="visual-cursor"><ArrowUpRight size={18} />{uiText('Conectar')}</span></div>
      <div className="feature-copy"><span className="feature-eyebrow"><Network size={15} />01 / {uiText('Desenhe')}</span><h3>{uiText('Modelagem visual')}</h3><p>{uiText('Transforme componentes soltos em um sistema que todos conseguem entender.')}</p></div>
    </article>
    <article className="feature-card feature-tone-1 feature-team" data-reveal>
      <div className="feature-visual team-visual" aria-hidden="true"><div className="review-paper"><span className="review-line"><GitBranch size={16} />checkout / v2</span><div className="review-avatars"><i>AM</i><i>JL</i><i>SR</i></div><div className="review-comment"><span>JL</span><div><b>{uiText('E se a fila estiver indisponível?')}</b><small>{uiText('Comentário no componente Kafka')}</small></div></div><div className="review-reply"><Check size={14} />{uiText('Decisão registrada no diagrama')}</div></div></div>
      <div className="feature-copy"><span className="feature-eyebrow"><Users size={15} />02 / {uiText('Converse')}</span><h3>{uiText('Colaboração em equipe')}</h3><p>{uiText('Converse sobre a arquitetura onde ela está. Comentários e versões preservam cada decisão.')}</p></div>
    </article>
    <article className="feature-card feature-tone-2 feature-docs" data-reveal>
      <div className="feature-visual docs-visual" aria-hidden="true"><div className="doc-paper"><span><FileText size={14} />ADR-003</span><b>{uiText('Por que usamos eventos')}</b><i /><i /><i /><span className="doc-tag"><GitBranch size={12} />{uiText('Vinculado a Kafka')}</span></div><div className="doc-link"><Workflow size={22} /><b>Kafka</b><span>↗ ADR-003</span></div></div>
      <div className="feature-copy"><span className="feature-eyebrow"><FileText size={15} />03 / {uiText('Documente')}</span><h3>{uiText('Documentação viva')}</h3><p>{uiText('O desenho mostra como funciona. Os documentos explicam por quê. Mantenha os dois conectados.')}</p></div>
    </article>
    <article className="feature-card feature-tone-3 feature-build" data-reveal>
      <div className="feature-visual build-visual"><div className="component-picker" role="group" aria-label={uiText('Experimente os componentes')}>{components.map(({ icon: Icon, label }, i) => <button key={label} aria-label={uiText('Prévia de {0}', [label])} aria-pressed={component === i} onClick={() => setComponent(i)}><Icon size={23} /><span>{label}</span></button>)}</div><span className="component-connector" aria-hidden /><div className="component-result" key={component}><Component size={27} /><strong>{components[component]!.label}</strong><small>{uiText('Seu próximo componente')}</small></div></div>
      <div className="feature-copy"><span className="feature-eyebrow"><Blocks size={15} />04 / {uiText('Expanda')}</span><h3>{uiText('Flexível e extensível')}</h3><p>{uiText('Comece com um template. Combine componentes e adapte o workspace ao seu jeito de construir.')}</p></div>
    </article>
  </div>;
}
