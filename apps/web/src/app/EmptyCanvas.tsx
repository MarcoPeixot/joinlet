import { uiText } from '../i18n';
import { ArrowUp, CodeXml, FileInput, LayoutTemplate, Square } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { localizedTemplates as TEMPLATES } from '../i18n/templates';
import { addNodeAt } from '../actions/elements';
import { applyTemplate, openTemplateGallery } from '../actions/templates';
import { startCardShown } from '../onboarding/useFirstRun';
import { useDiagram } from '../state/appStore';
import { Keys } from '../ui/Kbd';
import { POP } from '../ui/motion';
import { uiStore } from '../ui/uiStore';
import { pickStartTemplates, startFromPrompt } from './startTemplates';
import { TemplatePreview } from './TemplatePreview';
import { openSettings } from '../settings/store';

const START = pickStartTemplates(TEMPLATES, 4, ['microservices', 'rag', 'c4-context', 'event-driven']);

function Shortcut({ icon, title, shortcut, onClick }: { icon: ReactNode; title: string; shortcut?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={onClick}
      className="group flex items-center gap-2 rounded-control border border-line bg-panel-2/60 px-3 py-2 text-caption font-medium transition-[background-color,border-color,transform] duration-(--sk-motion-fast) hover:border-line-strong hover:bg-panel-2 active:scale-[0.98]"
    >
      <span className="text-muted transition-colors group-hover:text-accent">{icon}</span>
      {title}
      {shortcut && <Keys combo={shortcut} className="pointer-coarse:hidden" />}
    </button>
  );
}

/** A diagram with nothing in it: describe it to the AI, pick a model, or start blank/code/import. Disappears with the first element. */
export function EmptyCanvas({ center }: { center: () => { x: number; y: number } }) {
  const empty = useDiagram(startCardShown);
  const [text, setText] = useState('');
  const send = () => { if (startFromPrompt(text)) setText(''); };
  return (
    <AnimatePresence>
      {empty && (
        <m.div key="empty" className="pointer-events-none absolute inset-0 z-10 flex justify-center overflow-y-auto pb-20 pt-[calc(var(--sk-header-height)+64px)]" {...POP}>
          <div className="pointer-events-auto m-auto flex w-[min(620px,calc(100%-32px))] flex-col gap-6 p-3 sm:p-6">
            <div className="flex flex-col items-start gap-3">
              <img src="/brand/jo-connected-v2.webp" width="1536" height="1024" alt="" className="h-24 w-36 object-contain" />
              <div className="flex flex-col gap-2">
                <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.035em]">{uiText("Descreva sua arquitetura")}</h2>
                <p className="max-w-md text-body leading-relaxed text-muted">{uiText("Comece com um modelo, desenhe no canvas ou gere um rascunho com IA.")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <form className="sk-focus-glow relative rounded-panel border border-line-strong bg-panel shadow-panel" onSubmit={(event) => { event.preventDefault(); send(); }}>
                <textarea
                  aria-label={uiText("Descreva o sistema")}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}
                  placeholder={uiText("Ex.: app web com API, fila de eventos e banco de dados")}
                  rows={3}
                  className="w-full resize-none rounded-panel bg-transparent p-3 pr-12 text-body outline-none placeholder:text-faint"
                />
                <button
                  type="submit"
                  aria-label={uiText("Gerar com IA")}
                  disabled={!text.trim()}
                  className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-control bg-accent-strong text-accent-ink transition-[filter,opacity] duration-(--sk-motion-fast) hover:brightness-110 disabled:opacity-40"
                >
                  <ArrowUp size={16} strokeWidth={2.25} />
                </button>
              </form>
              <p className="text-caption text-faint">{uiText("A IA requer um provedor conectado.")} <button type="button" onClick={() => openSettings('ai')} className="rounded-chip text-accent underline-offset-4 hover:underline">{uiText("Configurar IA")}</button></p>
            </div>
            {START.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-caption font-medium text-muted">{uiText("Começar com um modelo")}</p>
                <div role="group" aria-label={uiText("Modelos")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {START.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      aria-label={template.title}
                      onClick={() => void applyTemplate(template)}
                      className="group overflow-hidden rounded-control border border-line bg-panel text-left transition-[border-color,box-shadow] duration-(--sk-motion-fast) hover:border-accent hover:shadow-panel"
                    >
                      <TemplatePreview template={template} />
                      <span className="block truncate px-2 py-1.5 text-caption font-medium">{template.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Shortcut icon={<Square size={15} />} title={uiText("Adicionar nó")} shortcut="N" onClick={() => addNodeAt(center(), 'shape')} />
              <Shortcut icon={<CodeXml size={15} />} title={uiText("Escrever ou colar código")} onClick={() => uiStore.setState({ codeOpen: true })} />
              <Shortcut icon={<FileInput size={15} />} title={uiText("Importar")} onClick={() => uiStore.setState({ codeOpen: true })} />
              <Shortcut icon={<LayoutTemplate size={15} />} title={uiText("Explorar modelos")} onClick={openTemplateGallery} />
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
