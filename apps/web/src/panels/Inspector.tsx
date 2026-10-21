import { uiText } from '../i18n';
import './inspector.css';
import { CARDINALITIES, COLOR_MODES, CONNECTORS, STYLE_MODES, TYPEFACES, drawingShape, nodeVariant, own } from '@strukt/core';
import type { Cardinality, DiagramElement, EdgeEl, ColorMode, NodeEl, Presentation, StyleMode, TableField, Typeface } from '@strukt/core';
import { LEVELS, LEVEL_LABELS, diagramLink, diagramSlugOf, docLink, docSlugOf, levelOf, validEvidencePath } from '@strukt/workspace';
import type { Concern, Evidence } from '@strukt/workspace';
import type { ItemEntry } from '@strukt/workspace';
import { Boxes, Check, ChevronDown, Copy, FileText, Layers, Palette, Settings2, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { m, useIsPresent } from 'motion/react';
import { Tabs } from 'radix-ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  deleteSelection, groupSelectionOrCreate, renameElement, updateEdge, updateElement, updateElements,
  changeShape,
} from '../actions/elements';
import { COLOR_MODE_LABELS, CONNECTOR_LABELS, STYLE_MODE_LABELS, TYPEFACE_LABELS } from '../diagram/labels';
import { diagramStore, useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { Field, FieldGroup, Segmented, TextArea, TextField, inputClass } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { GLIDE } from '../ui/motion';
import { showToast, uiStore, useUi } from '../ui/uiStore';
import { copySelectionImage } from '../actions/export';
import { Passport } from './Passport';
import { ElementGlyph, ElementIdentity } from './ElementIdentity';
import { openDiagramLink, openDocLink } from '../workspace/actions';
import { workspace, useWorkspace } from '../workspace/appWorkspace';
import { collaborationSession } from '../workspace/boot';
import { ColorPicker } from './ColorPicker';
import { IconField } from './IconPicker';
import { ShapePicker } from './ShapePicker';
import { colorModes, styleModes, typefaces } from './styleOptions';
import { refsFor } from '../workspace/lookup';

const inherit = { value: '' as const, label: uiText("Herdar") };

const clearSelection = () => diagramStore.getState().select({ nodes: [], edges: [] });

function DeleteFooter() {
  return <footer className="sk-inspector-footer">
    <span className="flex items-center gap-1.5 text-meta text-faint"><Check size={13} />{uiText("Edição com salvamento automático")}</span>
    <IconButton label={uiText("Excluir")} className="hover:text-danger" onClick={deleteSelection}><Trash2 size={14} /></IconButton>
  </footer>;
}

/** The frequent controls stay visible; the rest can be explored without a wall of fields. */
function EditorSection({ title, hint, icon, open = false, children }: { title: string; hint: string; icon: ReactNode; open?: boolean; children: ReactNode }) {
  return <details className="sk-inspector-disclosure" open={open || undefined}>
    <summary><span className="sk-inspector-disclosure-icon" aria-hidden>{icon}</span><span className="min-w-0 flex-1"><span className="block text-body font-medium">{title}</span><span className="mt-0.5 block text-meta text-muted">{hint}</span></span><ChevronDown size={14} className="sk-inspector-chevron text-faint" /></summary>
    <div className="sk-inspector-disclosure-body">{children}</div>
  </details>;
}

const NO_DOCS: ItemEntry[] = [];
const NO_EVIDENCE: Evidence[] = [];
const NO_CONCERNS: Concern[] = [];

function EvidenceField({ id }: { id: string }) {
  const slug = useWorkspace((s) => s.diagram);
  const refs = useWorkspace((s) => refsFor(s.data, s.diagram, id) || NO_EVIDENCE);
  return <Field label={uiText("Evidência no código")}>
    <TextArea value={refs.map((ref) => `${ref.path}${ref.line ? `#L${ref.line}` : ''}`).join("\n")} placeholder="src/api.ts#L42" onCommit={(text) => {
      if (!slug) return;
      const parsed = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const match = /^(.*?)(?:#L(\d+))?$/.exec(line)!;
        const path = match[1]!, at = match[2] ? Number(match[2]) : undefined;
        // Editing the list must not lose what was recorded for an unchanged reference (`snippet` comes from the CLI/agents).
        const kept = refs.find((ref) => ref.path === path && ref.line === at);
        return { path, ...(at ? { line: at } : {}), ...(kept?.contains ? { contains: kept.contains } : {}), ...(kept?.snippet ? { snippet: kept.snippet } : {}) };
      });
      if (parsed.some((ref) => !validEvidencePath(ref.path) || (ref.line !== undefined && ref.line < 1))) { showToast(uiText("Use caminhos relativos ao repositório, um por linha.")); return; }
      workspace.setEvidence(slug, id, parsed);
    }} />
  </Field>;
}

function ConcernField({ id }: { id: string }) {
  const slug = useWorkspace((state) => state.diagram);
  const concerns = useWorkspace((state) => state.data?.concerns ?? NO_CONCERNS);
  const [message, setMessage] = useState('');
  const open = concerns.filter((item) => item.status === 'open' && item.diagram === slug && item.element === id);
  return <div className="flex flex-col gap-3">
    {open.map((item) => <div key={item.id} className="rounded-control bg-panel-2 p-2 text-caption">
      <p>{item.message}</p>
      <button type="button" className="mt-1 text-accent hover:underline" onClick={() => workspace.setConcerns(concerns.map((entry) => entry.id === item.id ? { ...entry, status: 'resolved' } : entry))}>{uiText("Resolver")}</button>
    </div>)}
    <textarea aria-label={uiText("Apontar imprecisão")} className={inputClass} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={uiText("O que está incorreto ou faltando?")} />
    <Button disabled={!message.trim()} onClick={() => {
      if (!slug || !message.trim()) return;
      workspace.setConcerns([...concerns, { id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), diagram: slug, element: id, message: message.trim(), status: 'open', createdAt: new Date().toISOString() }]);
      setMessage('');
    }}>{uiText("Registrar pendência")}</Button>
  </div>;
}

function SharedEntityField({ el }: { el: DiagramElement }) {
  const slug = useWorkspace((s) => s.diagram);
  const shared = useWorkspace((s) => s.data?.shared);
  const linkedView = slug && shared ? own(shared.views, slug) : undefined;
  const linked = linkedView ? own(linkedView, el.id) : undefined;
  const entities = Object.values(shared?.entities ?? {});
  return <><FieldGroup label={uiText("Entidade compartilhada")}>
    <div className="flex gap-1.5">
      <select aria-label={uiText("Entidade compartilhada")} className={`${inputClass} min-w-0 flex-1`} value={linked ?? ''} onChange={(event) => { if (slug) workspace.linkEntity(slug, el.id, event.target.value || null); }}>
        <option value="">{uiText("Só neste diagrama")}</option>
        {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.label ?? entity.id}</option>)}
      </select>
      {!linked && <Button onClick={() => { if (slug) workspace.linkEntity(slug, el.id, crypto.randomUUID().replace(/-/g, '').slice(0, 16)); }}>{uiText("Compartilhar")}</Button>}
    </div>
  </FieldGroup>
    <Field label={uiText("Nível C4")}>
      <select aria-label={uiText("Nível C4")} className={`${inputClass} h-8`} value={levelOf(linked && shared ? own(shared.entities, linked)?.tags : undefined) ?? ''} onChange={(event) => { if (slug) void workspace.setLevels(slug, { [el.id]: (LEVELS.find((level) => level === event.target.value) ?? null) }); }}>
        <option value="">{uiText("Sem nível")}</option>
        {LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
      </select>
      {!linked && <span className="text-caption text-muted">{uiText("Definir um nível compartilha o componente: a tag fica na entidade compartilhada.")}</span>}
    </Field>
    {linked && <Field label={uiText("Tags da entidade")}>
      <TextField value={(shared && own(shared.entities, linked))?.tags?.join(', ') ?? ''} placeholder={uiText('risco:alto, ambiente:produção')} onCommit={(text) => {
        const tags = text.split(',').map((tag) => tag.trim()).filter(Boolean);
        if (tags.some((tag) => !/^[a-z][a-z0-9_-]*:[^:\s]{1,64}$/i.test(tag))) { showToast(uiText("Use tags no formato grupo:valor, separadas por vírgula.")); return; }
        workspace.setEntityTags(linked, tags);
      }} />
    </Field>}
  </>;
}

function SharedRelationField({ edge }: { edge: EdgeEl }) {
  const slug = useWorkspace((s) => s.diagram);
  const shared = useWorkspace((s) => s.data?.shared);
  const view = slug && shared ? own(shared.views, slug) : undefined;
  const from = view ? own(view, edge.from) : undefined;
  const to = view ? own(view, edge.to) : undefined;
  const relationView = slug && shared?.viewRelations ? own(shared.viewRelations, slug) : undefined;
  const linked = relationView ? own(relationView, edge.id) : undefined;
  const choices = Object.values(shared?.relations ?? {}).filter((relation) => relation.from === from && relation.to === to);
  return <FieldGroup label={uiText("Relação compartilhada")}>
    {from && to ? <div className="flex gap-1.5">
      <select aria-label={uiText("Relação compartilhada")} className={`${inputClass} min-w-0 flex-1`} value={linked ?? ''} onChange={(event) => { if (slug) workspace.linkRelation(slug, edge.id, event.target.value || null); }}>
        <option value="">{uiText("Só neste diagrama")}</option>
        {choices.map((relation) => <option key={relation.id} value={relation.id}>{relation.label ?? `${edge.from} → ${edge.to}`}</option>)}
      </select>
      {!linked && <Button onClick={() => { if (slug) workspace.linkRelation(slug, edge.id, crypto.randomUUID().replace(/-/g, '').slice(0, 16)); }}>{uiText("Compartilhar")}</Button>}
    </div> : <p className="text-caption text-muted">{uiText("Compartilhe os dois componentes primeiro.")}</p>}
    {linked && <div className="mt-2 flex flex-col gap-2">
      <Field label={uiText("Tecnologia da relação")}><TextField value={shared?.relations?.[linked]?.tech ?? ''} placeholder={uiText("ex.: HTTPS")} onCommit={(tech) => workspace.setRelationDetails(linked, { tech })} /></Field>
      <Field label={uiText("Descrição da relação")}><TextArea value={shared?.relations?.[linked]?.description ?? ''} placeholder={uiText("Contrato, semântica ou dados trocados")} onCommit={(description) => workspace.setRelationDetails(linked, { description })} /></Field>
    </div>}
  </FieldGroup>;
}

/** `link: "doc:<slug>"` ties the element to a workspace doc; an external link stays until a doc replaces it. */
function DocPicker({ el }: { el: DiagramElement }) {
  const docs = useWorkspace((s) => s.data?.manifest.docs ?? NO_DOCS);
  const linked = docSlugOf(el.link);
  const external = el.link && !linked && !diagramSlugOf(el.link) ? el.link : null;
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label={uiText("Documento")}
        className={`${inputClass} h-8 min-w-0 flex-1`}
        value={linked ?? ''}
        onChange={(event) => updateElement(el.id, { link: event.target.value ? docLink(event.target.value) : null })}
      >
        <option value="">{external ? `Link: ${external}` : uiText("Nenhum")}</option>
        {docs.map((doc) => (
          <option key={doc.slug} value={doc.slug}>
            {doc.title}
          </option>
        ))}
        {linked && !docs.some((doc) => doc.slug === linked) && <option value={linked}>{uiText("(documento removido)")}</option>}
      </select>
      {linked && (
        <IconButton label={uiText("Abrir documento")} onClick={() => void openDocLink(el.link)}>
          <FileText />
        </IconButton>
      )}
    </div>
  );
}

function DiagramPicker({ el }: { el: DiagramElement }) {
  const diagrams = useWorkspace((s) => s.data?.manifest.diagrams ?? NO_DOCS);
  const current = useWorkspace((s) => s.diagram);
  const linked = diagramSlugOf(el.link);
  return <div className="flex items-center gap-1.5">
    <select aria-label={uiText("Detalhar em")} className={`${inputClass} h-8 min-w-0 flex-1`} value={linked ?? ''} onChange={(event) => updateElement(el.id, { link: event.target.value ? diagramLink(event.target.value) : null })}>
      <option value="">{uiText("Nenhum")}</option>
      {diagrams.filter((item) => item.slug !== current).map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
      {linked && !diagrams.some((item) => item.slug === linked) && <option value={linked}>{uiText("(diagrama removido)")}</option>}
    </select>
    {linked && <IconButton label={uiText("Abrir diagrama detalhado")} onClick={() => void openDiagramLink(el.link)}><Layers /></IconButton>}
  </div>;
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="sk-inspector-scroll">{children}</div>;
}

const TABS = [
  { value: 'overview', label: uiText("Visão") },
  { value: 'edit', label: uiText("Editar") },
] as const;

/** "Visão" (the passport) and "Editar" (the fields); the choice sticks while the app is open. */
function PanelTabs() {
  const tab = useUi((s) => s.inspectorTab);
  return (
    <Tabs.List aria-label={uiText("Propriedades")} className="sk-inspector-tabs">
      {TABS.map((t) => (
        <Tabs.Trigger
          key={t.value}
          value={t.value}
          className="relative h-8 flex-1 rounded-[7px] text-caption font-medium text-muted outline-none transition-colors duration-(--sk-motion-fast) hover:text-ink data-[state=active]:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          {tab === t.value && <m.span layoutId="inspector-tab" transition={GLIDE} className="absolute inset-0 rounded-[7px] bg-panel-2" />}
          <span className="relative">{t.label}</span>
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

function ElementPanel({ el }: { el: DiagramElement }) {
  const group = el.kind === 'group';
  const tab = useUi((s) => s.inspectorTab);
  return (
    <>
      <PanelHeader
        title={group ? el.canvasFrame ? uiText("Diagrama no canvas") : uiText("Grupo") : uiText("Nó")}
        actions={<IconButton label={uiText("Copiar imagem transparente (⌘⇧C)")} onClick={() => void copySelectionImage()}><Copy /></IconButton>}
        onClose={clearSelection}
        closeLabel={uiText("Fechar propriedades")}
      />
      <ElementIdentity el={el} />
      <Tabs.Root value={tab} onValueChange={(value) => uiStore.setState({ inspectorTab: value as 'overview' | 'edit' })} className="flex min-h-0 flex-1 flex-col">
        <PanelTabs />
        <Tabs.Content value="overview" className="flex min-h-0 flex-1 flex-col outline-none">
          <Passport el={el} />
        </Tabs.Content>
        <Tabs.Content value="edit" className="flex min-h-0 flex-1 flex-col outline-none">
          <ElementFields el={el} />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function ElementFields({ el }: { el: DiagramElement }) {
  return (
    <>
      <Scroll>
        <section className="sk-inspector-section">
          <h3 className="sk-inspector-section-title">{uiText("Conteúdo")}</h3>
          <Field label={uiText("Rótulo")}>
            <TextField value={el.label ?? ''} placeholder={el.id} onCommit={(label) => updateElement(el.id, { label: label || null })} />
          </Field>
          <Field label={uiText("Tecnologia")}><TextField value={el.tech ?? ''} placeholder={uiText("ex.: Node.js, PostgreSQL, Redis")} onCommit={(tech) => updateElement(el.id, { tech: tech || null })} /></Field>
          <Field label={uiText("Descrição")}><TextArea value={el.description ?? ''} placeholder={uiText("O que este componente faz? Quais são suas responsabilidades?")} onCommit={(description) => updateElement(el.id, { description: description || null })} /></Field>
        </section>
        {el.kind === 'node' && el.presentation === 'table' && <TableFields el={el} />}
        <EditorSection title="Visual" hint={uiText("Forma, ícone e cor no diagrama")} icon={<Palette size={16} />} open>
          {el.kind === 'node' && (
            <FieldGroup label={uiText("Apresentação")}>
              <select aria-label={uiText("Apresentação")} className={inputClass} value={el.presentation ?? ''} onChange={event => updateElement(el.id, { presentation: event.target.value ? event.target.value as Presentation : null })}>
                <option value="">{uiText("Forma/ícone")}</option><option value="card">{"Card"}</option><option value="icon">{uiText("Ícone")}</option><option value="table">{uiText("Tabela de dados")}</option><option value="participant">{uiText("Participante de sequência")}</option>
              </select>
              {el.presentation==='card' && <select aria-label={uiText("Papel na composição")} className={inputClass} value={el.layoutRole??'peer'} onChange={event=>updateElement(el.id,{layoutRole:event.target.value as 'entry'|'peer'|'shared'})}><option value="entry">{uiText("Entrada")}</option><option value="peer">{uiText("Domínio / par")}</option><option value="shared">{uiText("Infraestrutura compartilhada")}</option></select>}
            </FieldGroup>
          )}
          {el.kind === 'group' && !el.parentId && <FieldGroup label={uiText("Papel do grupo na composição")}><select aria-label={uiText("Papel na composição")} className={inputClass} value={el.layoutRole??'peer'} onChange={event=>updateElement(el.id,{layoutRole:event.target.value as 'entry'|'peer'|'shared'})}><option value="entry">{uiText("Entrada")}</option><option value="peer">{uiText("Domínio / par")}</option><option value="shared">{uiText("Compartilhado")}</option></select></FieldGroup>}
          {el.kind === 'node' && el.presentation !== 'table' && el.presentation !== 'participant' && (
            <FieldGroup label={uiText("Forma")}>
              <ShapePicker value={nodeVariant(el) === 'icon' ? undefined : drawingShape(el.shape)} allowIcon={!!el.icon} onChange={(shape) => changeShape(el.id, shape)} />
            </FieldGroup>
          )}
          <FieldGroup label={uiText("Ícone")}>
            <IconField value={el.icon} onChange={(icon) => updateElement(el.id, { icon })} />
          </FieldGroup>
          <FieldGroup label={uiText("Cor")}>
            <ColorPicker value={el.color} onChange={(color) => updateElement(el.id, { color })} />
          </FieldGroup>
        </EditorSection>
        {el.kind === 'node' && el.presentation === 'participant' && <PanelSection title={uiText("Sequência")}><p className="text-caption text-muted">{uiText("Conecte os participantes para criar mensagens. A ordem pode ser alterada nas propriedades da conexão; retornos usam a seta tracejada.")}</p></PanelSection>}
        <EditorSection title={uiText("Vínculos e documentação")} hint={uiText("Documentos, diagramas e evidências no código")} icon={<FileText size={16} />} open={!!el.link}>
          <Field label={uiText("Documento")}>
            <DocPicker el={el} />
          </Field>
          <Field label={uiText("Detalhar em")}>
            <DiagramPicker el={el} />
          </Field>
          <EvidenceField id={el.id} />
        </EditorSection>
        <EditorSection title={uiText("Modelo e compartilhamento")} hint={uiText("Identificador, entidade compartilhada e nível C4")} icon={<Layers size={16} />}>
          {!collaborationSession() && <Field label={uiText("Nome")}><TextField mono value={el.id} onCommit={(to) => renameElement(el.id, to)} /></Field>}
          <SharedEntityField el={el} />
        </EditorSection>
        <EditorSection title={uiText("Aparência avançada")} hint={uiText("Cores, estilo e tipografia deste componente")} icon={<Settings2 size={16} />} >
          <FieldGroup label={uiText("Cores do elemento")}>
            <Segmented<ColorMode | ''> value={el.colorMode ?? ''} options={[inherit, ...colorModes]} onChange={(v) => updateElement(el.id, { colorMode: v || null })} />
          </FieldGroup>
          <FieldGroup label={uiText("Estilo do elemento")}>
            <Segmented<StyleMode | ''> value={el.styleMode ?? ''} options={[inherit, ...styleModes]} onChange={(v) => updateElement(el.id, { styleMode: v || null })} />
          </FieldGroup>
          <FieldGroup label={uiText("Fonte do elemento")}>
            <Segmented<Typeface | ''> value={el.typeface ?? ''} options={[inherit, ...typefaces]} onChange={(v) => updateElement(el.id, { typeface: v || null })} />
          </FieldGroup>
        </EditorSection>
        <EditorSection title={uiText("Precisão")} hint={uiText("Registre e resolva pendências da arquitetura")} icon={<ShieldCheck size={16} />}><ConcernField id={el.id} /></EditorSection>
      </Scroll>
      <DeleteFooter />
    </>
  );
}

function TableFields({ el }: { el: NodeEl }) {
  const fields = el.fields ?? [];
  const update = (index: number, set: Partial<TableField>) => updateElement(el.id, { fields: fields.map((field, i) => i === index ? { ...field, ...set } : field) });
  return <PanelSection title={uiText("Campos da tabela")}>
    {fields.map((field, index) => <div key={index} className="flex flex-col gap-2 rounded-control bg-panel-2 p-3">
      <div className="flex items-center justify-between"><span className="text-caption text-muted">{uiText("Campo")} {index + 1}</span><IconButton label={uiText("Excluir campo {0}", [field.name])} onClick={() => updateElement(el.id, { fields: fields.filter((_, i) => i !== index) })}><Trash2 size={12}/></IconButton></div>
      <Field label={uiText("Nome do campo {0}", [index + 1])}><TextField value={field.name} onCommit={name => { if (name.trim()) update(index, { name: name.trim() }); else showToast(uiText("O campo precisa de um nome.")); }}/></Field>
      <Field label={uiText("Tipo do campo {0}", [index + 1])}><TextField value={field.type ?? ''} placeholder="uuid, text, timestamp…" onCommit={type => update(index, { type: type || undefined })}/></Field>
      <select aria-label={uiText("Chave do campo {0}", [index + 1])} className={inputClass} value={field.key ?? ''} onChange={event => update(index, { key: event.target.value ? event.target.value as 'PK' | 'FK' : undefined })}><option value="">{uiText("Sem chave")}</option><option value={"PK"}>{uiText("PK · Chave primária")}</option><option value={"FK"}>{uiText("FK · Chave estrangeira")}</option></select>
    </div>)}
    <Button onClick={() => {
      let name = uiText("campo");
      for (let count = 2; fields.some(field => field.name === name); count++) name = `campo_${count}`;
      updateElement(el.id, { fields: [...fields, { name, type: 'text' }] });
    }}>{uiText("Adicionar campo")}</Button>
  </PanelSection>;
}

function EdgePanel({ edge }: { edge: EdgeEl }) {
  const model = useDiagram(state => state.model);
  const messages = model.edges.filter(item => model.elements[item.from]?.presentation === 'participant' && model.elements[item.to]?.presentation === 'participant');
  const messageIndex = messages.findIndex(item => item.id === edge.id);
  const reorder = (offset: number) => {
    const state = diagramStore.getState();
    const adjacent = messages[messageIndex + offset];
    if (!adjacent) return;
    const permutation = state.model.edges.map((_, index) => index);
    const a = state.model.edges.findIndex(item => item.id === edge.id), b = state.model.edges.findIndex(item => item.id === adjacent.id);
    if (a < 0 || b < 0) return;
    [permutation[a], permutation[b]] = [permutation[b]!, permutation[a]!];
    state.apply([{ op: 'reorder', edges: permutation }]);
  };
  return (
    <>
      <PanelHeader title={uiText("Conexão")} onClose={clearSelection} closeLabel={uiText("Fechar propriedades")} />
      <div className="sk-inspector-edge-route">
        {[edge.from, edge.to].map((id, index) => <div key={`${index}:${id}`} className="flex items-center gap-3"><span className="sk-inspector-neighbor" aria-hidden><ElementGlyph el={model.elements[id]} /></span><div className="min-w-0"><p className="text-meta text-muted">{index === 0 ? uiText("Origem") : uiText("Destino")}</p><p className="truncate text-body font-medium">{model.elements[id]?.label || id}</p></div></div>)}
      </div>
      <Scroll>
        <PanelSection>
          <FieldGroup label={uiText("Tipo")}>
            <Segmented
              value={edge.connector}
              options={CONNECTORS.map((value) => ({ value, label: CONNECTOR_LABELS[value].symbol, title: CONNECTOR_LABELS[value].label }))}
              onChange={(connector) => updateEdge(edge.id, { connector })}
            />
          </FieldGroup>
          <Field label={uiText("Rótulo")}>
            <TextField value={edge.label ?? ''} placeholder={uiText("ex.: HTTPS, eventos")} onCommit={(label) => updateEdge(edge.id, { label: label || null })} />
          </Field>
          {messageIndex >= 0 ? <FieldGroup label={uiText("Mensagem {0} de {1}", [messageIndex + 1, messages.length])}><div className="flex gap-2"><Button disabled={messageIndex === 0} onClick={() => reorder(-1)}>{uiText("Subir")}</Button><Button disabled={messageIndex === messages.length - 1} onClick={() => reorder(1)}>{uiText("Descer")}</Button></div></FieldGroup> : <>
            {(['fromCardinality', 'toCardinality'] as const).map(key => <Field key={key} label={key === 'fromCardinality' ? uiText("Cardinalidade da origem") : uiText("Cardinalidade do destino")}><select aria-label={key === 'fromCardinality' ? uiText("Cardinalidade da origem") : uiText("Cardinalidade do destino")} className={inputClass} value={edge[key] ?? ''} onChange={event => updateEdge(edge.id, { [key]: event.target.value ? event.target.value as Cardinality : null })}><option value="">{uiText("Sem cardinalidade")}</option>{CARDINALITIES.map(value => <option key={value} value={value}>{({one:uiText("1 · Exatamente um"), many:uiText("1..N · Um ou mais"), 'zero-one':'0..1 · Opcional', 'zero-many':uiText("0..N · Zero ou mais")})[value]}</option>)}</select></Field>)}
          </>}
          {(['fromPort','toPort'] as const).map(key=><Field key={key} label={key==='fromPort'?uiText("Saída"):uiText("Entrada")}><select aria-label={key==='fromPort'?uiText("Porta de saída"):uiText("Porta de entrada")} className={inputClass} value={edge[key]??''} onChange={event=>updateEdge(edge.id,{[key]:event.target.value||null})}><option value="">{uiText("Automática")}</option><option value="top">{uiText("Topo")}</option><option value="right">{uiText("Direita")}</option><option value="bottom">{"Base"}</option><option value="left">{uiText("Esquerda")}</option></select></Field>)}
          <FieldGroup label={uiText("Cor")}>
            <ColorPicker value={edge.color} onChange={(color) => updateEdge(edge.id, { color })} />
          </FieldGroup>
        </PanelSection>
        <EditorSection title={uiText("Documentação e compartilhamento")} hint={uiText("Evidências e relação compartilhada")} icon={<FileText size={16} />}>
          <EvidenceField id={`edge:${edge.id}`} />
          <SharedRelationField edge={edge} />
        </EditorSection>
        <EditorSection title={uiText("Precisão")} hint={uiText("Registre e resolva pendências da conexão")} icon={<ShieldCheck size={16} />}><ConcernField id={`edge:${edge.id}`} /></EditorSection>
      </Scroll>
      <DeleteFooter />
    </>
  );
}

function MultiPanel({ nodes, total }: { nodes: string[]; total: number }) {
  return (
    <>
      <PanelHeader icon={<Layers size={14} />} title={uiText("{0} itens selecionados", [total])} onClose={clearSelection} closeLabel={uiText("Fechar propriedades")} />
      <Scroll>
        <PanelSection>
          <Button icon={<Boxes size={14} />} onClick={() => groupSelectionOrCreate({ x: 0, y: 0 })}>{uiText("Agrupar")}</Button>
          <FieldGroup label={uiText("Cor de todos")}>
            <ColorPicker onChange={(color) => updateElements(nodes, { color })} />
          </FieldGroup>
        </PanelSection>
      </Scroll>
      <DeleteFooter />
    </>
  );
}

/** Shown instead of the editing controls while an AI draft is pending. */
function LockedPanel({ reason }: { reason: string }) {
  const legend: [string, string][] = [
    ['var(--sk-diff-added)', uiText("Contorno verde: adicionado")],
    ['var(--sk-diff-removed)', uiText("Tracejado vermelho: removido")],
    ['var(--sk-diff-changed)', uiText("Ponto âmbar: alterado")],
  ];
  return (
    <>
      <PanelHeader icon={<Sparkles size={14} />} title={uiText("Proposta da IA")} />
      <PanelSection>
        <p className="text-body leading-relaxed text-muted">{reason}</p>
        <ul className="flex flex-col gap-2 text-caption">
          {legend.map(([color, text]) => (
            <li key={text} className="flex items-center gap-2.5" style={{ color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              {text}
            </li>
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

/** The panel's content; `CanvasChrome` mounts it (and animates it in and out) only while `useInspectorOpen`. */
export function Inspector() {
  const readOnly = useDiagram((s) => s.readOnly);
  const model = useDiagram((s) => s.model);
  const selection = useDiagram((s) => s.selection);
  const total = selection.nodes.length + selection.edges.length;
  const element = total === 1 && selection.nodes.length === 1 ? model.elements[selection.nodes[0]] : undefined;
  const edge = total === 1 && selection.edges.length === 1 ? model.edges.find((e) => e.id === selection.edges[0]) : undefined;
  // While it animates out (selection cleared, element deleted) it keeps showing what it last showed.
  const present = useIsPresent();
  const last = useRef<ReactNode>(null);
  const content = readOnly ? (
    <LockedPanel reason={readOnly} />
  ) : element ? (
    <ElementPanel key={element.id} el={element} />
  ) : edge ? (
    <EdgePanel key={edge.id} edge={edge} />
  ) : total > 0 ? (
    <MultiPanel nodes={selection.nodes} total={total} />
  ) : null;
  if (present && content) last.current = content;
  return <SidePanel label={uiText("Propriedades")} className="sk-inspector" overlay>{present && content ? content : last.current}</SidePanel>;
}
