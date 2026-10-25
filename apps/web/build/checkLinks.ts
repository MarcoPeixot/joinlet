import { marked } from 'marked';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkLinks(root:string,files:string[]):Promise<string[]>{
 const errors:string[]=[];
 const manifest=JSON.parse(await readFile(resolve(root,'.arch/strukt.json'),'utf8').catch(()=>'{}'));
 const sources=new Map<string,string>((manifest.docs??[]).filter((d:{source?:string})=>d.source).map((d:{slug:string;source:string})=>[`.arch/docs/${d.slug}.md`,d.source]));
 for(const file of files.filter(f=>/\.md$/i.test(f))){
  const text=await readFile(resolve(root,file),'utf8');const links:string[]=[];
  marked.walkTokens(marked.lexer(text),token=>{
   if(token.type==='link'||token.type==='image')links.push(token.href);
   if(token.type==='html')for(const match of token.text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi))links.push(match[1]!);
  });
  for(const raw of links){
   if(!raw||raw.startsWith('#')||/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw))continue;
   let path:string;try{path=decodeURIComponent(raw.split(/[?#]/)[0]!);}catch{errors.push(`${file}: malformed link ${raw}`);continue;}
   const base=sources.get(file)??file;
   const target=path.startsWith('/')?resolve(root,'.'+path):resolve(root,dirname(base),path);
   const rel=relative(root,target);if(rel==='..'||rel.startsWith('..'+sep)){errors.push(`${file}: link escapes repository: ${raw}`);continue;}
   try{await access(target);}catch{errors.push(`${file}: missing target ${raw} (from ${base})`);}
  }
 }
 return errors;
}
if(import.meta.main){
 const root=fileURLToPath(new URL('../../..',import.meta.url));
 const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','*.md'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 const errors=await checkLinks(root,[...new Set(files)]);for(const error of errors)console.error(error);
 if(errors.length)process.exitCode=1;else console.log(`Local Markdown links verified (${files.length} documents).`);
}
