import { LanguagePicker } from '../i18n/LanguagePicker';
import { uiText } from '../i18n';
import { Check, CheckCircle2, Circle, CircleAlert, FolderGit2, LoaderCircle, Search, XCircle } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Keys } from '../ui/Kbd';
import { Segmented, inputClass } from '../ui/controls';
import { Switch } from '../ui/Switch';
import { ACCENTS, ACCENT_LABEL, ACCENT_SWATCH } from '../ui/accent';
import { setAccent, setFlowAnimation, setMinimap, setReduceMotion, setSidebarOpen, setTheme, useUi } from '../ui/uiStore';
import { settingsApi } from './client';
import type { GitRepoInfo } from './client';
import { filterShortcuts } from './shortcuts';

/** A titled card of settings inside a section. */
export function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="sk-label">{title}</h3>
      {description && <p className="text-caption text-muted">{description}</p>}
      <div className="mt-2 flex flex-col divide-y divide-line rounded-[12px] border border-line bg-panel-2/40 px-4">{children}</div>
    </section>
  );
}

export function GeneralSection() {
  const themePref = useUi((s) => s.themePref);
  const accent = useUi((s) => s.accent);
  const reduceMotion = useUi((s) => s.reduceMotion);
  const flow = useUi((s) => s.flowAnimation);
  const minimap = useUi((s) => s.minimap);
  const sidebar = useUi((s) => s.sidebarOpen);
  return (
    <div className="flex flex-col gap-7">
      <Group title={uiText("Idioma")} description={uiText("Português (Brasil) e inglês em todo o Joinlet.")}><div className="py-3"><LanguagePicker /></div></Group>
      <Group title={uiText("Aparência")}>
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body font-medium">{uiText("Tema")}</span>
            <span className="text-caption text-muted">{uiText("O canvas, os painéis e o export seguem o tema. Automático acompanha o sistema; Alto contraste usa a base escura.")}</span>
          </div>
          <div className="w-full sm:w-[27rem] sm:max-w-[62%]">
            <div role="group" aria-label={uiText("Aparência do tema")}>
              <Segmented
                value={themePref}
                options={[
                  { value: 'system', label: uiText("Automático") },
                  { value: 'light', label: uiText("Claro") },
                  { value: 'dark', label: uiText("Escuro") },
                  { value: 'contrast', label: uiText("Alto contraste") },
                ]}
                onChange={setTheme}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body font-medium">{uiText("Cor de destaque")}</span>
            <span className="text-caption text-muted">{uiText("Seleção, foco e botões principais. Alto contraste mantém a sua própria cor.")}</span>
          </div>
          <div className="w-full sm:w-[27rem] sm:max-w-[62%]">
            <div role="group" aria-label={uiText("Cor de destaque")}>
              <div className="sk-accent-picker">{ACCENTS.map(value => <button key={value} type="button" aria-pressed={accent === value} onClick={() => setAccent(value)} className="sk-accent-option"><span className="sk-accent-swatch" style={{ background: ACCENT_SWATCH[value] }} aria-hidden>{accent === value && <Check size={14} strokeWidth={2.5} />}</span><span>{ACCENT_LABEL[value]}</span>{accent === value && <span className="sk-accent-selected" aria-hidden />}</button>)}</div>
            </div>
          </div>
        </div>
      </Group>
      <Group title={uiText("Movimento")}>
        <Switch label={uiText("Reduzir movimento")} description={uiText("Painéis e cartões aparecem sem deslizar; o fluxo animado some. O sistema também pode pedir isso.")} checked={reduceMotion} onChange={setReduceMotion} />
        <Switch label={uiText("Animar fluxo nas conexões")} description={uiText("As requisições percorrem as conexões como barras. Ao clicar num nó, as dele animam de qualquer jeito.")} checked={flow} onChange={setFlowAnimation} />
      </Group>
      <Group title="Canvas">
        <Switch label={uiText("Mostrar minimapa")} description={uiText("No canto inferior esquerdo, acima do zoom.")} checked={minimap} onChange={setMinimap} />
        <Switch label={uiText("Mostrar barra lateral")} description={uiText("Diagramas, documentos e sketches do workspace (⌘\\).")} checked={sidebar} onChange={setSidebarOpen} />
      </Group>
    </div>
  );
}

export function ShortcutsSection() {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => filterShortcuts(query), [query]);
  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input aria-label={uiText("Buscar atalhos")} className={`${inputClass} h-9 pl-9`} placeholder={uiText("Buscar atalho…")} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {groups.length === 0 && <p className="py-8 text-center text-body text-muted">{uiText("Nenhum atalho para “")}{query}”.</p>}
      {groups.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.items.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-body">{item.label}</span>
              <Keys combo={item.keys} />
            </div>
          ))}
        </Group>
      ))}
    </div>
  );
}

/** Same key as the GitHub panel keeps its folder in (github/store.ts on feat/m6-fluxos). */
const REPO_KEY = 'strukt:repo';

function readRepo(): string {
  try {
    return globalThis.localStorage?.getItem(REPO_KEY) ?? '';
  } catch {
    return '';
  }
}

type GitCheck = { state: 'idle' } | { state: 'running' } | { state: 'ok'; repo: GitRepoInfo; changes: number } | { state: 'error'; error: string; unavailable: boolean };

export function GithubSection() {
  const [dir, setDir] = useState(readRepo);
  const [check, setCheck] = useState<GitCheck>({ state: 'idle' });
  const verify = async () => {
    const path = dir.trim();
    try {
      globalThis.localStorage?.setItem(REPO_KEY, path);
    } catch {
      // still checked for this session
    }
    setCheck({ state: 'running' });
    const res = await settingsApi.git(path);
    setCheck(res.ok ? { state: 'ok', repo: res.value.repo, changes: res.value.changes.length } : { state: 'error', error: res.error, unavailable: res.status === 404 });
  };
  return (
    <div className="flex flex-col gap-7">
      <Group title={uiText("Repositório")} description={uiText("O navegador não enxerga o caminho da pasta: informe onde está o repositório com o .arch/. O servidor local roda git e gh só nessa pasta.")}>
        <form
          className="flex items-center gap-2 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <input aria-label={uiText("Pasta do repositório")} className={`${inputClass} h-9 flex-1 font-mono text-caption`} placeholder={uiText('/Users/voce/projetos/meu-app')} value={dir} onChange={(event) => setDir(event.target.value)} />
          <Button type="submit" variant="primary" disabled={!dir.trim() || check.state === 'running'} icon={check.state === 'running' ? <LoaderCircle size={14} className="animate-spin" /> : <FolderGit2 size={14} />}>{uiText("Verificar")}</Button>
        </form>
      </Group>
      <AnimatePresence mode="wait">
        {check.state === 'ok' && (
          <m.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Group title="Status">
              <StatusRow label={uiText("Repositório")} value={check.repo.nameWithOwner ?? check.repo.root} />
              <StatusRow label={"Branch"} value={check.repo.branch} />
              <StatusRow label={uiText("Base padrão")} value={check.repo.defaultBase ?? '—'} />
              <StatusRow label={uiText("Conta GitHub")} value={check.repo.ghReady ? uiText("pronta para publicar") : uiText("não conectada — abra GitHub no topo")} ok={check.repo.ghReady} />
              <StatusRow label={uiText("Mudanças no .arch/")} value={check.changes ? uiText("{0} pendente{1}", [check.changes, check.changes === 1 ? '' : 's']) : uiText("nenhuma")} />
            </Group>
          </m.div>
        )}
        {check.state === 'error' && (
          <m.p key="error" className="flex items-start gap-2 rounded-[12px] border border-line bg-panel-2/40 p-4 text-body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CircleAlert size={16} className={`mt-0.5 flex-none ${check.unavailable ? 'text-muted' : 'text-danger'}`} />
            <span className={check.unavailable ? 'text-muted' : 'text-danger'}>{check.unavailable ? uiText("Integração GitHub indisponível neste servidor.") : check.error}</span>
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const Icon = ok === undefined ? Circle : ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon size={14} className={ok === undefined ? 'text-faint' : ok ? 'text-(--sk-diff-added)' : 'text-danger'} />
      <span className="w-40 text-caption text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-caption">{value}</span>
    </div>
  );
}
