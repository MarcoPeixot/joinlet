import { expect, it } from 'vitest';
import { parseSource } from './syntax';
import { extractRepositoryFacts,repositoryOwnership } from './facts';
import { repositoryPresentation, dependencyDocumentation } from './presentation';
import { DEFAULT_REPOSITORY_CONFIG } from './contracts';

import {syntaxFixtures as cases} from './syntaxFixtures';
it.each(cases)('parses declarations in %s with original source coordinates',async(ext,text,name,line)=>{
 const result=await parseSource('file.'+ext,text);expect(result.imports).toContainEqual(expect.objectContaining({name,line}));
 const ref=result.imports.find(r=>r.name===name)!;expect(text.split(/\r?\n/)[line-1]).toContain(ref.contains);
});
it('ignores commented imports, fake declarations in strings and shadowed loaders',async()=>{
 const source='/*\nimport X from "comment";\n*/\nconst example=`import X from "string";`;\nfunction run(require){ return require("shadowed"); }\nimport Real from "real";';
 expect((await parseSource('a.ts',source)).imports.map(r=>r.name)).toEqual(['real']);
 expect((await parseSource('a.py','"""\nfrom fake import Fake\n"""\nimport actual')).imports.map(r=>r.name)).toEqual(['actual']);
});
it('records dynamic targets, malformed declarations, and F# directives without evaluating them',async()=>{
 const dynamic=await parseSource('a.ts','const a=import(name); const b=require(variable);');expect(dynamic.imports).toEqual([]);expect(dynamic.limitations).toHaveLength(2);
 const broken=await parseSource('a.ts','import { from "not-real";\nimport Actual from "actual";');expect(broken.limitations.length).toBeGreaterThan(0);expect(broken.imports.some(r=>r.name==='not-real')).toBe(false);
 expect((await parseSource('a.fs','#load "other.fs"\n#r "nuget: FSharp.Data"')).imports.map(r=>r.name)).toEqual(['other.fs','nuget: FSharp.Data']);
});
it('separates type, development and unresolved dependencies from the production map',async()=>{
 const files=new Map([['apps/api/package.json','{"name":"api"}'],['apps/api/main.ts','import type { Type } from "types";\nimport Value from "runtime";\nimport Missing from "./absent";'],['apps/api/main.test.ts','import {test} from "vitest";']]);
 const facts=await extractRepositoryFacts(files);const module=facts.find(f=>f.path==='apps/api')!;
 expect(module.dependencies.map(d=>[facts.find(f=>f.id===d.target)!.label,d.usage,d.scope])).toEqual(expect.arrayContaining([['types','type','production'],['runtime','value','production'],['vitest','value','development']]));
 expect(module.unresolved?.map(r=>r.name)).toEqual(['./absent']);
 const view=repositoryPresentation(facts,DEFAULT_REPOSITORY_CONFIG,new Map(facts.map(f=>[f.id,f.label])));
 expect(Object.values(view.model.elements).map(e=>e.label)).toEqual(expect.arrayContaining(['api','runtime']));expect(Object.values(view.model.elements).some(e=>e.label==='types'||e.label==='vitest')).toBe(false);
 const doc=dependencyDocumentation(facts,false);expect(doc).toContain('Types');expect(doc).toContain('Development');expect(doc).toContain('Unresolved references');
});
it('resolves local namespace and relative references without inventing package owners',async()=>{
 const facts=await extractRepositoryFacts(new Map([['apps/api/A.java','package shop.api;\nimport shop.billing.Client;\nclass A{}'],['apps/billing/Client.java','package shop.billing;\nclass Client{}']]));
 const source=facts.find(f=>f.path==='apps/api')!,target=facts.find(f=>f.path==='apps/billing')!;expect(source.dependencies).toContainEqual(expect.objectContaining({target:target.id}));
});

it('handles grouped Rust paths, relative Python modules, literal includes and loader receivers',async()=>{
 expect((await parseSource('a.rs','use {crate::api, other::Thing};\nuse crate::{billing, storage::Client};')).imports.map(r=>r.name)).toEqual(['crate::api','other::Thing','crate::billing','crate::storage::Client']);
 expect((await parseSource('a.py','from . import api, billing')).imports.map(r=>r.name)).toEqual(['.api','.billing']);
 const php=await parseSource('a.php','<?php require $path; include("local.php");');expect(php.imports.map(r=>[r.name,r.usage])).toEqual([['local.php','include']]);expect(php.limitations.length).toBeGreaterThan(0);
 expect((await parseSource('a.rb','obj.require "fake"\nrequire "actual"')).imports.map(r=>r.name)).toEqual(['actual']);
 expect((await parseSource('a.rb','def require(x); end\nrequire "shadowed"')).imports).toEqual([]);
});

const commentPrefix:Record<string,string>={py:'# from phantom import Thing',rb:'# require "phantom"',fs:'(* open Phantom *)',vue:'<!-- <script>import x from "phantom";</script> -->',svelte:'<!-- <script>import x from "phantom";</script> -->',astro:'<!-- import x from "phantom" -->'};
it.each(cases)('ignores commented declarations in %s',async(ext,text)=>{
 // PHP comments must be inside its opening tag; Astro frontmatter must remain first.
 const comment=commentPrefix[ext]??'/* import phantom; use phantom; #include "phantom" */';
 const source=ext==='php'?text.replace('<?php','<?php\n'+comment):ext==='astro'?text+'\n'+comment:comment+'\n'+text;
 const result=await parseSource('file.'+ext,source);expect(result.imports.some(ref=>ref.name.includes('phantom'))).toBe(false);expect(result.imports.length).toBeGreaterThan(0);
});

it('keeps component source evidence with its owning module when local packages import each other',async()=>{
 const files=new Map([['apps/api/package.json','{"name":"api"}'],['apps/api/main.ts','import Billing from "billing";'],['apps/billing/package.json','{"name":"billing"}'],['apps/billing/main.ts','export const Billing=true;']]);
 const facts=await extractRepositoryFacts(files);expect(facts.find(f=>f.path==='apps/billing')!.refs.every(ref=>ref.path.startsWith('apps/billing/'))).toBe(true);
 expect(facts.find(f=>f.path==='apps/api')!.dependencies).toHaveLength(1);
});

it('uses syntax paths for comma-separated namespaces and ignores unrelated F# directives',async()=>{
 expect((await parseSource('a.scala','import foo.A, bar.{B,C}')).imports.map(ref=>ref.name)).toEqual(['foo.A','bar']);
 expect((await parseSource('a.php','<?php use Foo\\Bar, Baz\\Qux; use Foo\\{Bar, Baz\\Qux};')).imports.map(ref=>ref.name)).toEqual(['Foo\\Bar','Baz\\Qux','Foo\\Baz\\Qux']);
 expect((await parseSource('a.fs','#nowarn "40"\nopen System.Text')).imports.map(ref=>ref.name)).toEqual(['System.Text']);
 expect((await parseSource('a.ts','const loaded=import(`./literal.ts`);')).imports.map(ref=>ref.name)).toEqual(['./literal.ts']);
});

it('keeps selective Swift imports in value scope because they are not erased type-only imports',async()=>{
 expect((await parseSource('a.swift','import struct Domain.Invoice')).imports).toContainEqual(expect.objectContaining({name:'Domain.Invoice',usage:'value'}));
});

it('does not interpret invalid frontmatter or unsupported script languages as JavaScript',async()=>{
 const invalid=await parseSource('a.astro','---\nconst example=`<script>import x from "phantom";</script>`;');expect(invalid.imports).toEqual([]);expect(invalid.limitations).toContain('Unterminated Astro frontmatter.');
 const unsupported=await parseSource('a.vue','<script lang="coffee">import x from "phantom";</script>');expect(unsupported.imports).toEqual([]);expect(unsupported.limitations).toContain('Unsupported script language: coffee.');
 expect((await parseSource('a.vue','<script data-lang="ts">import type {A} from "invalid-js";</script>')).imports).toEqual([]);
});

it('rejects locally bound loaders in arrow parameters, patterns, imports and Python parameters',async()=>{
 for(const source of ['const run=require=>require("fake");','const {require}=local; require("fake");','import {other as require} from "real"; require("fake");','try {} catch(require) { require("fake"); }']){
  const result=await parseSource('a.ts',source);expect(result.imports.some(ref=>ref.name==='fake')).toBe(false);expect(result.limitations.length).toBeGreaterThan(0);
 }
 const python=await parseSource('a.py','def run(__import__):\n return __import__("fake")');expect(python.imports).toEqual([]);expect(python.limitations.length).toBeGreaterThan(0);
});

it('uses compiler manifests for local resolution while preserving legacy module paths and identifiers',async()=>{
 const files=new Map([['projects/service/Cargo.toml','[package]\nname="service"'],['projects/service/src/main.rs','use crate::helper::run;'],['projects/service/src/helper.rs','pub fn run() {}'],['projects/python/pyproject.toml','[project]\nname="python"'],['projects/python/src/main.py','import helper'],['projects/python/src/helper.py','def run(): pass']]);
 const ownership=repositoryOwnership(files);expect(ownership.moduleFor('projects/service/src/main.rs')).toBe('projects');expect(ownership.moduleFor('projects/python/src/main.py')).toBe('projects');
 const facts=await extractRepositoryFacts(files);expect(facts.filter(f=>f.kind==='module').map(f=>f.path)).toEqual(['projects']);expect(facts.flatMap(f=>f.unresolved??[])).toEqual([]);
});
