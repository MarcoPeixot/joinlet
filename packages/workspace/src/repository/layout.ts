import { autoLayout, placeNew } from '@strukt/layout';
import { defaultSize, GROUP_PADDING } from '@strukt/core';
import type { DiagramModel, LayoutState, NodeBox } from '@strukt/core';
import { parseDiagramJson } from '@strukt/json';

type Mode='modules'|'dependencies';
export interface RepositoryLayouts {
  layouts?:Partial<Record<Mode,LayoutState>>;
  generatedLayouts?:Partial<Record<Mode,LayoutState>>;
}

/** A module map is an inventory with import links: bound its width instead of creating a layer per dependency. */
export function modulePositions(model:DiagramModel):Record<string,NodeBox> {
  const pack=(id:string):{w:number;h:number;nodes:Record<string,NodeBox>}=>{
    const element=model.elements[id]!,children=model.order.filter(other=>model.elements[other]?.parentId===id);
    if(element.kind!=='group'||!children.length){const size=defaultSize(element);return {w:Math.max(220,size.w),h:Math.max(84,size.h),nodes:{[id]:{x:0,y:0,w:Math.max(220,size.w),h:Math.max(84,size.h)}}};}
    const blocks=children.map(pack),width=Math.max(...blocks.map(b=>b.w)),rows=Math.ceil(blocks.length/2);
    const height=Math.max(...blocks.map(b=>b.h)),nodes:Record<string,NodeBox>={};
    for(let i=0;i<blocks.length;i++)for(const [child,box]of Object.entries(blocks[i]!.nodes))nodes[child]={...box,x:box.x+GROUP_PADDING.left+(i%2)*(width+36),y:box.y+GROUP_PADDING.top+Math.floor(i/2)*(height+28)};
    return {w:GROUP_PADDING.left+Math.min(2,blocks.length)*width+(blocks.length>1?36:0)+GROUP_PADDING.right,h:GROUP_PADDING.top+rows*height+(rows-1)*28+GROUP_PADDING.bottom,nodes};
  };
  const roots=model.order.filter(id=>!model.elements[id]?.parentId),sections=roots.filter(id=>model.elements[id]?.kind==='group'),loose=roots.filter(id=>model.elements[id]?.kind!=='group');
  const nodes:Record<string,NodeBox>={};let y=0;
  const place=(ids:string[],gap:number)=>{const blocks=ids.map(pack);let height=0,x=0;for(const block of blocks){for(const[id,box]of Object.entries(block.nodes))nodes[id]={...box,x:box.x+x,y:box.y+y};x+=block.w+gap;height=Math.max(height,block.h);}y+=height+64;};
  for(let i=0;i<sections.length;i+=2)place(sections.slice(i,i+2),160);
  for(let i=0;i<loose.length;i+=4)place(loose.slice(i,i+4),36);
  return nodes;
}

/** Each level retains its own positions. Automatic upgrades reflow only a provably generated arrangement. */
export async function repositoryLayout(model:DiagramModel,current:LayoutState,mode:Mode,previous?:RepositoryLayouts&{base:unknown;presentation?:{view?:Mode}}) {
  const prior=previous?.presentation?.view??'dependencies';
  const layouts=structuredClone(previous?.layouts??{}),generatedLayouts=structuredClone(previous?.generatedLayouts??{});
  let layout:LayoutState={...current,nodes:{...current.nodes}},keptManual=false;
  const hasPositions=Object.keys(current.nodes).length>0;
  const automatic=async()=>{const next={nodes:mode==='modules'?modulePositions(model):model.order.length?await autoLayout(model):{},edges:{}};generatedLayouts[mode]=structuredClone(next);return next;};
  if(!hasPositions)layout=await automatic();
  else if(previous&&prior!==mode){
    layouts[prior]=structuredClone(current);
    if(layouts[mode])layout=structuredClone(layouts[mode]!);
    else {
      const base=parseDiagramJson(JSON.stringify(previous.base)).model;
      const expected=generatedLayouts[prior]??{nodes:await autoLayout(base),edges:{}};
      generatedLayouts[prior]=expected;
      const untouched=Object.entries(current.nodes).every(([id,box])=>{
        const was=expected.nodes[id];
        return was&&box.x===was.x&&box.y===was.y&&box.w===was.w&&box.h===was.h;
      });
      if(untouched)layout=await automatic();else keptManual=true;
    }
  }
  for(const id of Object.keys(layout.nodes))if(!model.elements[id])delete layout.nodes[id];
  const added=placeNew(model,layout,model.order.filter(id=>!layout.nodes[id]),model.style.direction);Object.assign(layout.nodes,added);
  if(generatedLayouts[mode])Object.assign(generatedLayouts[mode]!.nodes,added);
  // Live positions are captured on view changes, not on each drag; ordinary moves never rewrite repository state.
  return {layout,layouts,generatedLayouts,keptManual};
}
