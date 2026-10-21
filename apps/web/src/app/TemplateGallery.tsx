import {catalogMatches} from '@strukt/core';
import { uiText } from '../i18n';
import { ArrowLeft, ArrowRight, LayoutTemplate, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { localizeTemplate, localizedTemplates } from '../i18n/templates';
import type { DiagramTemplate } from '@strukt/workspace';
import { applyTemplate, closeTemplateGallery, useTemplateGallery } from '../actions/templates';
import { openSaveTemplate } from '../actions/library';
import { useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { showToast, useUi } from '../ui/uiStore';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { TemplatePreview } from './TemplatePreview';

const EMPTY: DiagramTemplate[] = [];

export function TemplateGallery() {
  const open = useTemplateGallery();
  const locals = useWorkspace((state) => state.data?.library?.templates ?? EMPTY);
  const populated = useDiagram((state) => state.model.order.length > 0);
  const view = useWorkspace((state) => state.view.kind);
  const source = useWorkspace((state) => state.source);
  const [search, setSearch] = useState('');
  const [TEMPLATES, setTemplates] = useState<DiagramTemplate[]>(localizedTemplates);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => { if (!open) return; setLoadError(false); let active = true; void import('@strukt/workspace/specialist').then(module => { if(active) setTemplates([...localizedTemplates, ...module.SPECIALIST_TEMPLATES.map(localizeTemplate)]); }).catch(() => { if(active) setLoadError(true); }); return () => {active=false;}; }, [open, loadAttempt]);
  const [category, setCategory] = useState(uiText("Todos"));
  const [selected, setSelected] = useState<DiagramTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const templates = useMemo(() => [...locals, ...TEMPLATES], [locals, TEMPLATES]);
  const categories = useMemo(() => [uiText("Todos"), ...(locals.length ? [uiText("Meus modelos")] : []), ...new Set(TEMPLATES.map((template) => template.category ?? 'Arquitetura'))], [locals, TEMPLATES]);
  const local = (template: DiagramTemplate) => locals.includes(template);
  const filtered = templates.filter((template) => {
    const matchesCategory = category === uiText("Todos") || (category === uiText("Meus modelos") ? local(template) : template.category === category);
    return matchesCategory && catalogMatches(search, template.id, template.title, template.description, template.category, template.keywords);
  });
  useEffect(() => { if (open) { setSelected(null); setBusy(false); setCategory(uiText("Todos")); } }, [open, source]);

  const remove = (template: DiagramTemplate) => {
    const data = workspace.store.getState().data;
    const owner = workspace.storage();
    if (!data?.library) return;
    try {
      workspace.setLibrary({ ...data.library, templates: data.library.templates.filter((entry) => entry.id !== template.id) });
      if (selected === template) setSelected(null);
      showToast(uiText("Modelo removido da biblioteca. Os diagramas criados continuam no workspace."), {
        label: uiText("Desfazer"), run: () => {
          if (workspace.storage() !== owner) return showToast(uiText("Reabra o workspace original para restaurar esse modelo."));
          const current = workspace.store.getState().data?.library;
          try { if (current) workspace.setLibrary({ ...current, templates: [...current.templates.filter((entry) => entry.id !== template.id), template] }); }
          catch (error) { showToast(error instanceof Error ? error.message : uiText("Não foi possível restaurar o modelo.")); }
        },
      });
    } catch (error) { showToast(error instanceof Error ? error.message : uiText("Não foi possível remover o modelo.")); }
  };
  const create = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const applied = await applyTemplate(selected);
    setBusy(false);
    if (applied) closeTemplateGallery();
  };
  return (
    <Modal open={open} onClose={closeTemplateGallery} label={uiText("Modelos de diagramas")} icon={<LayoutTemplate size={18} />} width={1080}>
      <div className="flex min-h-0 flex-col overflow-y-auto">
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <button type="button" onClick={() => setSelected(null)} className="flex w-fit items-center gap-1.5 text-caption text-muted hover:text-ink"><ArrowLeft size={15} /> {uiText("Todos os modelos")}</button>
            <div>
              <span className="text-caption font-medium text-accent">{local(selected) ? uiText("Meu workspace") : selected.category}</span>
              <h2 className="mt-1 text-heading font-semibold">{selected.title}</h2>
              <p className="mt-1 text-body text-muted">{selected.description}</p>
            </div>
            <TemplatePreview template={selected} large />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-caption text-muted">{populated || view !== 'diagram' ? uiText("Será criado um novo diagrama no workspace.") : uiText("O modelo entra no diagrama vazio. Você pode desfazer.")}</p>
              <Button variant="primary" disabled={busy} onClick={() => void create()} icon={<ArrowRight size={16} />}>{busy ? uiText("Criando…") : uiText("Usar modelo")}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 border-b border-line p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-heading font-semibold">{uiText("Um ponto de partida para sua arquitetura")}</h2><p className="mt-1 text-body text-muted">{uiText("Cloud, IA, quântica, blockchain, dados e grafos. Todos os elementos são editáveis.")}</p></div>
                {populated && view === 'diagram' && <Button onClick={() => { closeTemplateGallery(); openSaveTemplate(); }}>{uiText("Salvar meu diagrama")}</Button>}
              </div>
              <label className="flex h-10 items-center gap-2 rounded-control border border-line bg-panel-2 px-3 text-muted"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={uiText("Buscar modelos…")} aria-label={uiText("Buscar modelos")} className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none" /></label>
              <div role="group" aria-label={uiText("Categorias de modelos")} className="flex flex-wrap gap-1.5">{categories.map((entry) => <button type="button" key={entry} aria-pressed={category === entry} onClick={() => setCategory(entry)} className={`rounded-full border px-3 py-1.5 text-caption font-medium transition-colors ${category === entry ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-muted hover:bg-panel-2 hover:text-ink'}`}>{entry}</button>)}</div>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {loadError && <div role="status" className="col-span-full text-caption text-muted">{uiText("Não foi possível carregar as bibliotecas. Tente novamente.")} <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="text-accent">{uiText("Tentar novamente")}</button></div>}
              {filtered.map((template) => (
                <article key={`${local(template) ? 'local' : 'builtin'}:${template.id}`} className="overflow-hidden rounded-panel border border-line bg-panel transition-colors hover:border-accent/40">
                  <button type="button" onClick={() => setSelected(template)} aria-label={uiText("Ver modelo {0}", [template.title])} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
                    <TemplatePreview template={template} />
                    <div className="p-3.5"><span className="text-caption font-medium text-accent">{local(template) ? uiText("Meu workspace") : template.category ?? 'Arquitetura'}</span><h3 className="mt-1 text-title font-semibold">{template.title}</h3><p className="mt-1 min-h-10 text-caption leading-relaxed text-muted">{template.description}</p></div>
                  </button>
                  <div className="flex items-center justify-between px-3.5 pb-3"><span className="text-caption text-faint">{template.ops.filter((op) => op.op === 'add_node').length} {uiText("componentes")}</span>{local(template) ? <IconButton label={uiText("Excluir modelo {0}", [template.title])} onClick={() => remove(template)}><Trash2 size={14} /></IconButton> : <ArrowRight size={15} className="text-faint" />}</div>
                </article>
              ))}
              {!filtered.length && <p role="status" className="col-span-full py-16 text-center text-body text-muted">{uiText("Nenhum modelo encontrado. Experimente outra busca ou categoria.")}</p>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
