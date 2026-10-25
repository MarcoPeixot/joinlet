import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {cleanupDirs,connectClient,diagramJson,isErrorOf,manifestOf,tempDir,textOf,writeArch} from './testing';
import {openMcpWorkspace} from './workspace';

afterEach(cleanupDirs);
async function fixture(){const root=await tempDir();await writeArch(root,{'strukt.json':JSON.stringify({...JSON.parse(manifestOf('Project',[{slug:'api',title:'API'}])),docs:[{slug:'guide',title:'Guide'}]}),'diagrams/api.strukt.json':diagramJson(),'docs/guide.md':'# Guide','board.json':JSON.stringify({version:1,cards:[{id:'diagram:api',kind:'diagram',slug:'api',x:40,y:40,w:280,h:200},{id:'doc:guide',kind:'doc',slug:'guide',x:360,y:40,w:280,h:200}],sections:[],connections:[]})});await mkdir(join(root,'src'));await writeFile(join(root,'src/index.ts'),'export const api=true;');await writeFile(join(root,'.env'),'SECRET=private');const ws=await openMcpWorkspace(root);if('error'in ws)throw Error(ws.error);return {root,ws,...await connectClient(ws)};}
it('offers grounded analysis, paginated source access and workspace organization without changing source code',async()=>{
 const {client,close,ws}=await fixture();try{
  const plan=JSON.parse(textOf(await client.callTool({name:'get_repository_analysis_plan',arguments:{locale:'pt-BR'}})));expect(plan.instructions).toContain('análise completa');expect(plan.inventory.files.map((f:any)=>f.path)).toEqual(['src/index.ts']);
  const source=JSON.parse(textOf(await client.callTool({name:'read_repository_file',arguments:{path:'src/index.ts',revision:plan.revision}})));expect(source.lines).toEqual(['export const api=true;']);
  expect(isErrorOf(await client.callTool({name:'read_repository_file',arguments:{path:'.env'}}))).toBe(true);
  expect(isErrorOf(await client.callTool({name:'organize_workspace',arguments:{ops:[{op:'move_item',kind:'doc',slug:'guide',folder:'Repository/docs'}]}}))).toBe(false);
  expect(ws.data.manifest.docs[0]!.folder).toBe('Repository/docs');
  await client.callTool({name:'connect_overview',arguments:{connections:[{from:'diagram:api',to:'doc:guide',label:'Documents'}]}});
  expect(ws.data.board.connections).toHaveLength(1);expect(ws.data.docs.guide).toBe('# Guide');
  expect(ws.data.board.cards[1]!.x).toBe(360);
  const spaced=await client.callTool({name:'space_overview',arguments:{}});expect(isErrorOf(spaced)).toBe(false);expect(JSON.parse(textOf(spaced)).files).toContain('board.json');
  expect(ws.data.board.cards[1]!.x-ws.data.board.cards[0]!.x-ws.data.board.cards[0]!.w).toBeGreaterThanOrEqual(120);
  expect(ws.data.board.connections).toHaveLength(1);expect(ws.data.docs.guide).toBe('# Guide');
  expect(isErrorOf(await client.callTool({name:'connect_overview',arguments:{connections:[{from:'diagram:api',to:'doc:missing'}]}}))).toBe(true);expect(ws.data.board.connections).toHaveLength(1);
 }finally{await close();}
});
it('uses scoped connector hooks for hosted local source reads instead of accessing the host filesystem',async()=>{
 const {client,close,ws}=await fixture();ws.root='repository:paired';const requests:unknown[]=[];
 ws.listRepositoryFiles=async options=>{requests.push(options);return {revision:'paired-revision',files:[{path:'src/main.ts',revision:'file'}],total:1,nextOffset:null};};
 ws.readRepositorySource=async(path,start,count,revision)=>{requests.push({path,start,count,revision});return {path,revision:'paired-revision',start:1,lineCount:1,lines:['paired source'],nextLine:null};};
 try{expect(JSON.parse(textOf(await client.callTool({name:'list_repository_files',arguments:{prefix:'src/',limit:1}}))).revision).toBe('paired-revision');expect(JSON.parse(textOf(await client.callTool({name:'read_repository_file',arguments:{path:'src/main.ts',revision:'paired-revision'}}))).lines).toEqual(['paired source']);expect(requests).toHaveLength(2);}finally{await close();}
});
