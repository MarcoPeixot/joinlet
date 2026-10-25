import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { digest } from './reader';
import type { RepositoryAnalyzer, RepositoryAnalysis } from './contracts';

/** Only validated analysis responses are cached; source text is hashed, never persisted here. */
export function cachedRepositoryAnalyzer(analyzer: RepositoryAnalyzer, identity: string): RepositoryAnalyzer {
  return { identity, async analyze(input) {
    const key=digest(identity+'\n'+JSON.stringify({files:input.files,facts:input.facts}));
    const directory=join(process.env.STRUKT_CONFIG_DIR?.trim()||join(homedir(),'.config','strukt'),'repository-analysis');
    const path=join(directory,key+'.json');
    try{const raw=JSON.parse(await readFile(path,'utf8')) as {created:number;analysis:RepositoryAnalysis};if(raw.created>Date.now()-30*86400_000&&Array.isArray(raw.analysis.facts)&&Array.isArray(raw.analysis.proposals))return raw.analysis;}catch{}
    const analysis=await analyzer.analyze(input);
    const text=JSON.stringify({created:Date.now(),analysis});
    if(text.length<1_000_000){await mkdir(directory,{recursive:true,mode:0o700});const temporary=path+'.'+crypto.randomUUID()+'.tmp';try{await writeFile(temporary,text,{mode:0o600});await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
    return analysis;
  } };
}
