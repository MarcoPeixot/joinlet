import { Parser, Language, type Node } from 'web-tree-sitter';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const EXTRACTION_VERSION = 'syntax-v1-evidence-v2';
import type { ImportUsage, SyntaxImport, SyntaxResult } from './contracts';
export type { SyntaxResult } from './contracts';
const extensions: Record<string, string> = { js:'javascript',jsx:'javascript',mjsx:'javascript',cjsx:'javascript',mtsx:'tsx',ctsx:'tsx',mjs:'javascript',cjs:'javascript',ts:'typescript',mts:'typescript',cts:'typescript',tsx:'tsx',py:'python',java:'java',go:'go',rs:'rust',rb:'ruby',php:'php',cs:'c_sharp',fs:'fsharp',c:'c',h:'c',cpp:'cpp',swift:'swift',kt:'kotlin',kts:'kotlin',scala:'scala' };
const languages = new Map<string, Promise<Language>>();
let initialization: Promise<void> | undefined;
let manifest: { assets: { file: string; sha256: string }[] };
function asset(file: string): Uint8Array {
  const source = fileURLToPath(new URL('../../parsers/', import.meta.url));
  const root = existsSync(join(source,'manifest.json')) ? source : join(dirname(process.execPath),'parsers');
  manifest ??= JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
  const bytes = readFileSync(join(root,file));
  if (manifest.assets.find(a=>a.file===file)?.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error(`Parser asset failed integrity verification: ${file}`);
  return bytes;
}
async function language(name: string): Promise<Language> {
  initialization ??= Parser.init({ wasmBinary: asset('web-tree-sitter.wasm') });
  await initialization;
  let loaded = languages.get(name);
  if (!loaded) { loaded = Language.load(asset(`tree-sitter-${name}.wasm`)); languages.set(name,loaded); }
  return loaded;
}
const nc=(node:Node|null|undefined):Node[] => (node?.namedChildren??[]).filter((child):child is Node=>child!==null);
const literal = (node: Node | null | undefined): string | null => {
  if (!node) return null;
  if(node.type==='parenthesized_expression')return literal(nc(node)[0]);
  if (['template_string','string','string_literal','interpreted_string_literal','raw_string_literal','encapsed_string','string_value','system_lib_string'].includes(node.type)) {
    if (nc(node).some(c=>/interpolation|substitution|escape_sequence/.test(c.type))) return null;
    return node.text.replace(/^[rubf]*(["'`<])|["'`>]$/gi,'');
  }
  return null;
};
function descendants(node: Node, accept: (node: Node) => void): void {
  const pending=[node];
  while(pending.length){const current=pending.pop()!;if(current.type==='comment'||current.type.endsWith('_comment'))continue;accept(current);const children=nc(current);for(let i=children.length-1;i>=0;i--)pending.push(children[i]!);}
}
/** Declaration syntax only. The analyzed repository is never imported, compiled or executed. */
export async function parseSource(path: string, text: string): Promise<SyntaxResult> {
  const extension = extname(path).slice(1).toLowerCase();
  const result: SyntaxResult = { imports: [], declarations: [], limitations: [] };
  if (['vue','svelte','astro'].includes(extension)) {
    // Parse containers as HTML; only script bodies and Astro frontmatter are source programs.
    let html = text;
    if (extension==='astro' && /^---\r?\n/.test(text)) {
      const end = /^---\s*$/gm; end.lastIndex=text.indexOf('\n')+1; const match=end.exec(text);
      if (match) { const start=text.indexOf('\n')+1; const part=await parseSource(path+'.ts', '\n'+text.slice(start,match.index)); result.imports.push(...part.imports);result.limitations.push(...part.limitations);html=text.slice(0,match.index+match[0].length).replace(/[^\r\n]/g,' ')+text.slice(match.index+match[0].length); }
      else {result.limitations.push('Unterminated Astro frontmatter.');return result;}
    }
    const grammar=await language('html');const parser=new Parser(); parser.setLanguage(grammar); const tree=parser.parse(html)!;
    const bodies: { body:Node; ts:boolean }[]=[];
    descendants(tree.rootNode,node=>{if(node.type==='script_element'){
      const body=nc(node).find(child=>child.type==='raw_text'),tag=nc(node).find(child=>child.type==='start_tag');
      const attribute=nc(tag).find(child=>child.type==='attribute'&&nc(child).some(part=>part.type==='attribute_name'&&part.text==='lang'));
      const value=nc(attribute).find(child=>child.type==='quoted_attribute_value'||child.type==='attribute_value');
      const lang=value?.text.replace(/^["']|["']$/g,'')??'js';
      if(!['js','javascript','ts','typescript'].includes(lang)){result.limitations.push(`Unsupported script language: ${lang}.`);return;}
      if(body)bodies.push({body,ts:lang==='ts'||lang==='typescript'});
    }});
    for(const {body,ts} of bodies){const part=await parseSource(path+(ts?'.ts':'.js'),'\n'.repeat(body.startPosition.row)+body.text);result.imports.push(...part.imports);result.limitations.push(...part.limitations);}
    tree.delete();parser.delete();return result;
  }
  const name=extensions[extension]; if (!name) return result;
  const grammar=await language(name);const parser=new Parser(); parser.setLanguage(grammar);
  const deadline=performance.now()+2000;
  const tree=parser.parse(text.endsWith("\n")?text:text+"\n",null,{progressCallback:()=>performance.now()>deadline});
  if(!tree){parser.delete();return {...result,limitations:['Syntax parsing budget exceeded.']};}
  const anchors=new Map<SyntaxImport,{start:number;end:number}>();
  const add=(node:Node,target:string|null,usage:ImportUsage='value',local=false)=>{
    if(target===null){result.limitations.push(`Dynamic or unresolved reference at line ${node.startPosition.row+1}, column ${node.startPosition.column+1}.`);return;}
    if(!target || target.includes('\0'))return;
    const ref={name:target,line:node.startPosition.row+1,contains:node.text.split(/\r?\n/)[0]!.trim().slice(0,400),usage,...(local?{local:true}:{})};
    if(!result.imports.some(r=>r.name===ref.name&&r.line===ref.line&&r.usage===ref.usage)){result.imports.push(ref);anchors.set(ref,{start:node.startIndex,end:node.endIndex});}
  };
  // A local binding can shadow a loader. Conservatively omit calls rather than invent an import.
  const shadowed=new Set<string>();
  const bind=(pattern:Node|null|undefined)=>{
    const pending=pattern?[pattern]:[];
    while(pending.length){const part=pending.pop()!;
      if(['identifier','shorthand_property_identifier_pattern'].includes(part.type)){if(/^(require|require_relative|autoload|__import__)$/.test(part.text))shadowed.add(part.text);continue;}
      const field=part.childForFieldName('alias')??part.childForFieldName('pattern')??part.childForFieldName('name')??part.childForFieldName('left')??(part.type==='pair_pattern'?part.childForFieldName('value'):null);
      if(field){pending.push(field);continue;}
      if(['formal_parameters','parameters','method_parameters','object_pattern','array_pattern','rest_pattern','list_splat_pattern','dictionary_splat_pattern','namespace_import'].includes(part.type))pending.push(...nc(part));
      else if(['typed_parameter','typed_default_parameter'].includes(part.type)){const first=nc(part)[0];if(first)pending.push(first);}
    }
  };
  if(['javascript','typescript','tsx','python','ruby','php'].includes(name))descendants(tree.rootNode,node=>{
    if(['variable_declarator','function_declaration','function_definition','class_declaration','class_definition','parameter','required_parameter','optional_parameter','assignment','method','catch_clause'].includes(node.type))bind(node.childForFieldName('name')??node.childForFieldName('left')??node.childForFieldName('pattern')??node.childForFieldName('parameter'));
    if(['formal_parameters','parameters','method_parameters','import_specifier','namespace_import','aliased_import'].includes(node.type))bind(node);
    if(node.type==='arrow_function')bind(node.childForFieldName('parameter'));
    if(node.type==='import_clause')for(const child of nc(node))if(child.type==='identifier')bind(child);
  });
  descendants(tree.rootNode,node=>{
    if(node.type==='ERROR'||node.isMissing){result.limitations.push(`Invalid syntax at line ${node.startPosition.row+1}.`);return;}
    if(node.hasError)return;
    const field=(key:string)=>node.childForFieldName(key);
    if(['javascript','typescript','tsx'].includes(name)){
      if(['import_statement','export_statement'].includes(node.type)){
        const source=field('source');if(!source)return;
        const clause=nc(node).find(c=>c.type==='import_clause'||c.type==='export_clause');
        const specifiers:Node[]=[];if(clause)descendants(clause,n=>{if(['import_specifier','export_specifier'].includes(n.type))specifiers.push(n);});
        const typeOnly=/^(?:import|export)\s+type\b/.test(node.text)||(!!specifiers.length&&specifiers.every(n=>/^type\s/.test(n.text))&&!nc(clause).some(c=>['identifier','namespace_import'].includes(c.type)));
        add(source,literal(source),typeOnly?'type':'value');
        if(!typeOnly&&specifiers.some(n=>/^type\s/.test(n.text)))add(source,literal(source),'type');
      }
      if(node.type==='call_expression'){
        const fn=field('function'),args=nc(field('arguments'));
        if(fn?.type==='import'||fn?.text==='require'&&!shadowed.has('require'))add(node,args?.length===1?literal(args[0]):null);
        else if(fn?.text==='require'&&shadowed.has('require'))result.limitations.push(`Locally bound require at line ${node.startPosition.row+1}; loader identity is not proven.`);
      }
    }else if(name==='python'){
      if(node.type==='import_statement')for(const child of nc(node)){const module=child.type==='aliased_import'?child.childForFieldName('name'):child;add(module!,module!.text);}
      if(node.type==='import_from_statement'){
        const module=field('module_name');
        if(module){
          if(/^\.+$/.test(module.text)){
            for(const child of node.childrenForFieldName('name'))if(child)add(child,module.text+child.text,'value',true);
          }else add(module,module.text,'value',module.text.startsWith('.'));
        }
      }
      if(node.type==='call'&&field('function')?.text==='__import__'){if(!shadowed.has('__import__'))add(node,literal(nc(field('arguments'))[0]));else result.limitations.push(`Locally bound __import__ at line ${node.startPosition.row+1}; loader identity is not proven.`);}
      let parent=node.parent;
      if(node.type==='import_statement'||node.type==='import_from_statement')while(parent){if(parent.type==='if_statement'&&/^(?:if\s+(?:typing\.)?TYPE_CHECKING)\b/.test(parent.text)){for(const entry of result.imports)if(entry.line>=node.startPosition.row+1&&entry.line<=node.endPosition.row+1)entry.usage='type';break;}parent=parent.parent;}
    }else if(name==='go'&&node.type==='import_spec')add(field('path')??node,literal(field('path')));
    else if(['c','cpp'].includes(name)&&node.type==='preproc_include')add(field('path')??node,literal(field('path')),'include',field('path')?.type==='string_literal');
    else if(name==='cpp'&&node.type==='declaration'&&field('type')?.text==='import')add(node,field('declarator')?.text??null);
    else if(['java','kotlin','scala','swift','c_sharp','fsharp','rust','php'].includes(name)){
      const types:Record<string,string[]>={java:['import_declaration'],kotlin:['import_header'],scala:['import_declaration'],swift:['import_declaration'],c_sharp:['using_directive'],fsharp:['import_decl','preproc_directive','fsi_directive_decl'],rust:['use_declaration','extern_crate_declaration','mod_item'],php:['namespace_use_declaration','include_expression','require_expression','include_once_expression','require_once_expression']};
      if(name==='rust'&&node.type==='macro_invocation'&&field('macro')?.text==='include')add(node,literal(nc(nc(node).find(c=>c.type==='token_tree'))[0]),'include',true);
      if(types[name]?.includes(node.type)){
        if(name==='fsharp'&&node.type!=='import_decl'&&!/^#(?:load|r)\b/.test(node.text))return;
        if(name==='scala'&&node.type==='import_declaration'){for(const path of node.childrenForFieldName('path'))if(path)add(path,path.text.replace(/\._$/,''));return;}
        if(name==='php'&&node.type==='namespace_use_declaration'){
          const prefix=nc(node).find(child=>child.type==='namespace_name')?.text;
          const clauses=nc(node).filter(child=>child.type==='namespace_use_clause');
          const group=nc(node).find(child=>child.type==='namespace_use_group');if(group)clauses.push(...nc(group));
          for(const clause of clauses){const target=nc(clause).find(child=>['qualified_name','namespace_name','name'].includes(child.type));if(target)add(node,(prefix?prefix+'\\':'')+target.text);}
          return;
        }

        if(name==='rust'&&node.type==='use_declaration'){
          const use=(part:Node,prefix='')=>{if(part.type==='use_list'){for(const child of nc(part))use(child,prefix);}else if(part.type==='scoped_use_list'){const path=part.childForFieldName('path'),list=part.childForFieldName('list');if(list)use(list,prefix+(path?.text??'')+'::');}else if(part.type==='use_as_clause'){const path=part.childForFieldName('path')??nc(part)[0];if(path)use(path,prefix);}else{const target=prefix+part.text;add(node,target,'value',/^(?:crate|self|super)::/.test(target));}};
          const argument=field('argument');if(argument)use(argument);return;
        }
        if(name==='php'&&/^(?:include|require)(?:_once)?_expression$/.test(node.type)){add(node,literal(nc(node)[0]),'include',true);return;}

        if(name==='rust'&&node.type==='mod_item'&&nc(node).some(c=>c.type==='declaration_list'))return;
        const string=nc(node).find(c=>literal(c)!==null);
        if(string)add(string,literal(string),'value',true);
        else {
          const raw=node.text.replace(/^(?:global\s+)?(?:import|using|open|use|extern\s+crate|mod)\s+(?:static\s+|type\s+)?/,'').replace(/;$/,'').trim();
          const head=raw.split(/[.{\s]/)[0]!.replace(/::$/,'');
          // Retain namespaces in full; resolution never claims a namespace is an installed package.
          const rawTarget=name==='c_sharp'&&raw.includes('=')?raw.slice(raw.indexOf('=')+1).trim():raw;
          const target=rawTarget.replace(/^(?:struct|class|enum|protocol|func|var|let|typealias)\s+/,'').split(/\s+(?:as|=>)\s+|\s*=\s*|[;{]/)[0]!.replace(/\.\*$|::$|\.$/,'').trim();
          add(node,target||head,'value',name==='rust'&&(node.type==='mod_item'||/^(?:crate|self|super)::/.test(target)));
        }
      }
      const declarations=['package_declaration','package_header','package_clause','namespace_declaration','file_scoped_namespace_declaration','namespace_definition','module_defn'];
      if(declarations.includes(node.type)){const value=field('name')??nc(node).find(c=>/name|identifier/.test(c.type));if(value)result.declarations.push(value.text.replace(/\\/g,'.'));}
    }else if(name==='ruby'&&node.type==='call'){
      const method=field('method')?.text,args=nc(field('arguments'));
      if(!field('receiver')&&method&&['require','require_relative','autoload'].includes(method)&&!shadowed.has(method))add(node,literal(args?.[method==='autoload'?1:0]),'value',method==='require_relative');
    }
  });
  // ERROR nodes can contain valid-looking declarations: do not use their descendants as evidence.
  const errors=tree.rootNode.descendantsOfType('ERROR').filter((node):node is Node=>!!node);
  result.imports=result.imports.filter(ref=>{const anchor=anchors.get(ref)!;return !errors.some(error=>anchor.start<error.endIndex&&anchor.end>error.startIndex);});
  result.limitations=[...new Set(result.limitations)];tree.delete();parser.delete();return result;
}
