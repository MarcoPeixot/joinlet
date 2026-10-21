import { cardSize, defaultSize, own } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, NodeBox, Size } from '@strukt/core';

export interface CompositionHints { entry?: ID[]; shared?: ID[] }

/** A composition hub and a shared sink are suggestions; callers can supply the view's actual roles. */
export function suggestComposition(model: DiagramModel, fresh = false): CompositionHints {
  const grouped = groupCompositionHints(model,fresh);
  if (grouped) return grouped;
  const roots = model.order.filter(id => !model.elements[id]?.parentId);
  const degrees = roots.map(id => ({ id, out: model.edges.filter(e => e.from === id).length, incoming: model.edges.filter(e => e.to === id).length }));
  const hub = degrees.filter(d => d.incoming === 0 && d.out >= 3).sort((a,b) => b.out-a.out)[0];
  if (!hub) return {};
  const candidates = degrees.filter(d => d.id !== hub.id && d.out === 0 && d.incoming >= 3).sort((a,b) => b.incoming-a.incoming);
  const shared = candidates[0] && (!candidates[1] || candidates[0].incoming > candidates[1].incoming) ? [candidates[0].id] : [];
  return { entry: [hub.id], shared };
}

/** Shared by the editor and MCP; presentation-specific data stays intact. */
export function compositionOps(model: DiagramModel, hints: CompositionHints = suggestComposition(model)): DiagramOp[] {
  const entry = hints.entry ?? [], shared = hints.shared ?? [];
  const grouped = model.order.some(id => model.elements[id]?.kind === 'group' && !model.elements[id]?.parentId);
  const ops: DiagramOp[] = [];
  for (const el of Object.values(model.elements)) {
    if (el.kind === 'group') {
      if (!el.parentId) ops.push({op:'update',id:el.id,set:{layoutRole:entry.includes(el.id)?'entry':shared.includes(el.id)?'shared':'peer'}});
    } else if (el.presentation !== 'table' && el.presentation !== 'participant') {
      ops.push({op:'update',id:el.id,set:{...((!el.shape && el.presentation!=='icon') || el.presentation==='card'?{presentation:'card' as const}:{}),layoutRole:el.parentId?null:entry.includes(el.id)?'entry':shared.includes(el.id)?'shared':'peer'}});
    }
  }
  ops.push({op:'set_style',set:{direction:grouped?'right':'down',typeface:'clean',styleMode:'plain'}});
  return ops;
}

/** Top-level architecture layers; flow/hierarchical placement is still ELK's responsibility. */
export function compositionLayout(model: DiagramModel, sizes: Readonly<Record<ID,Size>> = {}, origin = {x:0,y:0}): Record<ID,NodeBox> | undefined {
  if (model.style.direction !== 'down') return undefined;
  const roots = model.order.filter(id => !model.elements[id]?.parentId);
  if (roots.some(id => model.elements[id]?.kind === 'group')) return undefined;
  const entry = roots.filter(id => model.elements[id]?.layoutRole === 'entry');
  if (!entry.length) return undefined;
  const shared = roots.filter(id => model.elements[id]?.layoutRole === 'shared');
  const peers = roots.filter(id => !entry.includes(id) && !shared.includes(id));
  const rows = [entry,peers,shared].filter(row => row.length);
  const gap = 120, layerGap = 140;
  const dimensions = Object.fromEntries(roots.map(id => {
    const el=model.elements[id]!;
    const stored=own(sizes,id), natural=el.kind==='node'&&el.presentation==='card'?cardSize(el,stored?.w):defaultSize(el);
    return [id, stored ? {w:stored.w,h:Math.max(stored.h,natural.h)} : natural];
  }));
  const width = Math.max(...rows.map(row => row.reduce((sum,id)=>sum+dimensions[id]!.w,0)+(row.length-1)*gap));
  const out: Record<ID,NodeBox> = {};
  let y=origin.y;
  for(const row of rows){
    if(row===shared && row.length===1) dimensions[row[0]!] = {...dimensions[row[0]!]!,w:width};
    const rowWidth=row.reduce((sum,id)=>sum+dimensions[id]!.w,0)+(row.length-1)*gap;
    const height=Math.max(...row.map(id=>dimensions[id]!.h));
    let x=origin.x+(width-rowWidth)/2;
    for(const id of row){const size=dimensions[id]!;out[id]={x:Math.round(x),y:Math.round(y+(height-size.h)/2),w:size.w,h:size.h};x+=size.w+gap;}
    y+=height+layerGap;
  }
  return out;
}

interface GroupGraph { groups: ID[]; roots: ID[]; owner: Map<ID, ID>; incoming: Map<ID, Set<ID>>; outgoing: Map<ID, Set<ID>>; inputs: Map<ID, number> }

export function groupCompositionGraph(model: DiagramModel): GroupGraph {
  const roots = model.order.filter(id => !model.elements[id]?.parentId);
  const groups = roots.filter(id => model.elements[id]?.kind === 'group');
  const owner = new Map<ID, ID>();
  for (const id of model.order) {
    let root = id;
    const seen = new Set<ID>();
    while (model.elements[root]?.parentId && !seen.has(root)) { seen.add(root); root = model.elements[root]!.parentId!; }
    owner.set(id, root);
  }
  const incoming = new Map<ID, Set<ID>>(), outgoing = new Map<ID, Set<ID>>(), inputs = new Map<ID, number>();
  for (const edge of model.edges) {
    const a = owner.get(edge.from), b = owner.get(edge.to);
    if (!a || !b || a === b) continue;
    outgoing.set(a, new Set([...(outgoing.get(a) ?? []), b]));
    incoming.set(b, new Set([...(incoming.get(b) ?? []), a]));
  }
  for(const edge of model.edges){const a=owner.get(edge.from),b=owner.get(edge.to);if(a&&b&&!groups.includes(a)&&groups.includes(b)&&!incoming.get(a)?.size)inputs.set(b,(inputs.get(b)??0)+1);}
  return { groups, roots, owner, incoming, outgoing, inputs };
}

export function groupCompositionHints(model: DiagramModel, fresh = false): { entry: ID[]; shared: ID[] } | undefined {
  const graph = groupCompositionGraph(model);
  if (graph.groups.length < 2) return undefined;
  const inferred = graph.groups.filter(id => fresh || !model.elements[id]?.layoutRole);
  const byInput = [...inferred].sort((a,b) => (graph.inputs.get(b) ?? 0) - (graph.inputs.get(a) ?? 0));
  const entry = fresh ? [] : graph.groups.filter(id => model.elements[id]?.layoutRole === 'entry');
  if (!entry.length) entry.push(...byInput.filter(id => (graph.inputs.get(id) ?? 0) > 0 && graph.inputs.get(id) === graph.inputs.get(byInput[0]!)).slice(0, 2));
  if (!entry.length) entry.push(...inferred.filter(id => !(graph.incoming.get(id)?.size)).slice(0, 2));
  if (!entry.length && inferred.length) entry.push(inferred[0]!);
  const explicit = fresh ? [] : graph.groups.filter(id => model.elements[id]?.layoutRole === 'shared');
  if (explicit.length) return { entry, shared: explicit.filter(id => !entry.includes(id)) };
  const hubs = inferred.filter(id => !entry.includes(id)).sort((a,b) => (graph.outgoing.get(b)?.size ?? 0) - (graph.outgoing.get(a)?.size ?? 0));
  const largestFan = graph.outgoing.get(hubs[0]!)?.size ?? 0;
  const shared = inferred.filter(id => !entry.includes(id) && (
    !graph.outgoing.get(id)?.size ||
    (largestFan >= 3 && id === hubs[0] && largestFan > (graph.outgoing.get(hubs[1]!)?.size ?? 0) && (graph.incoming.get(id)?.size ?? 0) >= 2)
  ));
  return { entry, shared };
}

/** Causal layers of top-level blocks; event feedback does not reverse the primary reading order. */
export function groupFlowLevels(model: DiagramModel, omitted: ReadonlySet<ID> = new Set()): Map<ID, number> {
  const graph=groupCompositionGraph(model), roots=graph.roots.filter(id=>!omitted.has(id));
  const next=new Map(roots.map(id=>[id,new Set<ID>()])), previous=new Map(roots.map(id=>[id,new Set<ID>()]));
  const link=(from:ID,to:ID)=>{const a=graph.owner.get(from),b=graph.owner.get(to);if(a&&b&&a!==b&&next.has(a)&&next.has(b)){next.get(a)!.add(b);previous.get(b)!.add(a);}};
  for(const edge of model.edges){
    if(edge.connector==='>')link(edge.from,edge.to);
    else if(edge.connector==='<')link(edge.to,edge.from);
    else if(edge.connector==='<>'){link(edge.from,edge.to);link(edge.to,edge.from);}
  }
  const visited=new Set<ID>(),order:ID[]=[];
  const visit=(id:ID)=>{if(visited.has(id))return;visited.add(id);for(const to of next.get(id)!)visit(to);order.push(id);};
  for(const id of roots)visit(id);
  const component=new Map<ID,number>();let count=0;
  const assign=(id:ID,n:number)=>{if(component.has(id))return;component.set(id,n);for(const from of previous.get(id)!)assign(from,n);};
  for(const id of order.reverse())if(!component.has(id))assign(id,count++);
  const links=Array.from({length:count},()=>new Set<number>()),degree=Array(count).fill(0) as number[],ranks=Array(count).fill(0) as number[];
  for(const [from,tos]of next)for(const to of tos){const a=component.get(from)!,b=component.get(to)!;if(a!==b&&!links[a]!.has(b)){links[a]!.add(b);degree[b]!++;}}
  const queue=degree.flatMap((d,i)=>d===0?[i]:[]);
  for(let at=0;at<queue.length;at++){const from=queue[at]!;for(const to of links[from]!){ranks[to]=Math.max(ranks[to]!,ranks[from]!+1);if(--degree[to]===0)queue.push(to);}}
  const levels=new Map(roots.map(id=>[id,ranks[component.get(id)!]!]));
  for(const id of roots){
    if(model.elements[id]?.kind==='group'||next.get(id)!.size||previous.get(id)!.size)continue;
    const neighbors=model.edges.flatMap(edge=>{const a=graph.owner.get(edge.from),b=graph.owner.get(edge.to);return a===id&&b!==id&&b? [b]:b===id&&a!==id&&a?[a]:[];}).filter(other=>model.elements[other]?.kind==='group');
    if(neighbors.length)levels.set(id,Math.round(neighbors.reduce((sum,other)=>sum+(levels.get(other)??0),0)/neighbors.length));
  }
  return levels;
}

/** Stable dependency order inside a block, including nested groups. */
export function flowOrder(model:DiagramModel,ids:readonly ID[]):ID[]{
  const allowed=new Set(ids),owner=(id:ID)=>{const seen=new Set<ID>();while(!allowed.has(id)&&model.elements[id]?.parentId&&!seen.has(id)){seen.add(id);id=model.elements[id]!.parentId!;}return allowed.has(id)?id:undefined;};
  const edges=model.edges.flatMap(edge=>{if(edge.connector!=='>'&&edge.connector!=='<')return[];const a=owner(edge.connector==='<'?edge.to:edge.from),b=owner(edge.connector==='<'?edge.from:edge.to);return a&&b&&a!==b?[[a,b] as const]:[];});
  const remaining=new Set(ids),out:ID[]=[];
  while(remaining.size){const ready=ids.filter(id=>remaining.has(id)&&!edges.some(([a,b])=>b===id&&remaining.has(a)));const batch=ready.length?ready:[ids.find(id=>remaining.has(id))!];for(const id of batch){out.push(id);remaining.delete(id);}}
  return out;
}
