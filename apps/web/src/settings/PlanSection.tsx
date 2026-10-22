import { useAccessPlan } from './accessPlan';
import { isBrowserPreview } from './publicAccess';
import { Check, FlaskConical, Folder, Network, Users } from 'lucide-react';
import { uiText } from '../i18n';
import { useCatalog } from '../workspace/catalog';
import { useWorkspace } from '../workspace/appWorkspace';
import { collaborationSession } from '../workspace/boot';
import { useBetaUsage } from './betaUsage';

export function PlanSection() {
  const { plan, accountPlan } = useAccessPlan();
  const preview = isBrowserPreview();
  const localWorkspaces = useCatalog(s => s.catalog?.entries.length ?? 0);
  const diagrams = useWorkspace(s => s.data?.manifest.diagrams.length ?? 0);
  const { usage, unavailable } = useBetaUsage();
  const session = collaborationSession();
  const shared = session?.mode === 'lan' && !session.owner;
  const remote = !!session && !session.owner;
  const workspaces = usage?.scope === 'account' ? usage.ownedWorkspaces ?? 0 : remote ? null : localWorkspaces;
  const rows = [
    { label: uiText('Workspaces próprios'), value: shared ? null : workspaces, limit: accountPlan.limits.workspaces, icon: Folder },
    { label: uiText('Diagramas neste workspace'), value: diagrams, limit: plan.limits.diagrams, icon: Network },
    { label: uiText('Pessoas simultâneas'), value: unavailable ? null : usage?.participants ?? (session ? null : 1), limit: plan.limits.participants, icon: Users },
  ];
  return <section className="flex flex-col gap-6" aria-label={uiText('Plano e uso')}>
    <div className="rounded-2xl border border-accent/25 bg-accent-soft p-5">
      <div className="flex items-center gap-3"><FlaskConical size={23} className="text-accent" /><h3 className="text-xl font-semibold">{plan.name}</h3><span className="ml-auto rounded-full border border-accent/30 px-3 py-1 text-caption text-accent">{uiText(plan.id === 'self-hosted' ? 'Instalação própria' : accountPlan.id === 'administrator' ? 'Administrador' : plan.id === 'administrator' ? 'Workspace sem cotas' : 'Gratuito')}</span></div>
      <p className="mt-3 text-body leading-relaxed text-muted">{uiText(preview ? 'Editor e documentação liberados' : plan.id === 'self-hosted' ? 'Sem cotas comerciais de workspaces, diagramas ou participantes. A capacidade depende da sua infraestrutura; permissões e limites de segurança continuam ativos.' : plan.id === 'administrator' ? accountPlan.id === 'administrator' ? 'Acesso de administrador: sem cotas de workspaces, diagramas ou participantes nos seus workspaces.' : 'Este workspace tem diagramas e participantes sem limite de plano. Sua cota pessoal de workspaces permanece igual.' : 'Todos os recursos essenciais para testar, construir e colaborar. Sem cobrança durante o beta.')}</p>
      {preview && <p className="mt-3 text-body leading-relaxed text-muted">{uiText('Nesta prévia, seus dados ficam neste navegador. Contas, sincronização online, IA e colaboração ainda não estão disponíveis.')}</p>}
    </div>
    <div className="grid gap-4">
      {rows.map(({ label, value, limit, icon: Icon }) => <div key={label} className="rounded-xl border border-line bg-panel-2/40 p-4">
        <div className="flex items-center gap-2 text-body"><Icon size={17} className="text-muted" /><span>{label}</span><strong className="ml-auto tabular-nums">{value ?? '—'} / {limit ?? uiText('Sem limite')}</strong></div>
        {limit !== null && <progress aria-label={label} className="mt-3 h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent" max={limit} value={Math.min(value ?? 0, limit)} />}
        {limit !== null && value !== null && value >= limit && <p className="mt-2 text-caption text-muted">{uiText('Limite atingido. Seu conteúdo continua disponível para editar e exportar.')}</p>}
      </div>)}
    </div>
    <p className="text-caption leading-relaxed text-muted">{preview ? uiText('Seu primeiro workspace está liberado sem conta e fica salvo neste navegador.') : plan.id === 'self-hosted' ? uiText('Esta instalação usa infraestrutura própria. A capacidade e a manutenção dependem de quem hospeda.') : shared ? uiText('Você participa de um workspace compartilhado. Isso não usa sua cota de workspace próprio.') : !remote ? uiText('No modo local, a cota de workspaces vale para este navegador. No acesso remoto, ela acompanha sua conta GitHub.') : uiText('A cota de workspaces próprios acompanha sua conta. Participar de outros workspaces não consome essa cota.')}</p>
    {unavailable && <p role="status" className="text-caption text-muted">{uiText('Não foi possível atualizar o uso no servidor. Tentaremos novamente em instantes.')}</p>}
    <div className="grid gap-3 border-t border-line pt-5 text-body">
      {(preview ? ['Editor e documentação liberados', 'Exportação e versões incluídas'] : ['Editor e documentação liberados', 'Exportação e versões incluídas', 'IA com sua própria chave', plan.limits.participants === null ? 'Participantes sem limite de plano' : 'Até {0} pessoas, incluindo quem compartilhou']).map(text => <p key={text} className="flex items-center gap-2"><Check size={15} className="shrink-0 text-accent" />{uiText(text, [plan.limits.participants ?? '∞'])}</p>)}
    </div>
    <a className="text-caption text-accent underline" href="https://github.com/MarcoPeixot/joinlet" target="_blank" rel="noopener noreferrer">{uiText('Código-fonte e licença AGPL-3.0')}</a>
  </section>;
}
