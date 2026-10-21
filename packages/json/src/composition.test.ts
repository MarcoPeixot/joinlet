import {applyOps,emptyModel,semanticView} from '@strukt/core';
import {expect,it} from 'vitest';
import {parseDiagramJson} from './parse';
import {printDiagramJson} from './print';
it('round-trips typed fields and cardinalities and restores them through reverse diff', async () => {
 const {diffModels,compareModels}=await import('@strukt/core');
 const result=applyOps(emptyModel(),[{op:'add_node',id:'Users',presentation:'table',fields:[{name:'id',type:'uuid',key:'PK'},{name:'team_id',type:'uuid',key:'FK'}]},{op:'add_node',id:'Teams',presentation:'table',fields:[{name:'id',type:'uuid',key:'PK'}]},{op:'connect',from:'Teams',to:'Users',connector:'-',fromCardinality:'one',toCardinality:'zero-many'}]);
 if(!result.ok)throw new Error(result.error.message);
 const parsed=parseDiagramJson(printDiagramJson(result.model));
 expect(parsed.diagnostics).toEqual([]);expect(semanticView(parsed.model)).toEqual(semanticView(result.model));
 expect(diffModels(result.model,parsed.model)).toEqual([]);expect(compareModels(result.model,parsed.model).elements.changed).toEqual([]);
 const changed=applyOps(parsed.model,[{op:'update',id:'Users',set:{fields:[{name:'id',type:'bigint',key:'PK'}]}},{op:'update_edge',edgeId:parsed.model.edges[0]!.id,set:{toCardinality:'many'}}]);
 if(!changed.ok)throw new Error(changed.error.message);
 const restored=applyOps(changed.model,diffModels(changed.model,result.model));
 if(!restored.ok)throw new Error(restored.error.message);
 expect(semanticView(restored.model)).toEqual(semanticView(result.model));
});
it('round-trips scene hints and edge ports, including clear and undo diff',()=>{
 const result=applyOps(emptyModel(),[{op:'add_node',id:'API',presentation:'card',layoutRole:'entry',tech:'NestJS'},{op:'add_node',id:'Infra',presentation:'card',layoutRole:'shared'},{op:'connect',from:'API',to:'Infra',fromPort:'right',toPort:'right'}]);
 if(!result.ok)throw new Error(result.error.message);
 const parsed=parseDiagramJson(printDiagramJson(result.model));
 expect(parsed.diagnostics).toEqual([]);expect(semanticView(parsed.model)).toEqual(semanticView(result.model));
 const changed=applyOps(parsed.model,[{op:'update_edge',edgeId:parsed.model.edges[0]!.id,set:{fromPort:null,toPort:'top'}}]);
 expect(changed.ok).toBe(true);if(changed.ok)expect(changed.model.edges[0]).toMatchObject({toPort:'top'});
});

it('scene appearance and ports survive semantic diff application',async()=>{
 const {diffModels}=await import('@strukt/core');
 const before=applyOps(emptyModel(),[{op:'add_node',id:'API'},{op:'add_node',id:'Infra'},{op:'connect',from:'API',to:'Infra'}]);
 if(!before.ok)throw new Error(before.error.message);
 const after=applyOps(before.model,[{op:'update',id:'API',set:{presentation:'card',layoutRole:'entry'}},{op:'update',id:'Infra',set:{presentation:'card',layoutRole:'shared'}},{op:'update_edge',edgeId:before.model.edges[0]!.id,set:{fromPort:'right',toPort:'right'}}]);
 if(!after.ok)throw new Error(after.error.message);
 const patch=diffModels(before.model,after.model),replayed=applyOps(before.model,patch);
 expect(replayed.ok).toBe(true);if(replayed.ok)expect(semanticView(replayed.model)).toEqual(semanticView(after.model));
});
