import { getLocale, uiText } from '../i18n';
import { componentCopy } from '../i18n/components';
import { catalogMatches, BASIC_COMPONENT_PRESETS as RAW_PRESETS } from '@strukt/core';
import { CLOUD_COMPONENT_PRESETS as RAW_CLOUD } from '@strukt/core/cloud';
const COMPONENT_PRESETS = RAW_PRESETS.map(componentCopy);
const CLOUD_COMPONENT_PRESETS = RAW_CLOUD.map(componentCopy);
import type { ComponentPreset } from '@strukt/core';
import { Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openComponentEditor, openSelectedComponentEditor, removeCustomComponent } from '../actions/library';
import { labelBox, shapeGeometry } from '../diagram/shapes';
import { IconGlyph } from '../diagram/icons/IconGlyph';
import { nodeColors } from '../diagram/palette';
import { useDiagram } from '../state/appStore';
import { inputClass } from '../ui/controls';
import { useUi } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';

const EMPTY: ComponentPreset[] = [];

export function ComponentLibrary({ onSelect, onManage }: { onSelect: (preset: ComponentPreset) => void; onManage?: () => void }) {
  const [query, setQuery] = useState('');
  const [specialist, setSpecialist] = useState<ComponentPreset[]>([]);
  const [COMPONENT_LIBRARIES, setLibraries] = useState<readonly import('@strukt/core/specialist').ComponentLibraryDefinition[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => { let active = true; setLoadError(false); void import('@strukt/core/specialist').then(module => { if(active) { setSpecialist(module.SPECIALIST_COMPONENT_PRESETS.map(componentCopy)); setLibraries(module.COMPONENT_LIBRARIES); } }).catch(() => { if(active) setLoadError(true); }); return () => { active=false; }; }, [loadAttempt]);
  const [library, setLibrary] = useState('all');
  const [category, setCategory] = useState(uiText("Todos"));
  const [limit, setLimit] = useState(90);
  const theme = useUi((state) => state.theme);
  const custom = useWorkspace((state) => state.data?.library?.components ?? EMPTY);
  const selected = useDiagram((state) => state.selection.nodes.length === 1 && !!state.model.elements[state.selection.nodes[0]!]);
  const all = [...custom, ...COMPONENT_PRESETS, ...specialist, ...CLOUD_COMPONENT_PRESETS];
  const inLibrary = all.filter(preset => {
    if (library === 'all') return true;
    if (library === 'workspace') return custom.includes(preset);
    if (library === 'basics') return COMPONENT_PRESETS.includes(preset) && !preset.libraryId;
    if (library === 'cloud') return CLOUD_COMPONENT_PRESETS.includes(preset);
    return preset.libraryId === library;
  });
  const categories = [...new Set(inLibrary.map(preset => preset.category))];
  const matches = (category === uiText("Meu workspace") ? inLibrary.filter(preset => custom.includes(preset)) : inLibrary).filter((preset) => (category === uiText("Todos") || category === uiText("Meu workspace") || preset.category === category) && catalogMatches(query, preset.id, preset.label, preset.description, preset.category, preset.tech, preset.icon, preset.keywords));
  const visible = matches.slice(0, limit);
  const headings = [...new Set(visible.map((preset) => custom.includes(preset) ? uiText("Meu workspace") : preset.category))];
  return <div className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col">
      <div className="border-b border-line p-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-body font-medium text-ink">{uiText("Componentes")}</p><span className="text-meta text-muted">{all.length.toLocaleString(getLocale())} {uiText("disponíveis")}</span></div>
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
          <input aria-label={uiText("Buscar componente")} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(90); }} placeholder={uiText("Lambda, VPC, banco, tabela, fila…")} className={`${inputClass} h-9 pl-8`} />
        </div>
        <select aria-label={uiText("Biblioteca de componentes")} value={library} onChange={event => { setLibrary(event.target.value); setCategory(uiText("Todos")); setLimit(90); }} className={`${inputClass} mt-2 h-8 text-caption`}><option value="all">{uiText("Todas as bibliotecas")}</option><option value="basics">{uiText("Componentes básicos")}</option><option value="cloud">AWS · Azure · GCP</option><option value="workspace">{uiText("Meu workspace")}</option>{COMPONENT_LIBRARIES.map(pack => <option key={pack.id} value={pack.id}>{uiText(pack.label)}</option>)}</select>
        <select aria-label={uiText("Categoria de componentes")} value={category} onChange={(event) => { setCategory(event.target.value); setLimit(90); }} className={`${inputClass} mt-2 h-8 text-caption`}><option>{uiText("Todos")}</option><option>{uiText("Meu workspace")}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      </div>
      <div className="max-h-[min(480px,55dvh)] overflow-y-auto p-3">
        {loadError && <div role="status" className="mb-3 text-caption text-muted">{uiText("Não foi possível carregar as bibliotecas. Tente novamente.")} <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="text-accent">{uiText("Tentar novamente")}</button></div>}
        {headings.map((heading) => {
          const items = visible.filter((preset) => (custom.includes(preset) ? uiText("Meu workspace") : preset.category) === heading);
          return <section key={heading} className="mb-3 last:mb-0">
            <p className="mb-1.5 text-meta font-medium text-muted">{heading}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((preset) => {
                const geo = preset.kind === 'group' || preset.presentation === 'card' || preset.presentation === 'table' ? shapeGeometry('rectangle',48,32) : preset.shape ? shapeGeometry(preset.shape, 48, 32) : null;
                const box = preset.shape ? labelBox(preset.shape, 48, 32) : { x: 0, y: 0, w: 48, h: 32 };
                const colors = nodeColors(preset.color, 'pastel', theme);
                const isCustom = custom.includes(preset);
                return <div key={preset.id} className="group relative rounded-control border border-transparent hover:border-line hover:bg-panel-2">
                  <button type="button" aria-label={uiText("Adicionar {0}", [preset.label])} title={preset.description} onClick={() => onSelect(preset)} className={`flex min-h-[98px] w-full flex-col items-center justify-center gap-2 rounded-control px-1.5 py-3 text-caption text-ink focus-visible:outline-2 focus-visible:outline-accent ${isCustom ? 'pb-7' : ''}`}>
                    <span className="relative h-[34px] w-[50px]" aria-hidden>
                      {geo && <svg width="50" height="34" viewBox="-1 -1 50 34"><path d={geo.d} fill={colors.fill} stroke={colors.stroke} strokeWidth="1.25" />{geo.detail && <path d={geo.detail} fill="none" stroke={colors.stroke} strokeWidth="1" />}</svg>}
                      {preset.icon && <span className="absolute" style={{ left: 1 + box.x + box.w / 2 - (geo ? 6 : 16), top: 1 + box.y + box.h / 2 - (geo ? 6 : 16) }}><IconGlyph name={preset.icon} size={geo ? 12 : 32} color={colors.icon} legibleOn={theme} /></span>}
                    </span><span className="line-clamp-3 text-center leading-tight">{preset.label}</span>
                  </button>
                    {isCustom && <div className="absolute inset-x-0 bottom-1 flex justify-center gap-3"><button type="button" aria-label={uiText("Editar componente {0}", [preset.label])} onClick={() => { onManage?.(); openComponentEditor(preset, true); }} className="rounded p-1 text-muted hover:text-ink"><Pencil size={12}/></button><button type="button" aria-label={uiText("Excluir componente {0}", [preset.label])} onClick={() => removeCustomComponent(preset.id)} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={12}/></button></div>}
                </div>;
              })}
            </div>
          </section>;
        })}
        {!matches.length && <p className="py-6 text-center text-caption text-muted">{uiText("Nenhum componente encontrado.")}</p>}
        {matches.length > limit && <button type="button" onClick={() => setLimit(limit + 90)} className="mt-2 w-full rounded-control border border-line py-2 text-caption text-muted">{uiText("Mostrar mais (")}{matches.length - limit}{")"}</button>}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line p-3"><button type="button" onClick={() => { onManage?.(); openComponentEditor(); }} className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-caption text-accent"><Plus size={14}/>{uiText("Criar componente")}</button><button type="button" disabled={!selected} onClick={() => { onManage?.(); openSelectedComponentEditor(); }} className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-caption text-muted hover:text-ink disabled:opacity-40"><Save size={14}/>{uiText("Salvar selecionado")}</button></footer>
    </div>;
}
