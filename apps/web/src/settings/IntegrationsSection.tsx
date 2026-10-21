import { IntegrationIcon } from '../integrations/IntegrationIcon';
import type { IntegrationBrand } from '../integrations/IntegrationIcon';
import { uiText } from '../i18n';
import { Check, ExternalLink, KeyRound, LoaderCircle, ServerOff, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { own } from '@strukt/core';
import { integrationsApi, safeLink } from '../integrations/client';
import type { IntegrationsPatch, IntegrationsView, NotifyEvent, TestTarget, WebhookKind } from '../integrations/client';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { Field, Segmented, inputClass } from '../ui/controls';
import { useWorkspace } from '../workspace/appWorkspace';
import { Group } from './sections';

const HOOKS: Record<WebhookKind, { name: string; placeholder: string }> = {
  slack: { name: 'Slack', placeholder: 'https://hooks.slack.com/services/…' },
  teams: { name: 'Microsoft Teams', placeholder: 'https://empresa.webhook.office.com/webhookb2/…' },
  discord: { name: 'Discord', placeholder: 'https://discord.com/api/webhooks/…' },
};

const EVENTS: [NotifyEvent, string, string][] = [
  ['version', uiText("Versão salva pela IA ou por um agente"), uiText("Quando uma proposta da IA é aceita ou um agente (MCP) salva uma versão.")],
  ['pr', uiText("PR de arquitetura publicado"), uiText("Quando \"Publicar\" abre o pull request com as mudanças de .arch/.")],
  ['drift', uiText("Deriva encontrada"), uiText("Quando a verificação de evidências do painel Precisão acha referências quebradas (avisa uma vez por conjunto de achados).")],
];

type Test = { ok: boolean; detail: string } | 'running';

/** Status pill + test button + result line shared by every service. */
function useTest(target: TestTarget) {
  const [result, setResult] = useState<Test | null>(null);
  const run = async () => {
    setResult('running');
    const res = await integrationsApi.test(target);
    setResult(res.ok ? res.value : { ok: false, detail: res.error });
  };
  return { result, run, reset: () => setResult(null) };
}

function Result({ result }: { result: Test | null }) {
  if (!result) return null;
  const running = result === 'running';
  return (
    <p role="status" className={`flex items-start gap-1.5 text-caption ${running ? 'text-muted' : result.ok ? 'text-(--sk-diff-added)' : 'text-danger'}`}>
      {running ? <LoaderCircle size={13} className="mt-0.5 animate-spin" /> : result.ok ? <Check size={13} className="mt-0.5 flex-none" /> : <X size={13} className="mt-0.5 flex-none" />}
      <span>{running ? uiText("Testando…") : result.detail}</span>
    </p>
  );
}

function Pill({ configured, hint }: { configured: boolean; hint?: string | null }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10.5px] text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: configured ? 'var(--sk-diff-added)' : 'var(--sk-faint)' }} />
      {configured ? uiText("Salva neste computador {0}", [hint ?? '']).trim() : uiText("Não configurada")}
    </span>
  );
}

function Card({ title, brand, blurb, status, children }: { title: string; brand: IntegrationBrand; blurb: string; status: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="sk-integration-card flex flex-col gap-3 rounded-[14px] border border-line bg-panel-2/40 p-4">
      <header className="flex items-start gap-3">
        <span className="sk-integration-mark" data-integration-icon={brand}><IntegrationIcon brand={brand} /></span>
        <div className="sk-integration-copy flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="sk-integration-title text-title font-semibold">{title}{brand === 'atlassian' && <span className="sk-integration-submarks"><IntegrationIcon brand="confluence" size={15} /><IntegrationIcon brand="jira" size={15} /></span>}</h3>
          <p className="text-caption leading-relaxed text-muted">{blurb}</p>
        </div>
        {status}
      </header>
      {children}
    </section>
  );
}

function Secret({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input type="password" autoComplete="off" spellCheck={false} className={`${inputClass} h-9 pl-9 font-mono text-caption`} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function Plain({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; mono?: boolean }) {
  return (
    <Field label={label}>
      <input autoComplete="off" spellCheck={false} className={`${inputClass} h-9 ${mono ? 'font-mono text-caption' : ''}`} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

interface CardProps {
  view: IntegrationsView;
  save: (patch: IntegrationsPatch) => Promise<string | null>;
}

function WebhookCard({ kind, view, save }: CardProps & { kind: WebhookKind }) {
  const meta = HOOKS[kind];
  const status = view.webhooks[kind];
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const test = useTest(kind);
  const apply = async (patch: IntegrationsPatch) => {
    setError(null);
    test.reset();
    const failure = await save(patch);
    if (failure) setError(failure);
    return !failure;
  };
  return (
    <Card brand={kind} title={meta.name} blurb={uiText("Avisos no {0} por webhook de entrada. O endereço é um segredo: fica só neste computador.", [meta.name])} status={<Pill configured={status.configured} hint={status.hint} />}>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) void apply({ webhooks: { [kind]: { url } } }).then((ok) => ok && setUrl(''));
        }}
      >
        <div className="flex-1">
          <Secret label={uiText("Endereço do webhook ({0})", [meta.name])} value={url} onChange={setUrl} placeholder={status.configured ? uiText("Substituir o endereço ({0})", [status.hint]) : meta.placeholder} />
        </div>
        <Button type="submit" variant="primary" disabled={!url.trim()}>{uiText("Salvar")}</Button>
      </form>
      {status.configured && (
        <>
          <div className="flex flex-col divide-y divide-line">
            {EVENTS.map(([event, label, description]) => (
              <Switch
                key={event}
                label={label}
                description={description}
                checked={status.events.includes(event)}
                onChange={(on) => void apply({ webhooks: { [kind]: { events: EVENTS.map(([id]) => id).filter((id) => (id === event ? on : status.events.includes(id))) } } })}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void test.run()} disabled={test.result === 'running'}>{uiText("Testar")}</Button>
            <Button variant="danger" onClick={() => void apply({ webhooks: { [kind]: null } })}>{uiText("Remover")}</Button>
          </div>
        </>
      )}
      <Result result={test.result} />
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
    </Card>
  );
}

function NotionCard({ view, save }: CardProps) {
  const status = view.notion;
  const [token, setToken] = useState('');
  const [page, setPage] = useState(status.parentPageId ?? '');
  const [error, setError] = useState<string | null>(null);
  const test = useTest('notion');
  useEffect(() => setPage(status.parentPageId ?? ''), [status.parentPageId]);
  const submit = async () => {
    setError(null);
    test.reset();
    const failure = await save({ notion: { ...(token.trim() ? { token } : {}), ...(page.trim() ? { parentPageId: page } : {}) } });
    if (failure) setError(failure);
    else setToken('');
  };
  return (
    <Card brand="notion" title={"Notion"} blurb={uiText("Publica documentos como página filha da página-mãe. Crie uma integração interna em notion.so/profile/integrations e compartilhe a página-mãe com ela.")} status={<Pill configured={status.configured} hint={status.hint} />}>
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Secret label={uiText("Token da integração")} value={token} onChange={setToken} placeholder={status.configured ? uiText("Substituir o token ({0})", [status.hint]) : 'ntn_…'} />
        <Plain label={uiText("Página-mãe (ID ou link)")} value={page} onChange={setPage} placeholder={uiText('https://www.notion.so/Documentacao-0123456789abcdef0123456789abcdef')} mono />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!token.trim() && page === (status.parentPageId ?? '')}>{uiText("Salvar")}</Button>
          {status.configured && <Button onClick={() => void test.run()} disabled={test.result === 'running'}>{uiText("Testar")}</Button>}
          {status.configured && <Button variant="danger" onClick={() => void save({ notion: null })}>{uiText("Remover")}</Button>}
        </div>
      </form>
      <Result result={test.result} />
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
    </Card>
  );
}

function AtlassianCard({ view, save }: CardProps) {
  const { atlassian, confluence, jira } = view;
  const [site, setSite] = useState(atlassian.site?.replace(/^https:\/\//, '') ?? '');
  const [email, setEmail] = useState(atlassian.email ?? '');
  const [token, setToken] = useState('');
  const [space, setSpace] = useState(confluence.spaceKey ?? '');
  const [parent, setParent] = useState(confluence.parentId ?? '');
  const [project, setProject] = useState(jira.projectKey ?? '');
  const [issueType, setIssueType] = useState(jira.issueType ?? 'Task');
  const [error, setError] = useState<string | null>(null);
  const test = useTest('atlassian');
  const submit = async () => {
    setError(null);
    test.reset();
    const patch: IntegrationsPatch = {
      ...(site.trim() || email.trim() || token.trim() ? { atlassian: { ...(site.trim() ? { site } : {}), ...(email.trim() ? { email } : {}), ...(token.trim() ? { token } : {}) } } : {}),
      ...(space.trim() ? { confluence: { spaceKey: space, parentId: parent.trim() || null } } : {}),
      ...(project.trim() ? { jira: { projectKey: project, issueType: issueType.trim() || 'Task' } } : {}),
    };
    const failure = await save(patch);
    if (failure) setError(failure);
    else setToken('');
  };
  return (
    <Card brand="atlassian"
      title={uiText("Atlassian (Confluence e Jira)")}
      blurb={uiText("Uma conta do Atlassian Cloud serve aos dois: publica documentos no Confluence e cria tarefas no Jira a partir das pendências do painel Precisão. Gere o token em id.atlassian.com/manage-profile/security/api-tokens.")}
      status={<Pill configured={atlassian.configured} hint={atlassian.hint} />}
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Plain label="Site" value={site} onChange={setSite} placeholder={uiText('empresa.atlassian.net')} mono />
        <Plain label={uiText("E-mail da conta")} value={email} onChange={setEmail} placeholder={uiText('voce@empresa.com')} />
        <div className="sm:col-span-2">
          <Secret label={uiText("Token de API")} value={token} onChange={setToken} placeholder={atlassian.configured ? uiText("Substituir o token ({0})", [atlassian.hint]) : uiText("Token de API da Atlassian")} />
        </div>
        <Plain label={uiText("Confluence: chave do espaço")} value={space} onChange={setSpace} placeholder="ENG" mono />
        <Plain label={uiText("Confluence: ID da página-mãe (opcional)")} value={parent} onChange={setParent} placeholder={"123456789"} mono />
        <Plain label={uiText("Jira: chave do projeto")} value={project} onChange={setProject} placeholder="ENG" mono />
        <Plain label={uiText("Jira: tipo de tarefa")} value={issueType} onChange={setIssueType} placeholder="Task" />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" variant="primary">{uiText("Salvar")}</Button>
          {atlassian.configured && <Button onClick={() => void test.run()} disabled={test.result === 'running'}>{uiText("Testar")}</Button>}
          {atlassian.configured && <Button variant="danger" onClick={() => void save({ atlassian: null, confluence: null, jira: null })}>{uiText("Remover")}</Button>}
        </div>
      </form>
      <Result result={test.result} />
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
    </Card>
  );
}

/** Pick a doc (and optionally a diagram) and publish it to Notion or Confluence; the diagram goes along as an SVG attachment. */
function PublishGroup({ view }: { view: IntegrationsView }) {
  const data = useWorkspace((s) => s.data);
  const docs = data?.manifest.docs ?? [];
  const diagrams = data?.manifest.diagrams ?? [];
  const [doc, setDoc] = useState('');
  const [diagram, setDiagram] = useState('');
  const [busy, setBusy] = useState<'notion' | 'confluence' | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; url?: string; warnings?: string[] } | null>(null);
  const chosen = doc || docs[0]?.slug || '';
  const canNotion = view.notion.configured && !!view.notion.parentPageId;
  const canConfluence = view.atlassian.configured && !!view.confluence.spaceKey;
  const title = useMemo(() => docs.find((item) => item.slug === chosen)?.title ?? '', [docs, chosen]);

  const publish = async (target: 'notion' | 'confluence') => {
    if (!data || !chosen) return;
    const markdown = own(data.docs, chosen);
    if (markdown === undefined) return;
    setBusy(target);
    setOutcome(null);
    try {
      const snapshot = diagram ? own(data.diagrams, diagram) : undefined;
      const svg = snapshot && snapshot.model.order.length ? await import('../integrations/diagramSvg').then((m) => m.diagramSvg(snapshot)) : undefined;
      const res = await integrationsApi.publish({ target, title, markdown, ...(svg ? { svg, svgName: `${diagram}.svg` } : {}) });
      setOutcome(res.ok ? { ok: true, message: uiText("Publicado no {0}.", [target === 'notion' ? 'Notion' : 'Confluence']), url: res.value.url, warnings: res.value.warnings } : { ok: false, message: res.error });
    } catch (cause) {
      setOutcome({ ok: false, message: cause instanceof Error ? cause.message : uiText("Não foi possível publicar.") });
    } finally {
      setBusy(null);
    }
  };

  const link = safeLink(outcome?.url);
  return (
    <Group title={uiText("Publicar documentação")} description={uiText("Converte o documento (títulos, listas, código, tabelas) para o Notion ou o Confluence. O diagrama escolhido vai como imagem SVG anexada. Republicar no Confluence atualiza a página de mesmo título; no Notion cria uma nova.")}>
      <div className="flex flex-col gap-3 py-3">
        {docs.length === 0 ? (
          <p className="text-caption text-muted">{uiText("Este workspace ainda não tem documentos. Crie um na barra lateral para publicá-lo.")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={uiText("Documento")}>
              <select className={`${inputClass} h-9`} value={chosen} onChange={(event) => setDoc(event.target.value)}>
                {docs.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
              </select>
            </Field>
            <Field label={uiText("Diagrama anexado")}>
              <select className={`${inputClass} h-9`} value={diagram} onChange={(event) => setDiagram(event.target.value)}>
                <option value="">{uiText("Sem diagrama")}</option>
                {diagrams.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
              </select>
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!canNotion || !chosen || busy !== null} onClick={() => void publish('notion')} icon={busy === 'notion' ? <LoaderCircle size={13} className="animate-spin" /> : <IntegrationIcon brand="notion" size={14} />}>{uiText("Publicar no Notion")}</Button>
          <Button variant="primary" disabled={!canConfluence || !chosen || busy !== null} onClick={() => void publish('confluence')} icon={busy === 'confluence' ? <LoaderCircle size={13} className="animate-spin" /> : <IntegrationIcon brand="confluence" size={14} />}>{uiText("Publicar no Confluence")}</Button>
          {!canNotion && !canConfluence && <span className="text-caption text-muted">{uiText("Configure o Notion (com a página-mãe) ou o Confluence (com o espaço) acima.")}</span>}
        </div>
        {outcome && (
          <div role="status" className={`flex flex-col gap-1 text-caption ${outcome.ok ? 'text-(--sk-diff-added)' : 'text-danger'}`}>
            <span className="flex items-start gap-1.5">{outcome.ok ? <Check size={13} className="mt-0.5 flex-none" /> : <X size={13} className="mt-0.5 flex-none" />}{outcome.message}</span>
            {link && <a className="inline-flex items-center gap-1 text-accent hover:underline" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{uiText("Abrir a página")}</a>}
            {outcome.warnings?.map((warning) => <span key={warning} className="text-muted">{uiText("Aviso:")} {warning}</span>)}
          </div>
        )}
      </div>
    </Group>
  );
}

/** Configurações › Integrações: webhooks, Notion, Atlassian and publishing. Loaded on demand (its own chunk). */
export function IntegrationsSection() {
  const [view, setView] = useState<IntegrationsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'avisos' | 'servicos'>('avisos');
  useEffect(() => {
    let active = true;
    void integrationsApi.get().then((res) => {
      if (!active) return;
      if (res.ok) setView(res.value);
      else setError(res.error);
    });
    return () => { active = false; };
  }, []);
  const save = async (patch: IntegrationsPatch): Promise<string | null> => {
    const res = await integrationsApi.save(patch);
    if (res.ok) setView(res.value);
    return res.ok ? null : res.error;
  };
  if (error) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-[12px] border border-line bg-panel-2/40 p-4 text-body text-muted">
        <ServerOff size={18} className="mt-0.5 flex-none" />
        <p>{error}</p>
      </div>
    );
  }
  if (!view) return <p className="flex items-center gap-2 text-caption text-muted"><LoaderCircle size={14} className="animate-spin" />{uiText("Carregando…")}</p>;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption leading-relaxed text-muted">{uiText("Credenciais e endereços ficam só no servidor local (")}<span className="font-mono">~/.config/strukt/integrations.json</span>{uiText(", permissão 0600) e nunca voltam ao navegador; só as quatro últimas letras aparecem. O servidor só fala com os hosts de cada serviço e não segue redirecionamentos.")}</p>
      <Segmented value={tab} options={[{ value: 'avisos', label: uiText("Avisos (Slack, Teams, Discord)") }, { value: 'servicos', label: uiText("Notion, Confluence e Jira") }]} onChange={setTab} />
      {tab === 'avisos' ? (
        <div className="flex flex-col gap-4">
          {(['slack', 'teams', 'discord'] as const).map((kind) => <WebhookCard key={kind} kind={kind} view={view} save={save} />)}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <NotionCard key={`notion-${view.notion.configured}`} view={view} save={save} />
            <AtlassianCard key={`atlassian-${view.atlassian.configured}`} view={view} save={save} />
          </div>
          <PublishGroup view={view} />
        </>
      )}
    </div>
  );
}
