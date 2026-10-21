import { uiText } from '../i18n';
import type { DiffMark } from '../diagram/toFlow';
import { Check, History, Save, Sparkles, User } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Keys } from '../ui/Kbd';
import { PanelHeader, SidePanel } from '../ui/Panel';
import { GLIDE } from '../ui/motion';
import { createJustSaved } from '../versions/justSaved';
import { formatVersionDate, versionTitle } from '../versions/labels';
import { openSaveVersion, useVersions, versionStore } from '../versions/session';
import type { Comparison } from '../versions/versionStore';
import { STAGE_LABELS } from '@strukt/workspace';
import { goalDate } from '../timeline/labels';
import { useWorkspace } from '../workspace/appWorkspace';

const SIGN: Record<DiffMark, string> = { added: "+", removed: '−', changed: '~' };

function CompareCard({ compare }: { compare: Comparison }) {
  const { version } = compare.entry;
  const store = versionStore.getState();
  return (
    <section aria-label={uiText("Comparação")} className="flex flex-col gap-2.5 rounded-control border border-accent/30 bg-accent-soft p-3">
      <p className="text-caption leading-relaxed">{uiText("Comparando com")} <strong className="font-semibold">{versionTitle(version)}</strong> <span className="text-muted">{"·"} {formatVersionDate(version.createdAt)}</span>
      </p>
      <p className="text-meta leading-relaxed text-muted">{uiText("O canvas mostra o diagrama como ficaria restaurado: verde entra, vermelho tracejado sai, âmbar muda.")}</p>
      {compare.lines.length ? (
        <ul aria-label={uiText("Mudanças")} className="flex max-h-48 flex-col gap-0.5 overflow-y-auto font-mono text-meta">
          {compare.lines.map((line, i) => (
            <li key={`${line.kind}:${line.text}:${i}`} style={{ color: `var(--sk-diff-${line.kind})` }}>
              {SIGN[line.kind]} {line.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption">{compare.plan.unchanged ? uiText("Igual ao diagrama atual.") : uiText("Mesmo conteúdo; só as posições mudam.")}</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Button variant="primary" disabled={compare.plan.unchanged} onClick={() => void store.restore()}>{uiText("Restaurar esta versão")}</Button>
        <Button onClick={store.stopCompare}>{uiText("Sair da comparação")}</Button>
      </div>
    </section>
  );
}

/** True for a moment after a version lands while the panel is open (not for the list loading in). */
function useJustSaved(slug: string | null, status: string, topId: string | undefined): boolean {
  const [saved, setSaved] = useState(false);
  const tracker = useMemo(() => createJustSaved(setSaved, 1600), []);
  useEffect(() => tracker.observe(slug, status, topId), [tracker, slug, status, topId]);
  useEffect(() => tracker.dispose, [tracker]);
  return saved;
}

/** "Salvar versão": right after a version lands the icon becomes a check that draws itself. */
function SaveVersionButton({ saved }: { saved: boolean }) {
  return (
    <Button variant="primary" icon={saved ? <Check size={14} className="sk-check-draw" data-testid="version-saved-check" /> : <Save size={14} />} onClick={openSaveVersion}>
      {saved ? uiText("Versão salva") : <>{uiText("Salvar versão")} <Keys combo="⌘S" className="ml-1 opacity-80" /></>}
    </Button>
  );
}

/** "Versões" of the open diagram (the canvas's right slot while open): save, compare on the canvas, restore. */
export function VersionsPanel() {
  const slug = useWorkspace((s) => s.diagram);
  const status = useVersions((s) => s.status);
  const entries = useVersions((s) => s.entries);
  const compare = useVersions((s) => s.compare);
  const store = versionStore.getState();
  const saved = useJustSaved(slug, status, entries[0]?.path);
  useEffect(() => {
    void versionStore.getState().refresh();
  }, [slug]);
  return (
    <SidePanel label={uiText("Versões")}>
      <PanelHeader
        icon={<History size={14} />}
        title={uiText("Versões")}
        subtitle={entries.length ? `${entries.length} ${entries.length === 1 ? uiText("versão") : uiText("versões")}` : undefined}
        onClose={() => store.setOpen(false)}
        closeLabel={uiText("Fechar versões")}
      />
      {(compare || entries.length > 0) && (
        <div className="flex flex-col gap-3 border-b border-line p-3">
          {compare ? (
            <CompareCard compare={compare} />
          ) : (
            <SaveVersionButton saved={saved} />
          )}
        </div>
      )}
      <ol aria-label={uiText("Lista de versões")} className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {status === 'loading' && <li className="px-2 py-1 text-caption text-muted">{uiText("Carregando versões…")}</li>}
        {status === 'idle' && !entries.length && (
          <li>
            <EmptyState
              illustration="versions"
              title={uiText("Nenhuma versão ainda")}
              text={uiText("Guarde um retrato do diagrama para comparar e voltar atrás. Aceitar uma proposta da IA também cria uma.")}
              action={{ label: uiText("Salvar a primeira versão"), icon: <Save size={14} />, onClick: openSaveVersion }}
            />
          </li>
        )}
        {entries.map((entry, index) => {
          const active = compare?.entry.path === entry.path;
          const ai = entry.version.author === 'ai';
          return (
            <m.li key={entry.path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 8) * 0.025 } }}>
              <button
                type="button"
                aria-pressed={active}
                className={`relative flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--sk-motion-fast) ${active ? 'text-ink' : 'hover:bg-panel-2'}`}
                onClick={() => void (active ? store.stopCompare() : store.startCompare(entry))}
              >
                {active && <m.span layoutId="version-active" transition={GLIDE} className="absolute inset-0 rounded-control border border-accent/40 bg-accent-soft" />}
                <span className={`relative mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${ai ? 'bg-(image:--sk-brand) text-white' : 'bg-panel-3 text-muted'}`}>
                  {ai ? <Sparkles size={11} /> : <User size={11} />}
                </span>
                <span className="relative flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body">{versionTitle(entry.version)}</span>
                  <span className="text-meta text-muted">
                    {formatVersionDate(entry.version.createdAt)} {"·"} {ai ? uiText("IA") : uiText("Você")}
                    {entry.version.stage && ` · ${STAGE_LABELS[entry.version.stage]}${entry.version.target ? uiText(" até {0}", [goalDate(entry.version.target)]) : ''}`}
                  </span>
                </span>
              </button>
            </m.li>
          );
        })}
      </ol>
    </SidePanel>
  );
}
