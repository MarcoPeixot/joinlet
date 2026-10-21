import { localizedPerspectives } from '../i18n/perspectives';
import { uiText } from '../i18n';
import { own } from '@strukt/core';
import type { ID } from '@strukt/core';
import { LEVELS, LEVEL_LABELS, PERSPECTIVE_LIMITS, isBuiltinPerspective, newPerspectiveId, resolvePerspective, sharedTagsOf } from '@strukt/workspace';
import type { Level, Perspective } from '@strukt/workspace';
import { Check, Copy, Eye, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { diagramStore, useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { Field, FieldGroup, TextArea, TextField, inputClass } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { pluralize } from '../ui/plural';
import { Switch } from '../ui/Switch';
import { closeRightPanel, showToast, uiStore, useUi } from '../ui/uiStore';
import { workspace, useWorkspace } from '../workspace/appWorkspace';
import { perspectivesFor } from '../workspace/lookup';
import { compact, flip } from './edit';
import { setActivePerspective } from './read';
import { acceptSuggestions, dismissSuggestions, levelCounts, requestLevelSuggestions, suggestionStore } from './suggest';

const NO_PERSPECTIVES: Perspective[] = [];
const TAG = /^[a-z][a-z0-9_-]*:[^:\s]{1,64}$/i;
const compactSelect = inputClass.replace('w-full ', '');

function Chip({ children, onRemove, label }: { children: string; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-chip bg-panel-3 py-0.5 pl-2 pr-0.5 text-caption">
      <span className="truncate">{children}</span>
      <button type="button" aria-label={label} className="rounded-chip p-0.5 text-muted hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent" onClick={onRemove}><X size={12} /></button>
    </span>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-chip border px-2 py-0.5 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-accent ${on ? 'border-transparent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-panel-2 hover:text-ink'}`}>{children}</button>
  );
}

/** "Níveis C4": how many elements have a level, and the proposals the heuristic made, to accept one by one. */
function LevelsSection({ slug, locked }: { slug: string; locked: boolean }) {
  const model = useDiagram((s) => s.model);
  const shared = useWorkspace((s) => s.data?.shared);
  const pending = useStore(suggestionStore, (s) => (s.diagram === slug ? s.items : null));
  const counts = useMemo(() => levelCounts(model, shared, slug), [model, shared, slug]);
  const accepted = pending?.filter((item) => item.accepted).length ?? 0;
  const update = (id: ID, patch: { level?: Level; accepted?: boolean }) => suggestionStore.setState((s) => ({ ...s, items: s.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  return (
    <PanelSection title={uiText("Níveis C4")}>
      <p className="text-caption text-muted">
        {LEVELS.map((level) => `${counts[level]} ${uiText(LEVEL_LABELS[level]).toLowerCase()}`).join(' · ')} {"·"} {counts.none} {uiText("sem nível. O nível é a tag")} <code className="font-mono">nivel:…</code> {uiText("da entidade compartilhada; defina um no Inspector ou aceite uma sugestão.")}</p>
      {!pending && <Button icon={<Sparkles size={14} />} onClick={requestLevelSuggestions} disabled={locked || counts.none === 0}>{uiText("Sugerir níveis")}</Button>}
      {pending && <div className="flex flex-col gap-2" role="group" aria-label={uiText("Níveis sugeridos")}>
        <p className="text-caption text-muted">{uiText("Uma proposta pela profundidade nos grupos e pela tecnologia. Nada muda até você aceitar.")}</p>
        <ul className="flex flex-col gap-1.5">
          {pending.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 rounded-control bg-panel-2 p-2">
              <label className="flex items-center gap-2 text-body">
                <input type="checkbox" checked={item.accepted} onChange={(event) => update(item.id, { accepted: event.target.checked })} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <select aria-label={uiText("Nível de {0}", [item.label])} className={`${compactSelect} h-7 w-[7.5rem] shrink-0 py-0 text-caption`} value={item.level} onChange={(event) => update(item.id, { level: LEVELS.find((level) => level === event.target.value) ?? item.level })}>
                  {LEVELS.map((level) => <option key={level} value={level}>{uiText(LEVEL_LABELS[level])}</option>)}
                </select>
              </label>
              <span className="text-meta text-muted">{item.reason}</span>
            </li>
          ))}
        </ul>
        <p className="text-meta text-muted">{uiText("Atribuir um nível compartilha o componente com o workspace.")}</p>
        <div className="flex gap-2">
          <Button variant="primary" icon={<Check size={14} />} disabled={locked || accepted === 0} onClick={() => void acceptSuggestions()}>{uiText("Aceitar")} {accepted}</Button>
          <Button variant="ghost" onClick={dismissSuggestions}>{uiText("Descartar")}</Button>
        </div>
      </div>}
    </PanelSection>
  );
}

/** Element ids a perspective names (always shown, hidden, collapsed), as chips plus "add the selection". */
function NamedList({ title, ids, labelOf, onChange, candidates }: { title: string; ids: readonly ID[] | undefined; labelOf: (id: ID) => string; onChange: (ids: ID[]) => void; candidates: () => ID[] }) {
  const list = ids ?? [];
  return (
    <FieldGroup label={title}>
      <div className="flex flex-wrap gap-1">
        {list.map((id) => <Chip key={id} label={uiText("Remover {0} de {1}", [labelOf(id), title])} onRemove={() => onChange(list.filter((other) => other !== id))}>{labelOf(id)}</Chip>)}
        {list.length === 0 && <span className="text-caption text-faint">{uiText("Nenhum")}</span>}
      </div>
      <Button size="sm" variant="ghost" icon={<Plus size={12} />} className="self-start" onClick={() => {
        const add = candidates().filter((id) => !list.includes(id));
        if (!add.length) showToast(uiText("Selecione antes os elementos no canvas."));
        else onChange([...list, ...add].slice(0, PERSPECTIVE_LIMITS.nodes));
      }}>{uiText("Usar seleção")}</Button>
    </FieldGroup>
  );
}

function Editor({ perspective, tags, onChange }: { perspective: Perspective; tags: string[]; onChange: (next: Perspective) => void }) {
  const model = useDiagram((s) => s.model);
  const labelOf = (id: ID) => own(model.elements, id)?.label ?? id;
  const set = (patch: Partial<Perspective>) => onChange(compact({ ...perspective, ...patch }));
  const selected = () => diagramStore.getState().selection.nodes;
  const known = [...new Set([...tags, ...(perspective.tags ?? [])])].sort();
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line p-2.5">
      <Field label={uiText("Nome")}><TextField value={perspective.name} onCommit={(name) => name.trim() && set({ name: name.trim().slice(0, PERSPECTIVE_LIMITS.name) })} /></Field>
      <Field label={uiText("Descrição")}><TextArea value={perspective.description ?? ''} placeholder={uiText("Para quem é e o que mostra")} onCommit={(description) => set({ description: description.trim().slice(0, PERSPECTIVE_LIMITS.description) })} /></Field>
      <FieldGroup label={uiText("Níveis C4")}>
        <div className="flex flex-wrap gap-1">{LEVELS.map((level) => <Toggle key={level} on={perspective.levels?.includes(level) ?? false} onClick={() => set({ levels: LEVELS.filter((item) => flip(perspective.levels, level).includes(item)) })}>{uiText(LEVEL_LABELS[level])}</Toggle>)}</div>
      </FieldGroup>
      <FieldGroup label={"Tags"}>
        <div className="flex flex-wrap gap-1">
          {known.map((tag) => <Toggle key={tag} on={perspective.tags?.includes(tag) ?? false} onClick={() => set({ tags: flip(perspective.tags, tag) })}>{tag.replace(':', ' · ')}</Toggle>)}
          {known.length === 0 && <span className="text-caption text-faint">{uiText("Nenhuma tag nas entidades compartilhadas.")}</span>}
        </div>
        <TextField value="" placeholder={uiText("nova tag, ex.: risco:alto")} onCommit={(text) => {
          const tag = text.trim();
          if (!tag) return;
          if (!TAG.test(tag)) showToast(uiText("Use tags no formato grupo:valor."));
          else set({ tags: [...new Set([...(perspective.tags ?? []), tag])].slice(0, PERSPECTIVE_LIMITS.tags) });
        }} />
        <p className="text-meta text-muted">{uiText("Valores da mesma chave são alternativas; chaves diferentes valem todas.")}</p>
      </FieldGroup>
      <Switch label={uiText("Esmaecer o resto")} description={uiText("Em vez de ocultar o que não combina, deixa esmaecido (como a lente de tags).")} checked={perspective.mode === 'dim'} onChange={(on) => set({ mode: on ? 'dim' : 'hide' })} />
      <Switch label={uiText("Ligar conexões ao grupo")} description={uiText("Uma conexão com algo que não aparece vai para o grupo mais próximo que aparece.")} checked={perspective.collapse === true} onChange={(collapse) => set({ collapse })} />
      <NamedList title={uiText("Sempre mostrar")} ids={perspective.include} labelOf={labelOf} onChange={(include) => set({ include })} candidates={selected} />
      <NamedList title={uiText("Ocultar")} ids={perspective.hide} labelOf={labelOf} onChange={(hide) => set({ hide })} candidates={selected} />
      <NamedList title={uiText("Recolher grupos")} ids={perspective.collapsed} labelOf={labelOf} onChange={(collapsed) => set({ collapsed })} candidates={() => selected().filter((id) => own(model.elements, id)?.kind === 'group')} />
    </div>
  );
}

export function PerspectivesPanel() {
  const slug = useWorkspace((s) => s.diagram);
  const data = useWorkspace((s) => s.data);
  const saved = useWorkspace((s) => perspectivesFor(s.data, s.diagram) ?? NO_PERSPECTIVES);
  const model = useDiagram((s) => s.model);
  const active = useUi((s) => s.activePerspective);
  const [editing, setEditing] = useState<string | null>(null);
  // Reading is always allowed; saving perspectives or levels is an edit, so it follows the diagram's locks (a read-only link, a draft, a comparison).
  const locked = useDiagram((s) => s.readOnly) !== null;
  const all = useMemo(() => localizedPerspectives(saved), [saved]);
  const tagsOf = useMemo(() => sharedTagsOf(data?.shared, slug ?? ''), [data?.shared, slug]);
  const used = useMemo(() => [...new Set(Object.values(data?.shared?.entities ?? {}).flatMap((entity) => entity.tags ?? []))].filter((tag) => !tag.toLowerCase().startsWith('nivel:')).sort(), [data?.shared]);
  const counts = useMemo(() => new Map(all.map((item) => [item.id, resolvePerspective(model, tagsOf, item).counts])), [all, model, tagsOf]);
  if (!slug) return null;
  const save = (next: Perspective[]) => workspace.setPerspectives(slug, next);
  const activeId = active?.diagram === slug ? active.id : null;
  const create = (base: Partial<Perspective> & { name: string }) => {
    if (saved.length >= PERSPECTIVE_LIMITS.perspectives) { showToast(uiText("O limite é de {0} perspectivas por diagrama.", [PERSPECTIVE_LIMITS.perspectives])); return; }
    const id = newPerspectiveId(base.name, new Set(all.map((item) => item.id)));
    save([...saved, { ...base, id }]);
    setEditing(id);
  };
  const replace = (next: Perspective) => {
    if (activeId === next.id && active && active.name !== next.name) uiStore.setState({ activePerspective: { ...active, name: next.name } });
    save(saved.some((item) => item.id === next.id) ? saved.map((item) => (item.id === next.id ? next : item)) : [...saved, next]);
  };
  return (
    <SidePanel label={uiText("Perspectivas")}>
      <PanelHeader icon={<Eye size={14} />} title={uiText("Perspectivas")} subtitle={pluralize(all.length, uiText("perspectiva"), uiText("perspectivas"), 'f')} onClose={() => closeRightPanel('perspectives')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title={uiText("Ler o diagrama por…")}>
          <p className="text-caption text-muted">{uiText("Uma perspectiva só muda o que você vê: o diagrama, o histórico e os arquivos do modelo ficam como estão. Ela vale no canvas e nas exportações.")}</p>
          <ul className="flex flex-col gap-1.5">
            {all.map((item) => {
              const builtin = isBuiltinPerspective(item.id) && !saved.some((entry) => entry.id === item.id);
              const on = activeId === item.id;
              const count = counts.get(item.id);
              return (
                <li key={item.id} className="flex flex-col gap-2">
                  <div className={`flex items-start gap-2 rounded-control border p-2 ${on ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{item.name}</p>
                      {item.description && <p className="text-meta text-muted">{item.description}</p>}
                      {count && <p className="mt-0.5 font-mono text-meta text-faint">{count.shown} {uiText("de")} {count.total} {uiText("componentes")}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Button size="sm" variant={on ? 'primary' : 'secondary'} aria-pressed={on} onClick={() => setActivePerspective(slug, on ? null : item)}>{on ? uiText("Aplicada") : uiText("Aplicar")}</Button>
                      <div className="flex">
                        <IconButton label={uiText("Duplicar {0}", [item.name])} iconSize={14} disabled={locked} onClick={() => create({ ...item, name: uiText("{0} (cópia)", [item.name]).slice(0, PERSPECTIVE_LIMITS.name) })}><Copy /></IconButton>
                        {!builtin && <IconButton label={uiText("Excluir {0}", [item.name])} iconSize={14} disabled={locked} onClick={() => {
                          if (on) setActivePerspective(slug, null);
                          if (editing === item.id) setEditing(null);
                          save(saved.filter((entry) => entry.id !== item.id));
                        }}><Trash2 /></IconButton>}
                      </div>
                    </div>
                  </div>
                  {!builtin && (editing === item.id && !locked
                    ? <><Editor perspective={item} tags={used} onChange={replace} /><Button size="sm" variant="ghost" className="self-start" onClick={() => setEditing(null)}>{uiText("Concluir edição")}</Button></>
                    : <Button size="sm" variant="ghost" className="self-start" disabled={locked} onClick={() => setEditing(item.id)}>{uiText("Editar")} {item.name}</Button>)}
                  {builtin && <p className="text-meta text-muted">{uiText("Predefinição C4. Duplique para ajustar.")}</p>}
                </li>
              );
            })}
          </ul>
          <Button icon={<Plus size={14} />} disabled={locked} onClick={() => create({ name: uiText("Nova perspectiva") })}>{uiText("Nova perspectiva")}</Button>
        </PanelSection>
        <LevelsSection slug={slug} locked={locked} />
      </div>
    </SidePanel>
  );
}
