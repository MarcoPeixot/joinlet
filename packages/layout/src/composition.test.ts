import {applyOps,computeRects,emptyModel} from '@strukt/core';
import type {DiagramOp} from '@strukt/core';
import {describe,expect,it} from 'vitest';
import {autoLayout} from './elk';
import {eraserRouter} from './eraserRouter';
import {suggestComposition} from './composition';
const ops:DiagramOp[]=[{op:'set_style',set:{direction:'down'}},...['API','Core','IA','Integrações','Insights','Mídia','Infra'].map((id):DiagramOp=>({op:'add_node',id,presentation:'card',layoutRole:id==='API'?'entry':id==='Infra'?'shared':'peer',icon:'server'})),...['Core','IA','Integrações','Insights','Mídia','Infra'].map((to):DiagramOp=>({op:'connect',from:'API',to})),{op:'connect',from:'IA',to:'Core',label:'Usuário / acesso'},{op:'connect',from:'IA',to:'Integrações',label:'Ferramentas'},{op:'connect',from:'IA',to:'Infra',label:'Jobs / dados'},{op:'connect',from:'Insights',to:'Integrações',label:'Aquisição'},{op:'connect',from:'Insights',to:'Infra',label:'Persistência'},{op:'connect',from:'Mídia',to:'Infra',label:'Arquivos / jobs'}];
const result=applyOps(emptyModel(),ops);if(!result.ok)throw new Error(result.error.message);const model=result.model;
it('keeps composition peers on one layer and stretches the common infrastructure',async()=>{
 expect(suggestComposition(model)).toEqual({entry:['API'],shared:['Infra']});
 const nodes=await autoLayout(model),rects=computeRects(model,{nodes,edges:{}});
 expect(new Set(['Core','IA','Integrações','Insights','Mídia'].map(id=>rects[id]!.y)).size).toBe(1);
 expect(rects.Infra!.w).toBeGreaterThan(1000);
 expect(rects.API!.x+rects.API!.w/2).toBeCloseTo(rects.Infra!.x+rects.Infra!.w/2);
 const routes=eraserRouter.route(model,rects);
 expect(Object.keys(routes)).toHaveLength(12);
 let bends=0,straight=0,crossings=0;const values=Object.values(routes);
 for(const points of values){bends+=points.length-2;if(points.length===2)straight++;}
 for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)for(let a=1;a<values[i]!.length;a++)for(let b=1;b<values[j]!.length;b++){
 const p=values[i]![a-1]!,q=values[i]![a]!,r=values[j]![b-1]!,s=values[j]![b]!;
 if((p[1]===q[1])===(r[1]===s[1]))continue;
 const h=p[1]===q[1]?[p,q]:[r,s],v=p[1]===q[1]?[r,s]:[p,q];
 if(v[0]![0]>Math.min(h[0]![0],h[1]![0])&&v[0]![0]<Math.max(h[0]![0],h[1]![0])&&h[0]![1]>Math.min(v[0]![1],v[1]![1])&&h[0]![1]<Math.max(v[0]![1],v[1]![1]))crossings++;
 }
 expect({straight,bends,crossings}).toEqual({straight:7,bends:10,crossings:0});
});
it('follows card ports after dragging a component',async()=>{
 const nodes=await autoLayout(model);nodes.IA={...nodes.IA!,x:nodes.IA!.x+40,y:nodes.IA!.y+80};
 const rects=computeRects(model,{nodes,edges:{}}),routes=eraserRouter.route(model,rects);
 expect(routes['IA→Infra']![0]).toEqual([rects.IA!.x+rects.IA!.w/2,rects.IA!.y+rects.IA!.h]);
});
