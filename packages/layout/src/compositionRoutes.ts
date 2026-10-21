import { own } from '@strukt/core';
import type { DiagramModel, EdgeEl, ID, Port, Rect } from '@strukt/core';
import type { Point } from './route';

const cx=(r:Rect)=>r.x+r.w/2, cy=(r:Rect)=>r.y+r.h/2;

function clean(points:Point[]):Point[]{return points.filter((p,i)=>!i||p[0]!==points[i-1]![0]||p[1]!==points[i-1]![1]);}
function intersects(a:Point,b:Point,r:Rect):boolean {
  return a[0]===b[0] ? a[0]>r.x && a[0]<r.x+r.w && Math.max(a[1],b[1])>r.y && Math.min(a[1],b[1])<r.y+r.h : a[1]>r.y && a[1]<r.y+r.h && Math.max(a[0],b[0])>r.x && Math.min(a[0],b[0])<r.x+r.w;
}

/** Ports and lanes coordinated with saved architecture roles; other edges keep obstacle routing. */
export function compositionRoutes(model:DiagramModel,rects:Readonly<Record<ID,Rect>>):Record<ID,Point[]> {
 const out:Record<ID,Point[]>={};
 if(model.style.direction!=='down')return out;
 const cards=model.order.filter(id=>model.elements[id]?.presentation==='card'&&rects[id]);
 if(!cards.length)return out;
 const maxX=Math.max(...cards.map(id=>rects[id]!.x+rects[id]!.w));
 for(const edge of model.edges){
  const a=rects[edge.from],b=rects[edge.to],from=own(model.elements,edge.from),to=own(model.elements,edge.to);
  if(!a||!b||from?.presentation!=='card'||to?.presentation!=='card')continue;
  let points:Point[]|undefined;
  if(from.layoutRole==='entry'&&to.layoutRole==='shared'&&!edge.fromPort&&!edge.toPort){
   const side=maxX+40;points=[[a.x+a.w,cy(a)],[side,cy(a)],[side,cy(b)],[b.x+b.w,cy(b)]];
  }else if(from.layoutRole==='entry'&&b.y>=a.y+a.h&&!edge.fromPort&&!edge.toPort){
   const fan=model.edges.filter(e=>e.from===edge.from&&model.elements[e.to]?.layoutRole!=='shared'&&rects[e.to]).sort((e,f)=>cx(rects[e.to]!)-cx(rects[f.to]!));
   const index=fan.findIndex(e=>e.id===edge.id);
   const x=a.x+a.w*(index+1)/(fan.length+1);
   const outer=fan.filter(e=>Math.abs(cx(rects[e.to]!)-cx(a))>Math.abs(cx(b)-cx(a))).length;
   const lane=a.y+a.h+44+outer*10;
   points=[[x,a.y+a.h],[x,lane],[cx(b),lane],[cx(b),b.y]];
   if(Math.abs(cx(b)-x)<0.01)points=[[x,a.y+a.h],[cx(b),b.y]];
  }else if(to.layoutRole==='shared'&&b.y>=a.y+a.h&&cx(a)>b.x&&cx(a)<b.x+b.w&&!edge.fromPort&&!edge.toPort){
   points=[[cx(a),a.y+a.h],[cx(a),b.y]];
  }else if(Math.abs(cy(a)-cy(b))<1&&!edge.fromPort&&!edge.toPort){
   points=cx(a)<cx(b)?[[a.x+a.w,cy(a)],[b.x,cy(b)]]:[[a.x,cy(a)],[b.x+b.w,cy(b)]];

  }
  if(!points)continue;
  const route=clean(points);
  const blocked=cards.some(id=>id!==edge.from&&id!==edge.to&&route.slice(1).some((p,i)=>intersects(route[i]!,p,rects[id]!)));
  if(!blocked)out[edge.id]=route;
 }
 return out;
}
