import { applyOps, computeRects, emptyModel, intersects, semanticView, unionRect, visualBox } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import fixture from './groupComposition.fixture.json' with {type:'json'};
import mixed from './flowComposition.fixture.json' with {type:'json'};
import { compositionOps, suggestComposition } from './composition';
import { autoLayout } from './elk';
import { groupCompositionLayout } from './groupComposition';

const course = fixture as DiagramModel;
const build = (ops: DiagramOp[]) => {
  const result = applyOps(emptyModel(),ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
};

describe('group composition', () => {
  it('keeps the full cyclic course architecture readable in a bounded scene', async () => {
    const before = semanticView(course), nodes = await autoLayout(course);
    const rects=computeRects(course,{nodes,edges:{}}), bounds=unionRect(course.order.map(id=>visualBox(course.elements[id]!,rects[id]!)))!;
    expect(bounds.w).toBeLessThan(2600);
    expect(bounds.h).toBeLessThan(1300);
    expect(16*Math.min(1360/bounds.w,800/bounds.h)).toBeGreaterThan(9);
    expect(Object.keys(nodes)).toHaveLength(31);
    expect(semanticView(course)).toEqual(before);
    const groups=course.order.filter(id=>course.elements[id]!.kind==='group');
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++)expect(intersects(rects[groups[i]!]!,rects[groups[j]!]!),`${groups[i]} / ${groups[j]}`).toBe(false);
    const cards=course.order.filter(id=>course.elements[id]!.kind==='node');
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)expect(intersects(rects[cards[i]!]!,rects[cards[j]!]!)).toBe(false);
    for(const group of groups){const kids=cards.filter(id=>course.elements[id]!.parentId===group);expect(new Set(kids.map(id=>nodes[id]!.x)).size===1||new Set(kids.map(id=>nodes[id]!.y)).size===1).toBe(true);}
  });

  it('orders the real nested example by flow and repairs stale generated roles',async()=>{
    const model=mixed as DiagramModel;
    const old=semanticView(model),hints=suggestComposition(model,true);
    expect(hints.entry).toEqual(['Frontend']);
    const result=applyOps(model,compositionOps(model,hints));if(!result.ok)throw new Error(result.error.message);
    const nodes=await autoLayout(result.model),rects=computeRects(result.model,{nodes,edges:{}});
    expect(rects.Frontend!.x+rects.Frontend!.w).toBeLessThan(rects.Borda!.x);
    expect(rects.Borda!.x+rects.Borda!.w).toBeLessThan(rects['Serviços']!.x);
    expect(rects['Serviços']!.x+rects['Serviços']!.w).toBeLessThan(rects.Dados!.x);
    expect(nodes['Load Balancer']!.y).toBeLessThan(nodes['API Gateway']!.y);
    expect(nodes.Checkout!.y).toBeLessThan(nodes.Pagamentos!.y);
    expect(nodes.Kafka!.y).toBeGreaterThan(rects['Serviços']!.y+rects['Serviços']!.h+50);
    expect(result.model.edges).toEqual(model.edges);
    expect(result.model.order).toEqual(model.order);
    expect(semanticView(model)).toEqual(old);
    expect(result.model.elements['Serviços']!.layoutRole).toBe('peer');
    const again=applyOps(result.model,compositionOps(result.model,suggestComposition(result.model,true)));if(!again.ok)throw new Error(again.error.message);
    expect(await autoLayout(again.model)).toEqual(nodes);
  });

  it('infers source groups and only structurally clear shared sinks/hubs', () => {
    expect(suggestComposition(course)).toEqual({entry:['Experiências'],shared:['Serviços transversais','Dados e operação']});
    const renamed = structuredClone(course);
    const mapping = new Map(course.order.map((id,i)=>[id,`node-${i}`]));
    renamed.elements=Object.fromEntries(course.order.map(id=>[mapping.get(id)!,{...course.elements[id]!,id:mapping.get(id)!,label:'Responsabilidade',parentId:course.elements[id]!.parentId?mapping.get(course.elements[id]!.parentId!):undefined}]));
    renamed.order=course.order.map(id=>mapping.get(id)!);
    renamed.edges=course.edges.map(edge=>({...edge,from:mapping.get(edge.from)!,to:mapping.get(edge.to)!}));
    expect(suggestComposition(renamed)).toEqual({entry:[mapping.get('Experiências')],shared:[mapping.get('Serviços transversais'),mapping.get('Dados e operação')]});
    expect(groupCompositionLayout(renamed)).toBeDefined();
  });

  it('honors group roles and preserves tables, participants and explicit flow shapes', () => {
    const mixed=build([{op:'add_group',id:'A'},{op:'add_group',id:'B'}, {op:'add_node',id:'API',parentId:'A',presentation:'card'}, {op:'add_node',id:'Data',parentId:'B',presentation:'table',fields:[{name:'id',type:'uuid',key:'PK'}]}, {op:'add_node',id:'Person',presentation:'participant'},{op:'add_node',id:'Decision',shape:'diamond'}]);
    const composed=applyOps(mixed,compositionOps(mixed,{entry:['A'],shared:['B']}));
    expect(composed.ok).toBe(true);if(!composed.ok)return;
    expect(composed.model.elements.A!.layoutRole).toBe('entry');
    expect(composed.model.elements.B!.layoutRole).toBe('shared');
    expect(composed.model.elements.Data).toEqual(mixed.elements.Data);
    expect(composed.model.elements.Person).toEqual(mixed.elements.Person);
    expect(composed.model.elements.Decision).toMatchObject({shape:'diamond'});
    expect(composed.model.elements.Decision!.presentation).toBeUndefined();
    expect(groupCompositionLayout(composed.model)).toBeUndefined();
    const peer=structuredClone(course);
    peer.elements['Dados e operação']!.layoutRole='peer';
    expect(suggestComposition(peer).shared).not.toContain('Dados e operação');
  });

  it('supports nested and empty boundaries, arbitrary names and saved card dimensions', async () => {
    const model=build([{op:'add_group',id:'Outer'},{op:'add_group',id:'Inner',parentId:'Outer'},{op:'add_group',id:'Empty'},{op:'add_node',id:'A',parentId:'Inner',presentation:'card',tech:'A large caption requiring enough height'},{op:'add_node',id:'B',presentation:'card'},{op:'connect',from:'B',to:'A'}]);
    const nodes=await autoLayout(model,{A:{w:340,h:180},Empty:{w:400,h:300}});
    const rects=computeRects(model,{nodes,edges:{}});
    expect(nodes.A).toMatchObject({w:340,h:180});
    expect(rects.Empty).toMatchObject({w:400,h:300});
    expect(intersects(rects.Outer!,rects.Empty!)).toBe(false);
    expect(rects.Outer!.w).toBeGreaterThan(rects.Inner!.w);
  });

  it('honors a leftward direction override without mutating the model', async () => {
    const right=await autoLayout(course),left=await autoLayout(course,{},'left',{x:100,y:20});
    expect(left.Produtor!.x).toBeGreaterThan(left.PostgreSQL!.x);
    expect(right.Produtor!.x).toBeLessThan(right.PostgreSQL!.x);
    expect(course.style.direction).toBe('right');
    expect(Math.min(...Object.values(left).map(box=>box.x))).toBeGreaterThanOrEqual(100);
    expect(Math.min(...Object.values(left).map(box=>box.y))).toBeGreaterThanOrEqual(20);
  });
  it('handles group endpoints named like Object.prototype properties', async()=>{
    const model=build([{op:'add_group',id:'constructor'},{op:'add_group',id:'toString'},{op:'add_node',id:'valueOf',parentId:'constructor',presentation:'card'},{op:'add_node',id:'API',parentId:'toString',presentation:'card'},{op:'connect',from:'constructor',to:'API'}]);
    const nodes=await autoLayout(model);
    expect(Object.values(nodes).every(box=>Number.isFinite(box.x)&&Number.isFinite(box.y))).toBe(true);
    expect(Object.keys(nodes)).toEqual(expect.arrayContaining(['valueOf','API']));
  });
});
