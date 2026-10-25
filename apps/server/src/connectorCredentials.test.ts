import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConnectorCredentials, saveConnectorCredentials } from './connectorCredentials';
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('resumes the connection for the chosen folder after another workspace has been paired',async()=>{
 const root=await mkdtemp(join(tmpdir(),'joinlet-connector-credentials-'));roots.push(root);vi.stubEnv('STRUKT_CONFIG_DIR',root);
 const origin='https://cloud.example.test',a={id:'first',token:'synthetic-a',root:'/projects/first'},b={id:'second',token:'synthetic-b',root:'/projects/second'};
 await saveConnectorCredentials(origin,a);await saveConnectorCredentials(origin,b);
 expect(await loadConnectorCredentials(origin,'/projects/first')).toMatchObject(a);
 expect(await loadConnectorCredentials(origin)).toMatchObject(b);
 await expect(loadConnectorCredentials(origin,'/projects/unpaired')).rejects.toThrow('not paired');
 await expect(loadConnectorCredentials('https://different.example.test','/projects/first')).rejects.toThrow('not paired');
 expect((await stat(join(root,'connectors'))).mode&0o077).toBe(0);
 await saveConnectorCredentials(origin,{id:'third',token:'synthetic-c',root:a.root});
 await expect(loadConnectorCredentials(origin,a.root)).rejects.toThrow('several workspaces');
});
