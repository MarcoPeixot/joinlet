import {CloudAccount} from './CloudAccount';
import { PlanSection } from './PlanSection';
import { uiText } from '../i18n';
import { Building2, FlaskConical, GitBranch, Keyboard, Plug, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { Suspense } from 'react';
import type { ComponentType } from 'react';
import { IconButton } from '../ui/IconButton';
import { Logo } from '../ui/Logo';
import { documentationUrl } from '../ui/documentation';
import { Modal } from '../ui/Modal';
import { EASE_OUT, GLIDE } from '../ui/motion';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { useIsMobile } from '../ui/useBreakpoint';
import { WorkspaceSection } from './WorkspaceSection';
import { AiSection } from './AiSection';
import { GeneralSection, GithubSection, ShortcutsSection } from './sections';
import './settings.css';
import { closeSettings, settingsStore, useSettings } from './store';
import type { SettingsSection } from './store';

const LazyIntegrations = lazyWithRetry(() => import('./IntegrationsSection').then((m) => ({ default: m.IntegrationsSection })));

/** Integrações loads on demand (webhooks, Notion, Atlassian): the initial bundle does not carry it. */
function IntegrationsBody() {
  return (
    <ChunkBoundary>
      <Suspense fallback={<p className="text-caption text-muted">{uiText("Carregando…")}</p>}>
        <LazyIntegrations />
      </Suspense>
    </ChunkBoundary>
  );
}

const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: ComponentType<{ size?: number }>; body: ComponentType }[] = [
  { id: 'general', label: uiText("Geral"), hint: uiText("Tema, movimento e canvas"), icon: SlidersHorizontal, body: GeneralSection },
  { id: 'plan', label: uiText('Plano e uso'), hint: uiText('Política e uso desta instalação'), icon: FlaskConical, body: PlanSection },
  { id: 'workspace', label: 'Workspace', hint: uiText('Nome, logo e descrição do seu workspace'), icon: Building2, body: WorkspaceSection },
  { id: 'ai', label: uiText("IA e providers"), hint: uiText("Gemini, DeepSeek, Groq, Mistral e outras conexões"), icon: Sparkles, body: AiSection },
  { id: 'integrations', label: uiText("Integrações"), hint: uiText("Slack, Teams, Discord, Notion, Confluence e Jira"), icon: Plug, body: IntegrationsBody },
  { id: 'shortcuts', label: uiText("Atalhos"), hint: uiText("Todos os atalhos de teclado"), icon: Keyboard, body: ShortcutsSection },
  { id: 'github', label: "GitHub", hint: uiText("Repositório e publicação"), icon: GitBranch, body: GithubSection },
];

/** Configurações (⌘,): a navigation rail on the left, the chosen section on the right. */
export function SettingsModal() {
  const open = useSettings((s) => s.open);
  const section = useSettings((s) => s.section);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const Body = current.body;
  const mobile = useIsMobile();
  const items = SECTIONS.map((s) => {
    const active = s.id === section;
    const Icon = s.icon;
    return (
      <button
        key={s.id}
        type="button"
        role={mobile ? 'tab' : undefined}
        aria-selected={mobile ? active : undefined}
        aria-current={!mobile && active ? 'page' : undefined}
        onClick={() => settingsStore.setState({ section: s.id })}
        className={`relative flex shrink-0 items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--sk-motion-fast) pointer-coarse:min-h-10 ${active ? 'text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'}`}
      >
        {active && <m.span layoutId="settings-nav" transition={GLIDE} className="absolute inset-0 rounded-control bg-accent-soft" />}
        <span className={`relative flex ${active ? 'text-accent' : ''}`}>
          <Icon size={15} />
        </span>
        <span className="relative whitespace-nowrap text-body font-medium">{s.label}</span>
      </button>
    );
  });
  return (
    <Modal open={open} onClose={closeSettings} label={uiText("Configurações")} width={1040} bare className="sk-settings h-[min(760px,calc(100dvh-48px))]">
      <div className="flex min-h-0 flex-1">
        {!mobile && (
          <nav aria-label={uiText("Seções das configurações")} className="flex w-52 flex-none flex-col gap-1 bg-bg p-4">
            <div className="flex items-center gap-2 px-2 pb-3 pt-1">
              <Logo size={20} />
              <span className="text-title font-semibold">{uiText("Configurações")}</span>
            </div>
            {items}
            <p className="mt-auto px-2 text-meta text-faint">{uiText("Abra com")} <kbd>⌘</kbd> <kbd>,</kbd>
            </p>
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-20 shrink-0 items-center gap-3 pl-5 pr-4 sm:pl-8">
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="text-heading font-semibold">{current.label}</h2>
              <p className="text-caption text-muted">{current.hint}</p>
              <a className="text-caption text-accent underline underline-offset-2" href={documentationUrl()} target="_blank" rel="noopener noreferrer">{uiText('Documentação')} ↗</a>
            </div>
            <IconButton label={uiText("Fechar configurações")} onClick={closeSettings}>
              <X />
            </IconButton>
          </div>
          {mobile && (
            <div role="tablist" aria-label={uiText("Seções das configurações")} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-bg p-2">
              {items}
            </div>
          )}
          <div data-testid="settings-content" className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={section}
                className="px-5 pb-7 pt-2 sm:px-8 sm:pb-8"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              >
                <CloudAccount />
                <Body />
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Modal>
  );
}
