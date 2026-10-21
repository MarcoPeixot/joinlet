import { uiText } from '../i18n';
import { flowEdge, flowFrames, flowStepIssue } from '@strukt/workspace';
import type { Flow, FlowStep } from '@strukt/workspace';
import { ListVideo, Maximize2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { diagramStore, useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { inputClass } from '../ui/controls';
import { closeRightPanel, requestFit, showToast, uiStore } from '../ui/uiStore';
import { workspace, useWorkspace } from '../workspace/appWorkspace';
import { flowsFor } from '../workspace/lookup';

const EMPTY: Flow[] = [];
type NewKind = 'message' | 'process' | 'choice' | 'parallel' | 'goto';

function titleOf(item: FlowStep): string {
  if ('from' in item) return `${item.from} → ${item.to}`;
  if (item.kind === 'process') return uiText("Processo em {0}", [item.node]);
  if (item.kind === 'goto') return uiText("Abrir {0} em {1}", [item.flowId, item.diagram]);
  return `${item.kind === 'choice' ? uiText("Escolha") : uiText("Paralelo")}${item.title ? `: ${item.title}` : ''}`;
}

export function FlowsPanel() {
  const slug = useWorkspace((s) => s.diagram);
  const data = useWorkspace((s) => s.data);
  const flows = useWorkspace((s) => flowsFor(s.data, s.diagram) || EMPTY);
  const model = useDiagram((s) => s.model);
  const selection = useDiagram((s) => s.selection);
  const [chosen, setChosen] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [candidateNode, setCandidateNode] = useState('');
  const [newKind, setNewKind] = useState<NewKind>('message');
  const [destination, setDestination] = useState('');
  const [destinationFlow, setDestinationFlow] = useState('');
  const [branches, setBranches] = useState<Record<number, number>>({});
  const current = flows.find((flow) => flow.id === chosen) ?? flows[0];
  const frames = useMemo(() => current ? flowFrames(current, branches) : [], [current, branches]);
  const frame = frames[Math.min(step, frames.length - 1)];
  const save = (next: Flow[]) => { if (slug) workspace.setFlows(slug, next); };
  const edit = (update: (flow: Flow) => Flow) => { if (current) save(flows.map((flow) => flow.id === current.id ? update(flow) : flow)); };
  const message = (): FlowStep | null => {
    const edge = model.edges.find((item) => item.id === (candidate || selection.edges[0]));
    if (!edge) return null;
    const nth = model.edges.filter((item) => item.from === edge.from && item.to === edge.to).findIndex((item) => item.id === edge.id) + 1;
    return { from: edge.from, to: edge.to, ...(nth > 1 ? { nth } : {}) };
  };

  useEffect(() => {
    const edges = frame?.steps.flatMap((item) => { const edge = flowEdge(model, item); return edge ? [edge] : []; }) ?? [];
    const nodes = frame?.steps.flatMap((item) => item.kind === 'process' ? [item.node] : []) ?? [];
    uiStore.setState({ activeFlowEdges: edges, activeFlowNodes: nodes });
    diagramStore.getState().select({ nodes: [], edges: edges.slice(0, 1) });
  }, [frame, model]);

  useEffect(() => () => uiStore.setState({ activeFlowEdges: [], activeFlowNodes: [] }), []);

  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = window.setInterval(() => setStep((index) => (index + 1) % frames.length), 1800);
    return () => window.clearInterval(timer);
  }, [playing, frames]);

  const createFlow = () => {
    const title = window.prompt(uiText("Nome do fluxo"));
    if (!title?.trim()) return;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    save([...flows, { id, title: title.trim(), steps: [] }]);
    setChosen(id);
    setStep(0);
  };

  const addStep = () => {
    let next: FlowStep | null = null;
    if (newKind === 'message') next = message();
    if (newKind === 'process' && candidateNode) next = { kind: 'process', node: candidateNode };
    if (newKind === 'goto' && destination && destinationFlow) next = { kind: 'goto', diagram: destination, flowId: destinationFlow };
    if (newKind === 'choice' || newKind === 'parallel') next = { kind: newKind, title: newKind === 'choice' ? uiText("Escolha") : uiText("Em paralelo"), branches: [{ title: uiText("Caminho A"), steps: [] }, { title: uiText("Caminho B"), steps: [] }] };
    if (!next) { showToast(uiText("Escolha a conexão, o componente ou o fluxo de destino.")); return; }
    edit((flow) => ({ ...flow, steps: [...flow.steps, next] }));
  };

  const goToFlow = async (target: Extract<FlowStep, { kind: 'goto' }>) => {
    if (!flowsFor(data, target.diagram)?.some((flow) => flow.id === target.flowId)) { showToast(uiText("Fluxo de destino não encontrado.")); return; }
    try {
      await workspace.openDiagram(target.diagram);
      setChosen(target.flowId);
      setStep(0);
      setPlaying(false);
      requestFit();
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <SidePanel label={uiText("Fluxos guiados")}>
      <PanelHeader icon={<ListVideo size={14} />} title={uiText("Fluxos")} onClose={() => { setPlaying(false); closeRightPanel('flows'); }} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title={uiText("Cenários")}>
          {flows.map((flow) => (
            <button key={flow.id} type="button" className={`w-full rounded-control px-2 py-1.5 text-left text-body ${current?.id === flow.id ? 'bg-accent-soft text-accent' : 'hover:bg-panel-2'}`} onClick={() => { setChosen(flow.id); setStep(0); setPlaying(false); }}>
              {flow.title}
            </button>
          ))}
          {flows.length === 0 ? (
            <EmptyState
              illustration="flows"
              title={uiText("Nenhum fluxo ainda")}
              text={uiText("Conte um cenário passo a passo: quem chama quem, e em que ordem.")}
              action={{ label: uiText("Novo fluxo"), icon: <Plus size={14} />, onClick: createFlow }}
            />
          ) : (
            <Button icon={<Plus size={14} />} onClick={createFlow}>{uiText("Novo fluxo")}</Button>
          )}
        </PanelSection>
        {current && (
          <>
            <PanelSection title={uiText("Editar fluxo")}>
              <input aria-label={uiText("Nome do fluxo")} className={inputClass} value={current.title} onChange={(event) => edit((flow) => ({ ...flow, title: event.target.value }))} />
              <textarea aria-label={uiText("Descrição do fluxo")} className={inputClass} placeholder={uiText("O que este fluxo mostra?")} value={current.description ?? ''} onChange={(event) => edit((flow) => ({ ...flow, description: event.target.value }))} />
              <select aria-label={uiText("Tipo do novo passo")} className={inputClass} value={newKind} onChange={(event) => setNewKind(event.target.value as NewKind)}>
                <option value="message">{uiText("Mensagem entre componentes")}</option>
                <option value="process">{uiText("Processo em um componente")}</option>
                <option value="choice">{uiText("Escolha entre caminhos")}</option>
                <option value="parallel">{uiText("Caminhos paralelos")}</option>
                <option value="goto">{uiText("Ir para outro fluxo")}</option>
              </select>
              <select aria-label={uiText("Conexão para adicionar")} className={inputClass} value={candidate} onChange={(event) => setCandidate(event.target.value)}>
                <option value="">{uiText("Conexão selecionada no canvas")}</option>
                {model.edges.map((edge) => <option key={edge.id} value={edge.id}>{edge.from} → {edge.to}{edge.label ? ` · ${edge.label}` : ''}</option>)}
              </select>
              {newKind === 'process' && <select aria-label={uiText("Componente do processo")} className={inputClass} value={candidateNode} onChange={(event) => setCandidateNode(event.target.value)}>
                <option value="">{uiText("Selecione um componente")}</option>
                {model.order.map((id) => <option key={id} value={id}>{model.elements[id]?.label ?? id}</option>)}
              </select>}
              {newKind === 'goto' && <>
                <select aria-label={uiText("Diagrama de destino")} className={inputClass} value={destination} onChange={(event) => { setDestination(event.target.value); setDestinationFlow(''); }}>
                  <option value="">{uiText("Selecione um diagrama")}</option>
                  {data?.manifest.diagrams.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
                </select>
                <select aria-label={uiText("Fluxo de destino")} className={inputClass} value={destinationFlow} onChange={(event) => setDestinationFlow(event.target.value)}>
                  <option value="">{uiText("Selecione um fluxo")}</option>
                  {(flowsFor(data, destination) ?? []).map((flow) => <option key={flow.id} value={flow.id}>{flow.title}</option>)}
                </select>
              </>}
              <Button onClick={addStep}>{newKind === 'message' ? uiText("Adicionar conexão selecionada") : uiText("Adicionar passo")}</Button>
            </PanelSection>
            <PanelSection title={uiText("Passos")}>
              {current.steps.map((item, index) => {
                const issue = flowStepIssue(model, item, data?.flows ?? {});
                return <div key={`${index}:${titleOf(item)}`} className="rounded-control border border-line p-2">
                  <p className="text-body">{index + 1}. {titleOf(item)}{issue ? ` · ${issue.toLowerCase()}` : ''}</p>
                  <input aria-label={uiText("Nota do passo {0}", [index + 1])} className={`${inputClass} mt-1`} placeholder={uiText("Nota deste passo")} value={item.note ?? ''} onChange={(event) => edit((flow) => ({ ...flow, steps: flow.steps.map((s, i) => i === index ? { ...s, note: event.target.value } : s) }))} />
                  {(item.kind === 'choice' || item.kind === 'parallel') && <div className="mt-2 flex flex-col gap-2">
                    {item.kind === 'choice' && <select aria-label={uiText("Ramo ativo do passo {0}", [index + 1])} className={inputClass} value={branches[index] ?? 0} onChange={(event) => { setBranches({ ...branches, [index]: Number(event.target.value) }); setStep(0); }}>
                      {item.branches.map((branch, branchIndex) => <option key={branchIndex} value={branchIndex}>{branch.title}</option>)}
                    </select>}
                    {item.branches.map((branch, branchIndex) => <div key={branchIndex} className="rounded-control bg-panel-2 p-2">
                      <input aria-label={uiText("Nome do ramo {0} do passo {1}", [branchIndex + 1, index + 1])} className={inputClass} value={branch.title} onChange={(event) => edit((flow) => ({ ...flow, steps: flow.steps.map((s, i) => i === index && (s.kind === 'choice' || s.kind === 'parallel') ? { ...s, branches: s.branches.map((b, j) => j === branchIndex ? { ...b, title: event.target.value } : b) } : s) }))} />
                      {branch.steps.map((nested, nestedIndex) => <div key={nestedIndex} className="mt-1 flex items-center justify-between text-caption"><span>{titleOf(nested)}</span><button type="button" onClick={() => edit((flow) => ({ ...flow, steps: flow.steps.map((s, i) => i === index && (s.kind === 'choice' || s.kind === 'parallel') ? { ...s, branches: s.branches.map((b, j) => j === branchIndex ? { ...b, steps: b.steps.filter((_, k) => k !== nestedIndex) } : b) } : s) }))}>{uiText("Remover")}</button></div>)}
                      <button type="button" className="mt-1 text-caption text-accent" onClick={() => { const next = message(); if (!next) { showToast(uiText("Selecione uma conexão acima para este ramo.")); return; } edit((flow) => ({ ...flow, steps: flow.steps.map((s, i) => i === index && (s.kind === 'choice' || s.kind === 'parallel') ? { ...s, branches: s.branches.map((b, j) => j === branchIndex ? { ...b, steps: [...b.steps, next] } : b) } : s) })); }}>{uiText("Adicionar conexão ao ramo")}</button>
                    </div>)}
                  </div>}
                  <div className="mt-1 flex gap-2 text-caption">
                    <button type="button" disabled={index === 0} onClick={() => edit((flow) => { const steps = [...flow.steps]; [steps[index - 1], steps[index]] = [steps[index]!, steps[index - 1]!]; return { ...flow, steps }; })}>↑</button>
                    <button type="button" disabled={index === current.steps.length - 1} onClick={() => edit((flow) => { const steps = [...flow.steps]; [steps[index], steps[index + 1]] = [steps[index + 1]!, steps[index]!]; return { ...flow, steps }; })}>↓</button>
                    <button type="button" onClick={() => edit((flow) => ({ ...flow, steps: flow.steps.filter((_, i) => i !== index) }))}>{uiText("Remover")}</button>
                  </div>
                </div>;
              })}
            </PanelSection>
            {frame && <PanelSection title={uiText("Reprodução · {0}/{1}", [Math.min(step + 1, frames.length), frames.length])}>
              {frame.title && <p className="text-caption text-accent">{frame.title}</p>}
              {frame.steps.map((item, index) => <p key={index} className="text-caption">{titleOf(item)}{item.note ? ` — ${item.note}` : ''}</p>)}
              {frame.steps.map((item, index) => item.kind === 'goto' ? <Button key={index} onClick={() => void goToFlow(item)}>{uiText("Abrir fluxo")}</Button> : null)}
            </PanelSection>}
          </>
        )}
      </div>
      {current && <div className="flex gap-2 border-t border-line p-3">
        <Button onClick={() => { setPlaying(!playing); if (step >= frames.length) setStep(0); }}>{playing ? uiText("Pausar") : uiText("Reproduzir")}</Button>
        <Button onClick={() => setStep((index) => Math.max(0, index - 1))}>{uiText("Anterior")}</Button>
        <Button onClick={() => setStep((index) => Math.min(frames.length - 1, index + 1))}>{uiText("Próximo")}</Button>
        <button type="button" aria-label={uiText("Apresentar fluxo em tela cheia")} onClick={() => { const main = document.querySelector('main'); if (!main?.requestFullscreen) { showToast(uiText("Tela cheia indisponível neste navegador.")); return; } void main.requestFullscreen().then(() => requestFit()).catch(() => showToast(uiText("Não foi possível abrir a tela cheia."))); }}><Maximize2 size={14} /></button>
        <button type="button" aria-label={uiText("Excluir fluxo")} onClick={() => { if (window.confirm(uiText("Excluir o fluxo \"{0}\"?", [current.title]))) { save(flows.filter((flow) => flow.id !== current.id)); setChosen(null); setPlaying(false); } }}><Trash2 size={14} /></button>
      </div>}
    </SidePanel>
  );
}
