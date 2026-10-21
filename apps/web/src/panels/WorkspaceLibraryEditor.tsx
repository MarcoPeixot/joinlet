import { uiText } from '../i18n';
import { BASIC_SHAPES } from '@strukt/core';
import type { ComponentPreset, LayoutRole, Presentation, Shape, TableField } from '@strukt/core';
import { templateFromDiagram } from '@strukt/workspace';
import { Blocks, LayoutTemplate } from 'lucide-react';
import { useState } from 'react';
import { updateWorkspaceLibrary, useLibraryEditor } from '../actions/library';
import { IconGlyph } from '../diagram/icons/IconGlyph';
import { Field, FieldGroup, inputClass } from '../ui/controls';
import { Modal } from '../ui/Modal';
import { showToast, useUi } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { IconField } from './IconPicker';

const close = () => useLibraryEditor.setState({ request: null, owner: null });

export function WorkspaceLibraryEditor() {
  const request = useLibraryEditor((state) => state.request);
  if (!request) return null;
  return request.kind === 'component' ? <ComponentEditor preset={request.preset} editing={request.editing}/> : <TemplateEditor/>;
}

function saveToOwner(save: () => void): string | null {
  try {
    if (!workspace.storage() || workspace.storage() !== useLibraryEditor.getState().owner) throw new Error(uiText("O workspace mudou. Abra novamente o editor de biblioteca."));
    save();
    return null;
  } catch (error) { return error instanceof Error ? error.message : uiText("Não foi possível salvar."); }
}

function ComponentEditor({ preset, editing }: { preset?: ComponentPreset; editing?: boolean }) {
  const [name, setName] = useState(preset?.label ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [category, setCategory] = useState(preset?.category ?? uiText("Meu workspace"));
  const [icon, setIcon] = useState(preset?.icon ?? 'server');
  const [tech, setTech] = useState(preset?.tech ?? '');
  const [presentation, setPresentation] = useState<Presentation | 'shape' | 'group'>(preset?.kind === 'group' ? 'group' : preset?.presentation ?? (preset?.shape ? 'shape' : 'card'));
  const [shape, setShape] = useState<Shape>(preset?.shape ?? 'rectangle');
  const [color, setColor] = useState(preset?.color ?? 'gray');
  const [role, setRole] = useState<LayoutRole | ''>(preset?.layoutRole ?? 'peer');
  const [width, setWidth] = useState(preset?.width?.toString() ?? '');
  const [height, setHeight] = useState(preset?.height?.toString() ?? '');
  const [fields, setFields] = useState<TableField[]>(structuredClone(preset?.fields ?? [{ name: 'id', type: 'uuid', key: 'PK' }]));
  const [error, setError] = useState<string | null>(null);
  const theme = useUi((state) => state.theme);
  const save = () => {
    const component: ComponentPreset = { id: editing && preset ? preset.id : `custom-${crypto.randomUUID()}`, label: name.trim(), description, category: category.trim() || uiText("Meu workspace"), color, ...(icon ? { icon } : {}), ...(tech ? { tech } : {}), ...(presentation === 'group' ? {kind:'group'} : presentation === 'shape' ? { shape } : { presentation }), ...(role && presentation !== 'group' ? { layoutRole: role } : {}), ...(presentation === 'table' ? { fields } : {}), ...(width ? { width: Number(width) } : {}), ...(height ? { height: Number(height) } : {}) };
    const failure = saveToOwner(() => updateWorkspaceLibrary((library) => ({ ...library, components: [...library.components.filter((entry) => entry.id !== component.id), component] })));
    setError(failure);
    if (!failure) { close(); showToast(uiText("Componente salvo na biblioteca do workspace.")); }
  };
  return <Modal open onClose={close} label={editing ? uiText("Editar componente próprio") : uiText("Criar componente próprio")} icon={<Blocks size={18}/>} width={650}>
    <div className="overflow-y-auto p-5">
      <p className="mb-5 text-caption text-muted">{uiText("Defina os padrões deste componente. Cada uso cria uma cópia editável no diagrama.")}</p>
      <div className="mb-5 flex min-h-20 items-center gap-4 rounded-panel border border-line bg-panel-2 px-5 py-4">
        {icon && <IconGlyph name={icon} size={36} legibleOn={theme}/>}
        <div><p className="text-title font-medium">{name || uiText("Seu componente")}</p><p className="mt-1 text-caption text-muted">{tech || uiText("Tecnologia e responsabilidade")}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label={uiText("Nome do componente")}><input value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} h-9`} maxLength={120}/></Field>
        <Field label={uiText("Categoria")}><input value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} h-9`} maxLength={120}/></Field>
        <Field label={uiText("Tecnologia")}><input value={tech} onChange={(event) => setTech(event.target.value)} className={`${inputClass} h-9`} placeholder={uiText("NestJS, PostgreSQL, serviço interno…")}/></Field>
        <div className="col-span-2 max-sm:col-span-1"><FieldGroup label={uiText("Ícone")}><IconField inline value={icon} onChange={(value) => setIcon(value ?? '')}/></FieldGroup></div>
        <Field label={uiText("Apresentação")}><select value={presentation} onChange={(event) => setPresentation(event.target.value as Presentation | 'shape' | 'group')} className={`${inputClass} h-9`}><option value="group">{uiText("Grupo / fronteira")}</option><option value="card">{uiText("Card de arquitetura")}</option><option value="icon">{uiText("Ícone com legenda")}</option><option value="table">{uiText("Tabela de banco")}</option><option value="participant">{uiText("Participante de sequência")}</option><option value="shape">{uiText("Forma de processo")}</option></select></Field>
        <Field label={uiText("Papel na composição")}><select value={role} onChange={(event) => setRole(event.target.value as LayoutRole | '')} className={`${inputClass} h-9`}><option value="">{uiText("Livre")}</option><option value="entry">{uiText("Entrada")}</option><option value="peer">{uiText("Serviço / domínio")}</option><option value="shared">{uiText("Infraestrutura compartilhada")}</option></select></Field>
        {presentation === 'shape' && <Field label={uiText("Forma")}><select value={shape} onChange={(event) => setShape(event.target.value as Shape)} className={`${inputClass} h-9`}>{BASIC_SHAPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>}
        <Field label={uiText("Cor")}><select value={color} onChange={(event) => setColor(event.target.value)} className={`${inputClass} h-9`}>{[['gray',uiText("Neutra")],['blue',uiText("Azul")],['green',uiText("Verde")],['purple',uiText("Roxo")],['orange',uiText("Laranja")],['red',uiText("Vermelho")]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label={uiText("Largura (opcional)")}><input type="number" min={32} max={4000} value={width} onChange={(event) => setWidth(event.target.value)} className={`${inputClass} h-9`} placeholder={uiText("Automática")}/></Field>
        <Field label={uiText("Altura (opcional)")}><input type="number" min={32} max={4000} value={height} onChange={(event) => setHeight(event.target.value)} className={`${inputClass} h-9`} placeholder={uiText("Automática")}/></Field>
      </div>
      <div className="mt-4"><Field label={uiText("Descrição")}><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} min-h-20 py-2`} maxLength={2000}/></Field></div>
      {presentation === 'table' && <section className="mt-4" aria-label={uiText("Campos da tabela")}><p className="mb-2 text-caption font-medium">{uiText("Campos da tabela")}</p>{fields.map((field, i) => <div className="mb-2 flex gap-2" key={i}>
        <input aria-label={uiText("Nome do campo {0}", [i + 1])} value={field.name} onChange={(event) => setFields(fields.map((item,j) => j === i ? {...item,name:event.target.value} : item))} className={`${inputClass} min-w-0 h-8`} placeholder={uiText("Nome")}/>
        <input aria-label={uiText("Tipo do campo {0}", [i + 1])} value={field.type ?? ''} onChange={(event) => setFields(fields.map((item,j) => j === i ? {...item,type:event.target.value} : item))} className={`${inputClass} min-w-0 h-8`} placeholder={uiText("Tipo")}/>
        <select aria-label={uiText("Chave do campo {0}", [i + 1])} value={field.key ?? ''} onChange={(event) => setFields(fields.map((item,j) => j === i ? {...item,key:(event.target.value || undefined) as TableField['key']} : item))} className={`${inputClass} h-8 max-w-20`}><option value="">—</option><option value={"PK"}>{"PK"}</option><option value={"FK"}>{"FK"}</option></select>
        <button type="button" aria-label={uiText("Remover campo {0}", [i + 1])} onClick={() => setFields(fields.filter((_,j) => j !== i))} className="px-2 text-muted">×</button>
      </div>)}<button type="button" onClick={() => setFields([...fields,{name:uiText("campo"),type:'text'}])} className="text-caption text-accent">{uiText("Adicionar campo")}</button></section>}
      {error && <p role="alert" className="mt-4 text-caption text-danger">{error}</p>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-line p-4"><button type="button" onClick={close} className="rounded-control border border-line px-4 py-2 text-caption">{uiText("Cancelar")}</button><button type="button" disabled={!name.trim()} onClick={save} className="rounded-control bg-accent px-4 py-2 text-caption font-medium text-on-accent disabled:opacity-40">{uiText("Salvar componente")}</button></footer>
  </Modal>;
}

function TemplateEditor() {
  const request = useLibraryEditor((state) => state.request);
  const initial = request?.kind === 'template' ? request : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!initial) return;
    const failure = saveToOwner(() => {
      const template = templateFromDiagram(`custom-${crypto.randomUUID()}`, title.trim(), description, initial.snapshot.model, initial.snapshot.layout.nodes);
      updateWorkspaceLibrary((library) => ({ ...library, templates: [...library.templates, template] }));
    });
    setError(failure);
    if (!failure) { close(); showToast(uiText("Template salvo. Disponível em Modelos → Meus modelos.")); }
  };
  return <Modal open onClose={close} label={uiText("Salvar diagrama como template")} icon={<LayoutTemplate size={18}/>} width={520}>
    <div className="space-y-4 p-5"><p className="text-caption text-muted">{uiText("Salva os componentes, conexões e posições para começar novos diagramas neste workspace.")}</p><Field label={uiText("Nome do template")}><input value={title} onChange={(event) => setTitle(event.target.value)} className={`${inputClass} h-9`} maxLength={120}/></Field><Field label={uiText("Descrição do template")}><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} min-h-24 py-2`} maxLength={2000}/></Field>{error && <p role="alert" className="text-caption text-danger">{error}</p>}</div>
    <footer className="flex justify-end gap-2 border-t border-line p-4"><button type="button" onClick={close} className="rounded-control border border-line px-4 py-2 text-caption">{uiText("Cancelar")}</button><button type="button" disabled={!title.trim()} onClick={save} className="rounded-control bg-accent px-4 py-2 text-caption font-medium text-on-accent disabled:opacity-40">{uiText("Salvar template")}</button></footer>
  </Modal>;
}
