import { cardSize, computeRects, defaultSize, GROUP_PADDING, nodeVariant, own, visualBox } from '@strukt/core';
import type { DiagramModel, ID, NodeBox, Size } from '@strukt/core';
import { flowOrder, groupCompositionGraph, groupCompositionHints, groupFlowLevels } from './composition';
import {edgeLabelSize} from './labels';

interface Block { id: ID; w: number; h: number; nodes: Record<ID, NodeBox> }
function applicable(model: DiagramModel): boolean {
  const nodes = model.order.filter(id => model.elements[id]?.kind === 'node');
  return nodes.length > 0 && nodes.length <= 160 && nodes.every(id => {
    const el = model.elements[id]!;
    return el.kind === 'node' && (nodeVariant(el) === 'card' || nodeVariant(el) === 'icon');
  });
}

function translate(block: Block, x: number, y: number, out: Record<ID, NodeBox>): void {
  for (const [id, box] of Object.entries(block.nodes)) out[id] = { ...box, x: Math.round(box.x + x), y: Math.round(box.y + y) };
}

function columns(blocks: Block[], count: number): Block[][] {
  const out: Block[][] = Array.from({length:Math.min(count, blocks.length)}, () => []);
  const heights = out.map(() => 0);
  for (const block of blocks) {
    const slot = heights.indexOf(Math.min(...heights));
    out[slot]!.push(block); heights[slot]! += block.h + 44;
  }
  return out;
}

/** Responsibility blocks rather than an unbounded hierarchy of individual dependencies. */
export function groupCompositionLayout(model: DiagramModel, sizes: Readonly<Record<ID, Size>> = {}, origin = {x:0,y:0}): Record<ID, NodeBox> | undefined {
  if (!['right','left'].includes(model.style.direction) || !applicable(model)) return undefined;
  const graph = groupCompositionGraph(model), hints = groupCompositionHints(model);
  if (!hints || graph.groups.length > 12) return undefined;
  const children = new Map<ID, ID[]>();
  for (const id of model.order) { const parent = model.elements[id]?.parentId; if (parent) children.set(parent, [...(children.get(parent) ?? []), id]); }
  const nodeSize = (id: ID, width?: number): Size => {
    const el = model.elements[id]!, stored = own(sizes,id);
    if (el.kind === 'node' && el.presentation === 'card') {
      const natural = cardSize(el, Math.max(width ?? 284, stored?.w ?? 0, cardSize(el).w));
      return { w:natural.w, h:Math.max(natural.h, stored?.h ?? 0) };
    }
    return stored ?? defaultSize(el);
  };
  const build = (id: ID, horizontal = false): Block => {
    const el = model.elements[id]!;
    const kids = flowOrder(model,children.get(id) ?? []);
    if (el.kind !== 'group' || !kids.length) {
      const size = nodeSize(id), footprint = visualBox(el,{x:0,y:0,...size});
      return {id,w:footprint.w,h:footprint.h,nodes:{[id]:{x:-footprint.x,y:0,w:size.w,h:size.h}}};
    }
    const width = Math.max(284, ...kids.filter(child => model.elements[child]?.kind === 'node' && model.elements[child]?.presentation === 'card').map(child => nodeSize(child).w));
    const blocks = kids.map(child => {
      const node = model.elements[child]!;
      if (node.kind === 'node' && node.presentation === 'card') { const size=nodeSize(child,width); return {id:child,...size,nodes:{[child]:{x:0,y:0,...size}}}; }
      return build(child);
    });
    if(horizontal){
      const gap=Math.max(28,...model.edges.filter(edge=>edge.label&&kids.includes(edge.from)&&kids.includes(edge.to)).map(edge=>edgeLabelSize(edge.label!).w+24));
      const nodes:Record<ID,NodeBox>={};let x=GROUP_PADDING.left;
      for(const block of blocks){translate(block,x,GROUP_PADDING.top,nodes);x+=block.w+gap;}
      return {id,w:x-gap+GROUP_PADDING.right,h:GROUP_PADDING.top+Math.max(...blocks.map(block=>block.h))+GROUP_PADDING.bottom,nodes};
    }
    const contentWidth = Math.max(...blocks.map(block => block.w));
    const nodes: Record<ID,NodeBox> = {}; let y = GROUP_PADDING.top;
    for (const block of blocks) { translate(block,GROUP_PADDING.left+(contentWidth-block.w)/2,y,nodes); y+=block.h+(model.elements[block.id]?.kind==='group'?44:28); }
    return { id,w:contentWidth+GROUP_PADDING.left+GROUP_PADDING.right,h:y-(model.elements[blocks.at(-1)!.id]?.kind==='group'?44:28)+GROUP_PADDING.bottom,nodes };
  };
  const blocks = new Map(graph.roots.map(id => [id,build(id)]));
  const actors = graph.roots.filter(id => !graph.groups.includes(id) && !(graph.incoming.get(id)?.size) && (graph.outgoing.get(id)?.size ?? 0)>0).map(id=>blocks.get(id)!);
  const other = graph.roots.filter(id => !graph.groups.includes(id) && !actors.some(block=>block.id===id));
  const causal = new Set<ID>();
  for(const edge of model.edges)if(['>','<','<>'].includes(edge.connector)){
    const a=graph.owner.get(edge.from),b=graph.owner.get(edge.to);if(a&&b&&a!==b){causal.add(a);causal.add(b);}
  }
  const auxiliary = other.filter(id=>!causal.has(id));
  const support=graph.groups.filter(id=>hints.shared.includes(id)&&(graph.outgoing.get(id)?.size??0)>=3&&(graph.incoming.get(id)?.size??0)>=2);
  const levels=groupFlowLevels(model,new Set([...actors.map(block=>block.id),...support]));
  const stages=new Map<number,Block[]>();
  for(const id of [...graph.groups.filter(id=>!support.includes(id)),...other.filter(id=>!auxiliary.includes(id))]){
    const rank=levels.get(id)??0;stages.set(rank,[...(stages.get(rank)??[]),blocks.get(id)!]);
  }
  const ordered=[...stages].sort((a,b)=>a[0]-b[0]).map(([rank,units])=>({rank,units}));
  if(ordered.length>2){
    const last=ordered.at(-1)!,previous=ordered.at(-2)!;
    const sinks=last.units.every(block=>!(graph.outgoing.get(block.id)?.size));
    const small=previous.units.every(block=>Object.keys(block.nodes).length<=3);
    if(sinks&&small){previous.units.push(...last.units);ordered.pop();}
  }
  const candidates: {nodes:Record<ID,NodeBox>;width:number;score:number}[] = [];
  const choices:number[][]=[[]];
  for(const stage of ordered){const prior=choices.splice(0);for(const choice of prior)for(let count=1;count<=Math.min(2,stage.units.length);count++)choices.push([...choice,count]);}
  for (const choice of choices) {
    const lanes=[...(actors.length?[actors]:[]),...ordered.flatMap((stage,i)=>columns(stage.units,choice[i]!))].filter(lane=>lane.length);
    const gap=160;
    const laneWidths=lanes.map(lane=>Math.max(...lane.map(block=>block.w)));
    const laneHeights=lanes.map(lane=>lane.reduce((sum,block)=>sum+block.h,0)+(lane.length-1)*44);
    const width=laneWidths.reduce((a,b)=>a+b,0)+(lanes.length-1)*gap; let height=Math.max(...laneHeights);
    const out:Record<ID,NodeBox>={};let x=0;
    for(let i=0;i<lanes.length;i++) {
      let y=0;
      for(const block of lanes[i]!) { translate(block,x+(laneWidths[i]!-block.w)/2,y,out); y+=block.h+44; }
      x+=laneWidths[i]!+gap;
    }
    const mainRects=computeRects(model,{nodes:out,edges:{}});
    for(const id of auxiliary){
      const block=blocks.get(id)!;
      const owners=model.edges.flatMap(edge=>{const a=graph.owner.get(edge.from),b=graph.owner.get(edge.to);return a===id&&b!==id&&b?[b]:b===id&&a!==id&&a?[a]:[];}).filter(owner=>graph.groups.includes(owner));
      const anchor=owners.length?owners.sort((a,b)=>(levels.get(a)??0)-(levels.get(b)??0))[Math.floor(owners.length/2)]!:graph.groups[0]!;
      const r=mainRects[anchor]!;
      const occupied=auxiliary.filter(other=>other!==id).flatMap(other=>own(out,other)?[own(out,other)!]:[]);
      const y=Math.max(r.y+r.h+80,...occupied.map(box=>box.y+(box.h??84)+28));
      translate(block,r.x+(r.w-block.w)/2,y,out);height=Math.max(height,y+block.h);
    }
    for(const id of support){const block=build(id,true);translate(block,Math.max(0,(width-block.w)/2),height+80,out);height+=block.h+80;}
    const rects=computeRects(model,{nodes:out,edges:{}});
    const inputRows=actors.map(actor=>{
      const targets=model.edges.filter(edge=>edge.from===actor.id).flatMap(edge=>rects[edge.to]?[model.elements[edge.to]?.kind==='group'?rects[edge.to]!.y+22:rects[edge.to]!.y+rects[edge.to]!.h/2]:[]);
      const desired=targets.length?targets.reduce((a,b)=>a+b,0)/targets.length-actor.h/2:out[actor.id]!.y;
      return {actor,desired};
    }).sort((a,b)=>a.desired-b.desired);
    let inputBottom=0;
    for(const {actor,desired}of inputRows){out[actor.id]!.y=Math.max(inputBottom,Math.round(desired));inputBottom=out[actor.id]!.y+actor.h+28;}
    height=Math.max(height,inputBottom-28);
    let distance=0;
    for(const edge of model.edges) {
      const a=graph.owner.get(edge.from)!,b=graph.owner.get(edge.to)!;
      if(a===b)continue;
      const start=own(out,edge.from)??own(out,children.get(a)?.[0]??a), end=own(out,edge.to)??own(out,children.get(b)?.[0]??b);
      if(start&&end)distance+=Math.abs(start.x-end.x)+Math.abs(start.y-end.y);
    }
    candidates.push({nodes:out,width,score:Math.max(width/1700,height/1000)+distance/(Math.max(1,model.edges.length)*30000)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const best=candidates[0];if(!best)return undefined;
  for(const [id,box]of Object.entries(best.nodes)) {
    box.x = Math.round(origin.x+(model.style.direction==='left'?best.width-box.x-(box.w??nodeSize(id).w):box.x));
    box.y = Math.round(origin.y+box.y);
  }
  return best.nodes;
}
