import {expect,it,vi} from 'vitest';
import {repositoryAnalyzer} from './repositoryAi';
import type {AiClient,CreateParams} from './anthropic';

it('sends detected stack and evidence in the existing provider request and offers a bounded primary technology choice',async()=>{
 const facts=[{id:'web',label:'Web',path:'apps/web',primaryTechnology:'typescript',technologies:[{id:'react',refs:[{path:'apps/web/index.tsx',line:1,contains:'import React from "react";'}]}],refs:[{path:'apps/web/index.tsx',line:1,contains:'import React from "react";'}],dependencies:[]}];
 const create=vi.fn(async(_params:CreateParams)=>({content:[{type:'tool_use',name:'repository_analysis',input:{facts:[{...facts[0],primaryTechnology:'react'}],proposals:[]}}]}));
 const result=await repositoryAnalyzer({beta:{messages:{create}}} as unknown as AiClient,'controlled').analyze({files:[{path:'apps/web/index.tsx',text:'import React from "react";'}],facts,revision:'fixed-sha'});
 expect(create).toHaveBeenCalledTimes(1);
 const input=create.mock.calls[0]![0];
 expect(input.system).toContain('Never infer React from a frontend folder name');
 expect(JSON.parse(input.messages[0]!.content as string).facts[0].technologies).toEqual(facts[0]!.technologies);
 const tool=input.tools![0]!;if(!('input_schema'in tool))throw Error('Missing repository analysis tool schema');
 const schema=tool.input_schema as {properties:{facts:{items:{properties:{primaryTechnology:{enum:string[]}}}}}};
 expect(schema.properties.facts.items.properties.primaryTechnology.enum).toContain('react');
 expect(result.facts[0].primaryTechnology).toBe('react');
});
