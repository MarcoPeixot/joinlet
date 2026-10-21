export const DIAGRAM_UI_URI = 'ui://strukt/diagram.html';
export const DIAGRAM_UI_MIME = 'text/html;profile=mcp-app';

export const diagramUiHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{font:14px system-ui,sans-serif;color-scheme:light dark}body{margin:0;padding:16px;background:Canvas;color:CanvasText}
h1{font-size:16px;margin:0 0 12px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px}
svg{width:100%;min-height:320px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:10px;background:Canvas}
aside{border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:10px;padding:12px}
.node{cursor:pointer}.node .body{fill:Canvas;stroke:#7460cc;stroke-width:1.5}.node .detail{fill:none;stroke:#7460cc;stroke-width:1.5}.node.group .body{fill:none;stroke:#a69caf;stroke-dasharray:5 3}.node:focus .body,.node:hover .body{stroke-width:3}
.node text{fill:CanvasText;font-size:13px}.edge{stroke:#857c9b;stroke-width:1.4;fill:none}.edge-label{fill:CanvasText;font-size:11px}
@media(max-width:620px){.layout{grid-template-columns:1fr}}
</style></head><body><h1 id="title">Diagrama</h1><div class="layout"><svg id="diagram" role="img" aria-label="Diagrama interativo"></svg><aside id="details">Selecione um componente para ver seus detalhes.</aside></div>
<script>
const ns='http://www.w3.org/2000/svg';
const svg=document.getElementById('diagram');
const details=document.getElementById('details');
function shape(tag,attrs,parent=svg){const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));parent.appendChild(el);return el}
function render(data){
  document.getElementById('title').textContent=data.title||'Diagrama';svg.replaceChildren();
  const nodes=data.nodes||[],edges=data.edges||[],positions={};
  nodes.forEach((node,i)=>{const box=data.layout?.[node.id];positions[node.id]=box&&Number.isFinite(box.x)&&Number.isFinite(box.y)?{x:box.x,y:box.y,w:box.w||160,h:box.h||64}:{x:(i%4)*220,y:Math.floor(i/4)*120,w:160,h:64}});
  const boxes=Object.values(positions);const minX=Math.min(0,...boxes.map(box=>box.x))-24,minY=Math.min(0,...boxes.map(box=>box.y))-24;
  const maxX=Math.max(400,...boxes.map(box=>box.x+box.w))+24,maxY=Math.max(280,...boxes.map(box=>box.y+box.h))+24;
  svg.setAttribute('viewBox',[minX,minY,maxX-minX,maxY-minY].join(' '));
  const defs=shape('defs',{}),marker=shape('marker',{id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);shape('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#857c9b'},marker);
  const participants=new Set(nodes.filter(node=>node.presentation==='participant').map(node=>node.id));
  const sequenceTop=Math.max(0,...nodes.filter(node=>participants.has(node.id)).map(node=>positions[node.id].y+(node.headerHeight||64)))+48;let sequenceIndex=0;
  const cardinalityNames={'one':'1','many':'1..N','zero-one':'0..1','zero-many':'0..N'};
  function boundary(box,target){const cx=box.x+box.w/2,cy=box.y+box.h/2,dx=target.x+target.w/2-cx,dy=target.y+target.h/2-cy;const scale=Math.min(dx?box.w/2/Math.abs(dx):Infinity,dy?box.h/2/Math.abs(dy):Infinity);return Number.isFinite(scale)?[cx+dx*scale,cy+dy*scale]:[cx,cy]}
  edges.forEach(edge=>{const a=positions[edge.from],b=positions[edge.to];if(!a||!b)return;const sequence=participants.has(edge.from)&&participants.has(edge.to),order=sequence?++sequenceIndex:0;
    const message=data.messages?.[edge.id],from=boundary(a,b),to=boundary(b,a),x1=sequence?a.x+a.w/2:from[0],x2=sequence?b.x+b.w/2:to[0],y1=sequence?sequenceTop+(order-1)*64:from[1],y2=sequence?y1:to[1];
    const attrs={x1,y1,x2,y2,class:'edge'};if(['>','<>','-->'].includes(edge.connector||'>')&&!edge.toCardinality)attrs['marker-end']='url(#arrow)';if(['<','<>'].includes(edge.connector)&&!edge.fromCardinality)attrs['marker-start']='url(#arrow)';if(['--','-->'].includes(edge.connector))attrs['stroke-dasharray']='6 5';shape('line',attrs);
    if(edge.label||order){const label=shape('text',{x:message?.label?.[0]??(x1+x2)/2,y:message?.label?.[1]??((y1+y2)/2-8),class:'edge-label','text-anchor':'middle'});label.textContent=(order?order+'. ':'')+(edge.label||'')}
    for(const [key,x,y,tx,ty] of [['fromCardinality',x1,y1,x2,y2],['toCardinality',x2,y2,x1,y1]])if(edge[key]){const length=Math.hypot(tx-x,ty-y)||1,dx=(tx-x)/length,dy=(ty-y)/length;const label=shape('text',{x:x+dx*20-dy*10,y:y+dy*20+dx*10,class:'edge-label','text-anchor':'middle'});label.textContent=cardinalityNames[edge[key]]}
  });
  [...nodes].sort((a,b)=>(a.kind==='group'?0:1)-(b.kind==='group'?0:1)).forEach(node=>{
    const box=positions[node.id],group=shape('g',{class:node.kind==='group'?'node group':'node',transform:'translate('+box.x+' '+box.y+')',tabindex:0,role:'button','aria-label':node.label||node.id});
    const rich=node.presentation==='table'||node.presentation==='participant',header=node.headerHeight||64;
    if(node.presentation==='participant')shape('line',{x1:box.w/2,y1:header,x2:box.w/2,y2:box.h,class:'edge','stroke-dasharray':'6 5','stroke-opacity':0.4},group);
    if(rich)shape('rect',{width:box.w,height:node.presentation==='participant'?header:box.h,rx:10,class:'body'},group);
    else if(node.geometry){shape('path',{d:node.geometry.d,class:'body'},group);if(node.geometry.detail)shape('path',{d:node.geometry.detail,class:'detail'},group)}else shape('rect',{width:box.w,height:box.h,rx:8,class:'body'},group);
    if(node.presentation==='table'){
      shape('line',{x1:0,y1:header,x2:box.w,y2:header,class:'edge'},group);
      (node.fields||[]).forEach((field,index)=>{const y=header+index*32;if(index)shape('line',{x1:0,y1:y,x2:box.w,y2:y,class:'edge','stroke-opacity':0.3},group);
        const name=shape('text',{x:12,y:y+21},group);name.textContent=(field.key?field.key+' · ':'')+field.name;const type=shape('text',{x:box.w-12,y:y+21,'text-anchor':'end','font-size':11},group);type.textContent=field.type||'';
      });
    }
    const lb=rich?{x:0,y:0,w:box.w,h:header}:node.labelBox||{x:0,y:0,w:box.w,h:box.h},lines=rich?[node.label||node.id]:node.lines||[node.label||node.id];
    const label=shape('text',{x:lb.x+lb.w/2,y:lb.y+lb.h/2-(lines.length-1)*8+4,'text-anchor':'middle'},group);
    lines.forEach((line,i)=>{const span=shape('tspan',{x:lb.x+lb.w/2,dy:i?16:0},label);span.textContent=line});
    const show=()=>{details.replaceChildren();const heading=document.createElement('strong');heading.textContent=node.label||node.id;details.append(heading);for(const value of [node.tech,node.description,...(node.fields||[]).map(field=>(field.key?field.key+' · ':'')+field.name+(field.type?' : '+field.type:''))])if(value){const p=document.createElement('p');p.textContent=value;details.append(p)}};
    group.addEventListener('click',show);group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show()}})
  });
}
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(message?.id===1&&message.result){window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');return}if(message?.method==='ui/notifications/tool-result'){const data=message.params?.structuredContent;if(data?.nodes)render(data)}});
window.parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'strukt-diagram',version:'1.0.0'},appCapabilities:{}}},'*');
</script></body></html>`;
