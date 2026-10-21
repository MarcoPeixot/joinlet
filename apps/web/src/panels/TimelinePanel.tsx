import { uiText } from '../i18n';
import { buildTimeline, nextGoal } from '@strukt/workspace';
import type { TimelinePoint, VersionStage } from '@strukt/workspace';
import { CalendarPlus, GitCommitHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { DiffMark } from '../diagram/toFlow';
import { goalDate, goalLabel, pastLabel } from '../timeline/labels';
import { timelineStore, useTimeline } from '../timeline/session';
import type { TimelineResult } from '../timeline/timelineStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PanelHeader, SidePanel } from '../ui/Panel';
import { closeRightPanel } from '../ui/uiStore';
import { formatVersionDate, versionTitle } from '../versions/labels';
import { openPlanFuture, useVersions, versionStore } from '../versions/session';
import { useWorkspace } from '../workspace/appWorkspace';
import { PlanFutureDialog } from './PlanFutureDialog';

const SIGN: Record<DiffMark, string> = { added: "+", removed: '−', changed: '~' };
const STAGE_TEXT: Record<VersionStage, string> = { atual: uiText("Atual"), 'transição': uiText("Transição"), planejado: uiText("Planejado") };
const STAGE_TONE: Record<VersionStage, string> = {
  atual: 'border-line text-muted',
  'transição': 'border-warning/50 text-warning',
  planejado: 'border-accent/50 text-accent',
};
const DOT_TONE: Record<VersionStage, string> = {
  atual: 'border-faint bg-panel',
  'transição': 'border-warning border-dashed bg-panel',
  planejado: 'border-accent border-dashed bg-panel',
};

const titleOf = (point: TimelinePoint) => (point.kind === 'today' ? uiText("Hoje") : versionTitle(point.entry!.version));

/** What a point says under its title: when it was saved, or the goal and how far away it is. */
function whenOf(point: TimelinePoint): string {
  if (point.kind === 'today') return uiText("O diagrama aberto agora");
  const { version } = point.entry!;
  if (point.stage === 'atual') return `${formatVersionDate(version.createdAt)} · ${pastLabel(point.days ?? 0)}`;
  return point.date ? uiText("Meta {0} · {1}", [goalDate(point.date), goalLabel(point.days)]) : uiText("Sem meta · salvo em {0}", [formatVersionDate(version.createdAt)]);
}

function Row({ point, selected, tag, onToggle, liRef }: { point: TimelinePoint; selected: boolean; tag: string | null; onToggle: () => void; liRef?: RefObject<HTMLLIElement | null> }) {
  const today = point.kind === 'today';
  return (
    <li ref={liRef} className="relative">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={`relative flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--sk-motion-fast) ${selected ? 'border border-accent/40 bg-accent-soft' : 'border border-transparent hover:bg-panel-2'}`}
      >
        <span aria-hidden className={`relative z-10 mt-1 h-3 w-3 flex-none rounded-full border-2 ${today ? 'border-accent bg-accent' : DOT_TONE[point.stage]}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-body ${today ? 'font-semibold' : ''}`}>{titleOf(point)}</span>
            {!today && <span className={`flex-none rounded-chip border px-1.5 text-meta ${STAGE_TONE[point.stage]}`}>{STAGE_TEXT[point.stage]}</span>}
            {tag && <span className="flex-none rounded-chip bg-accent px-1.5 text-meta text-accent-ink">{tag}</span>}
          </span>
          <span className={`text-meta ${point.overdue ? 'text-warning' : 'text-muted'}`}>{whenOf(point)}</span>
        </span>
      </button>
    </li>
  );
}

function ResultCard({ result }: { result: TimelineResult }) {
  const { from, to, diff, summary, goal, applicable } = result;
  const store = timelineStore.getState();
  const several = applicable.length > 1;
  return (
    <section aria-label={uiText("Comparação")} className="flex flex-col gap-2.5 rounded-control border border-accent/30 bg-accent-soft p-3">
      <p className="text-caption leading-relaxed">{uiText("De")} <strong className="font-semibold">{titleOf(from)}</strong> {uiText("até")} <strong className="font-semibold">{titleOf(to)}</strong>
      </p>
      {goal && (
        <p className="text-meta text-muted">{uiText("Meta")} {goalDate(goal.date)} {"·"} {goalLabel(goal.days)}
        </p>
      )}
      <p className="text-caption font-medium">{summary}</p>
      <p className="text-meta leading-relaxed text-muted">{uiText("No canvas: verde entra, vermelho tracejado sai, âmbar muda.")}</p>
      {diff.lines.length > 0 && (
        <ul aria-label={uiText("Mudanças")} className="flex max-h-48 flex-col gap-0.5 overflow-y-auto font-mono text-meta">
          {diff.lines.map((line, i) => (
            <li key={`${line.kind}:${line.text}:${i}`} style={{ color: `var(--sk-diff-${line.kind})` }}>
              {SIGN[line.kind]} {line.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1.5">
        {applicable.map((point) => (
          <Button key={point.key} variant="primary" disabled={diff.unchanged && applicable.length === 1 && (from.kind === 'today' || to.kind === 'today')} onClick={() => void store.apply(point.key)}>
            {several ? uiText("Aplicar este estado · {0}", [titleOf(point)]) : uiText("Aplicar este estado")}
          </Button>
        ))}
        <Button onClick={store.stop}>{uiText("Limpar seleção")}</Button>
      </div>
    </section>
  );
}

/** "Linha do tempo" of the open diagram: past versions → hoje → planned states by goal; two points show their diff on the canvas. */
export function TimelinePanel() {
  const slug = useWorkspace((s) => s.diagram);
  const status = useVersions((s) => s.status);
  const entries = useVersions((s) => s.entries);
  const selected = useTimeline((s) => s.selected);
  const result = useTimeline((s) => s.result);
  const busy = useTimeline((s) => s.busy);
  const timeline = useMemo(() => buildTimeline(entries, new Date()), [entries]);
  const goal = nextGoal(timeline);
  const todayRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    void versionStore.getState().refresh();
  }, [slug]);
  const loaded = status === 'idle';
  useEffect(() => {
    if (loaded) todayRef.current?.scrollIntoView?.({ block: 'center' });
  }, [loaded, slug]);
  const tags = new Map<string, string>();
  if (result) {
    tags.set(result.from.key, uiText("De"));
    tags.set(result.to.key, uiText("Para"));
  }
  const store = timelineStore.getState();
  const versionsCount = timeline.points.length - 1;
  return (
    <>
      <SidePanel label={uiText("Linha do tempo")}>
        <PanelHeader
          icon={<GitCommitHorizontal size={14} />}
          title={uiText("Linha do tempo")}
          subtitle={versionsCount ? `${versionsCount} ${versionsCount === 1 ? uiText("estado salvo") : uiText("estados salvos")}` : undefined}
          onClose={() => closeRightPanel('timeline')}
          closeLabel={uiText("Fechar linha do tempo")}
        />
        <div className="flex flex-col gap-2 border-b border-line p-3">
          <Button variant="primary" icon={<CalendarPlus size={14} />} onClick={openPlanFuture}>{uiText("Planejar estado futuro")}</Button>
          {goal && (
            <button type="button" className="text-left text-meta text-muted hover:text-ink" onClick={() => void store.toggle(goal.key)}>{uiText("Próxima meta:")} <strong className="font-semibold text-ink">{titleOf(goal)}</strong> {"·"} {goalDate(goal.date!)} {"·"} {goalLabel(goal.days)}
            </button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
          {busy && <p className="px-2 text-caption text-muted">{uiText("Montando a comparação…")}</p>}
          {result && <ResultCard result={result} />}
          {!result && !busy && versionsCount > 0 && <p className="px-2 text-meta leading-relaxed text-muted">{uiText("Escolha um ponto para ver o que muda até ele a partir de hoje, ou dois pontos para comparar entre eles.")}</p>}
          {status === 'loading' && <p className="px-2 text-caption text-muted">{uiText("Carregando versões…")}</p>}
          {loaded && versionsCount === 0 && (
            <EmptyState
              illustration="versions"
              title={uiText("Nenhum estado salvo ainda")}
              text={uiText("Salve versões do diagrama atual e planeje estados futuros com uma meta: a régua mostra o caminho até lá.")}
              action={{ label: uiText("Planejar estado futuro"), icon: <CalendarPlus size={14} />, onClick: openPlanFuture }}
            />
          )}
          {versionsCount > 0 && (
            <div className="relative">
              <span aria-hidden className="absolute bottom-3 left-[14px] top-3 w-0.5 rounded-full bg-line-strong" />
              <ol aria-label={uiText("Régua do tempo")} className="relative flex flex-col gap-0.5">
                {timeline.points.map((point) => (
                  <Row key={point.key} point={point} selected={selected.includes(point.key)} tag={tags.get(point.key) ?? null} onToggle={() => void store.toggle(point.key)} liRef={point.kind === 'today' ? todayRef : undefined} />
                ))}
              </ol>
            </div>
          )}
        </div>
      </SidePanel>
      <PlanFutureDialog />
    </>
  );
}
