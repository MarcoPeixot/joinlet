import { synchronizeDiscoveredSources } from './importers';
import { posix } from 'node:path';
import { applyOps, emptyLayout, emptyModel, normalizeEdgeIds } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { addItem, loadWorkspace, newWorkspace, workspaceFiles } from '../workspace';
import type { WorkspaceData } from '../workspace';
import { createMemoryAdapter } from '../storage';
import type { StorageAdapter } from '../storage';
import { withSnippet } from '../evidence';
import type { EvidenceIndex } from '../evidence';
import { stableStringify } from '../json';
import { contextFiles } from '../context';
import { mergeIntoDiagram } from '../syncMerge';
import { matchGlob, parseSources } from '../sources';
import { digest, sourcePath } from './reader';
import { DEFAULT_REPOSITORY_CONFIG, REPOSITORY_CONFIG, REPOSITORY_STATE, RepositoryProviderNotConfigured } from './contracts';
import type { RepositoryAnalyzer, RepositoryConfig, RepositoryEntry, RepositoryFact, RepositoryLocale, RepositoryProposal, RepositoryReader, RepositoryStatus, SourceRef } from './contracts';
import { writeBatch } from './transaction';
import { dependencyDocumentation, developmentSource, repositoryPresentation, repositoryReadme } from './presentation';
import { repositoryLayout, type RepositoryLayouts } from './layout';
import { detectRepositoryTechnologies, repositoryTechnology, technologyDocumentation } from './technologies';
import {projectRepositoryDocuments,moduleReadme,connectRepositoryKnowledge,organizeRepositoryItems} from './knowledge';
import type {RepositoryKnowledge} from './knowledge';

interface CachedFile { revision: string; hash: string; text: string | null }
interface TechnologyChoice { id:string; refs:SourceRef[] }
interface ManagedState extends RepositoryLayouts { knowledge?:RepositoryKnowledge; technologyChoices?:Record<string,TechnologyChoice>; presentation?: { diagramTitle: string; documentTitle: string; view?:'modules'|'dependencies' }; proposals?:RepositoryProposal[]; analysisFiles?:Record<string,string>; analysisIdentity?:string; analysisFingerprint?: string; labels?: Record<string,{source:string;analysis:string}>; version: 1; diagram: string; base: unknown; document: { slug: string; text: string }; evidence: EvidenceIndex }
export interface RepositoryResult { status: RepositoryStatus; files: Record<string, string>; data: WorkspaceData; changed: string[] }
const CODE = /\.(?:[cm]?[jt]sx?|py|java|go|rs|rb|php|cs|fs|c|h|cpp|swift|kts?|scala|vue|svelte|astro)$/i;
const DOC = /(?:^|\/)(?:README(?:\.[^/]*)?|[^/]+\.(?:md|markdown|mdx))$/i;
const INPUT = /(?:\.(?:json|ya?ml|tf|d2|mmd|mermaid|c4|likec4|dsl|toml|xml|mod|gradle)|(?:^|\/)Dockerfile)$/i;
const idOf = (path: string) => `repo_${digest(path).slice(0, 14)}`;
const refAt = (path: string, text: string, value: string): SourceRef => {
  const lines = text.split(/\r?\n/), index = Math.max(0, lines.findIndex(l => l.includes(value)));
  return { path, line: index + 1, contains: lines[index]!.trim().slice(0, 400) || value };
};
const labelOf = (path: string) => path === '.' ? 'Application' : path.split('/').pop()!;

export function readRepositoryConfig(text: string | null): RepositoryConfig {
  if (text === null) return { ...DEFAULT_REPOSITORY_CONFIG };
  const raw = JSON.parse(text);
  if (!raw || raw.version !== 1) throw Error('Unsupported repository.json version.');
  const config = { ...DEFAULT_REPOSITORY_CONFIG, ...raw } as RepositoryConfig;
  if (config.locale !== undefined && config.locale !== 'en' && config.locale !== 'pt-BR') throw Error('Invalid repository locale.');
  if (config.view !== undefined && !['auto','modules','dependencies'].includes(config.view)) throw Error('Invalid repository view.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.diagram) || !Array.isArray(config.include) || !config.include.every(x => typeof x === 'string') || !Array.isArray(config.exclude) || !config.exclude.every(x => typeof x === 'string') || typeof config.ai !== 'boolean') throw Error('Invalid repository configuration.');
  for (const key of ['maxFiles', 'maxBytes', 'maxAiCalls'] as const) if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > DEFAULT_REPOSITORY_CONFIG[key] * 10) throw Error(`Invalid repository limit: ${key}.`);
  return config;
}

/** Deterministic module/import graph. Relations cite the declaration that actually links both endpoints. */
export function extractRepositoryFacts(files: Map<string, string>): RepositoryFact[] {
  const facts = new Map<string, RepositoryFact>(), packages = new Map<string, string>();
  const put = (key: string, label: string, ref: SourceRef, tech?: string) => {
    let fact = facts.get(key);
    if (!fact) { fact = { id: idOf(key), label, kind:key.startsWith('dependency:')?'dependency':'module',...(!key.startsWith('dependency:')?{path:key}:{}), ...(tech ? { tech } : {}), refs: [], dependencies: [] }; facts.set(key, fact); }
    if (!fact.refs.some(r => r.path === ref.path && r.line === ref.line)) fact.refs.push(ref);
    return fact;
  };
  for (const [path, text] of files) if (path.endsWith('package.json')) {
    try {
      const pkg = JSON.parse(text), dir = posix.dirname(path);
      if (typeof pkg.name === 'string') { packages.set(pkg.name, dir); if(!pkg.workspaces||pkg.main||pkg.bin||pkg.exports)put(dir, pkg.name, refAt(path, text, '"name"'), 'JavaScript / TypeScript'); }
    } catch { /* Invalid manifests remain available to the analyzer; do not invent dependencies. */ }
  }
  const roots = [...new Set(packages.values())].sort((a, b) => b.length - a.length);
  const moduleFor = (path: string) => {
    const pkg = roots.find(r => r !== '.' && path.startsWith(r + '/'));
    if (pkg) return pkg;
    const parts = path.split('/');
    if (parts.length > 2 && ['src', 'app', 'lib', 'apps', 'packages', 'services'].includes(parts[0]!)) return parts.slice(0, 2).join('/');
    return parts.length > 1 && !['src', 'lib'].includes(parts[0]!) ? parts[0]! : '.';
  };
  for (const [path, text] of files) {
    if (!CODE.test(path)||developmentSource(path)) continue;
    const key = moduleFor(path), first = text.split(/\r?\n/).find(l => l.trim() && !/^\s*(?:\/\/|#|\/\*|\*)/.test(l))?.trim();
    if (!first) continue;
    const current = put(key, labelOf(key), refAt(path, text, first));
    // Only declaration forms, never arbitrary strings or comments. Broader semantic inference is reviewable AI work.
    const lines = text.split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n]!;
      const match = line.match(/^\s*(?:import\s+(?:.*?\s+from\s+)?|export\s+.*?\s+from\s+)["']([^"']+)["']/) ?? line.match(/^\s*(?:const|let|var)\s+[^=]+?=\s*require\(["']([^"']+)["']\)/) ?? line.match(/^\s*from\s+([\w.]+)\s+import\s+/);
      if (!match) continue;
      const name = match[1]!, ref = { path, line: n + 1, contains: line.trim().slice(0, 400) };
      let targetKey: string;
      if (name.startsWith('.')) {
        const resolved = posix.normalize(posix.join(posix.dirname(path), name));
        const target = [resolved, ...['.ts', '.tsx', '.js', '.jsx', '.py', '/index.ts', '/index.js', '/__init__.py'].map(ext => resolved + ext)].find(p => files.has(p));
        if (!target) continue;
        targetKey = moduleFor(target);
        if (targetKey === key) continue;
        put(targetKey, labelOf(targetKey), refAt(target, files.get(target)!, files.get(target)!.split(/\r?\n/).find(l => l.trim()) ?? ''));
      } else {
        const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
        if (dependency.startsWith('node:')||dependency==='bun'||dependency.startsWith('bun:')||/^(?:pathlib|typing|collections|asyncio|dataclasses|unittest|sys|os|json|re|math)$/.test(dependency)&&/\.py$/.test(path)) continue;
        targetKey = packages.get(dependency) ?? `dependency:${dependency}`;
        put(targetKey, packages.has(dependency) ? dependency : dependency, ref, packages.has(dependency) ? undefined : dependency);
      }
      if (targetKey!==key && !current.dependencies.some(d => d.target === idOf(targetKey))) current.dependencies.push({ target: idOf(targetKey), ref });
    }
  }
  return detectRepositoryTechnologies([...facts.values()],files,moduleFor).map(f => ({ ...f, refs: f.refs.sort((a,b) => a.path.localeCompare(b.path) || a.line-b.line).slice(0, 20), dependencies: f.dependencies.sort((a,b) => a.target.localeCompare(b.target)) })).sort((a,b) => a.id.localeCompare(b.id));
}

export class RepositoryEngine {
  private architectureCache=new Map<string,{stamp:number;text:string|null}>();
  private cache = new Map<string, CachedFile>();
  private analyses = new Map<string, Awaited<ReturnType<RepositoryAnalyzer['analyze']>>>();
  private serial: Promise<unknown> = Promise.resolve();
  constructor(readonly reader: RepositoryReader, readonly adapter: StorageAdapter, readonly analyzer?: RepositoryAnalyzer) {}
  run(options: { check?: boolean; name?: string; locale?: RepositoryLocale; signal?: AbortSignal; progress?: (status: RepositoryStatus) => void } = {}): Promise<RepositoryResult> {
    const run = this.serial.then(() => this.execute(options), () => this.execute(options));
    this.serial = run;
    return run;
  }
  private async execute(options: { check?: boolean; name?: string; locale?: RepositoryLocale; signal?: AbortSignal; progress?: (status: RepositoryStatus) => void }): Promise<RepositoryResult> {
    const status: RepositoryStatus = { id: crypto.randomUUID(), phase: 'files', completed: 0, total: 0, analyzedRevision: null, persistedRevision: null, coverage: 'partial', pending: [], proposals: [], metrics: { files: 0, reads: 0, aiCalls: 0, written: 0 } };
    const emit = () => { options.signal?.throwIfAborted(); options.progress?.(structuredClone(status)); };
    const stamps=await this.adapter.stamps?.();
    const beforeFiles = new Map<string, string | null>();
    status.metrics.architectureReads=0;
    for (const path of stamps?Object.keys(stamps):await this.adapter.list()) if (!path.startsWith('versions/') && !path.startsWith('comments/') && !path.endsWith('.bak')) {
      const cached=this.architectureCache.get(path);
      const text=stamps&&cached?.stamp===stamps[path]?cached.text:await this.adapter.read(path);
      if(!stamps||cached?.stamp!==stamps[path])status.metrics.architectureReads++;
      beforeFiles.set(path,text);if(stamps)this.architectureCache.set(path,{stamp:stamps[path]!,text});
    }
    for(const path of this.architectureCache.keys())if(!beforeFiles.has(path))this.architectureCache.delete(path);
    const config=readRepositoryConfig(beforeFiles.get(REPOSITORY_CONFIG)??null);
    config.locale ??= options.locale ?? 'en';
    const loaded = await loadWorkspace(createMemoryAdapter(Object.fromEntries([...beforeFiles].filter((e): e is [string,string] => e[1] !== null))));
    if (loaded?.warnings.length) throw Error(`Architecture needs repair: ${loaded.warnings.join('; ')}`);
    if (!loaded && beforeFiles.size) throw Error('The existing .arch directory has no valid manifest. Its files were preserved.');
    let data = loaded?.data ?? newWorkspace(options.name ?? 'Repository');
    const portuguese = config.locale === 'pt-BR';
    const presentation = { diagramTitle: `${portuguese ? 'Visão geral' : 'Overview'} — ${data.manifest.name}`, documentTitle: `${portuguese ? 'Arquitetura' : 'Architecture'} — ${data.manifest.name}` };
    status.initialized = !loaded;
    const entries = await this.reader.list(), revision = await this.reader.revision();
    const selected = entries.filter(e => sourcePath(e.path) && config.include.some(p => matchGlob(p, e.path)) && !config.exclude.some(p => matchGlob(p, e.path)) && (CODE.test(e.path) || DOC.test(e.path) || INPUT.test(e.path)));
    status.total = selected.length; status.metrics.files = entries.length;
    const texts = new Map<string, string>();
    let bytes = 0;
    for (const entry of selected) {
      emit();
      if (texts.size >= config.maxFiles || bytes + (entry.bytes ?? 0) > config.maxBytes) { status.pending.push('Inventory limit reached; narrow repository include/exclude rules.'); break; }
      let cached = this.cache.get(entry.path);
      if (!cached || cached.revision !== entry.revision) {
        const text = await this.reader.read(entry.path); status.metrics.reads++;
        cached = { revision: entry.revision, text, hash: digest(text ?? '') }; this.cache.set(entry.path, cached);
      }
      if (cached.text !== null) { texts.set(entry.path, cached.text); bytes += Buffer.byteLength(cached.text); }
      else status.pending.push(`Unreadable, binary or oversized file: ${entry.path}`);
      status.completed++;
    }
    const currentPaths = new Set(entries.map(e => e.path));
    for (const path of this.cache.keys()) if (!currentPaths.has(path)) this.cache.delete(path);
    status.phase = 'architecture'; emit();
    const facts = extractRepositoryFacts(texts);
    if(!facts.length)for(const[path,text]of texts){
      const tech=/\.tf$/.test(path)?'Terraform':/^[\s{]*["']?openapi["']?\s*:/m.test(text)?'OpenAPI':/^apiVersion:\s*\S+/m.test(text)&&/^kind:\s*\S+/m.test(text)?'Kubernetes':undefined;
      if(tech&&!facts.some(f=>f.tech===tech)){const ref=refAt(path,text,text.split(/\r?\n/).find(l=>l.trim())??''),id=tech.toLowerCase();facts.push({id:idOf('infrastructure:'+tech),label:tech,tech,primaryTechnology:id,technologies:[{id,refs:[ref]}],refs:[ref],dependencies:[]});}
    }
    const oldState = beforeFiles.get(REPOSITORY_STATE) ? JSON.parse(beforeFiles.get(REPOSITORY_STATE)!) as ManagedState : null;
    status.proposals=(oldState?.proposals??[]).filter(p=>p.refs.every(ref=>texts.get(ref.path)?.split(/\r?\n/)[ref.line-1]?.includes(ref.contains)));
    const plainLabels = new Map(facts.map(f => [f.id,f.label]));
    const fingerprint = digest(stableStringify([...texts].filter(([path])=>!developmentSource(path)).map(([path,text]) => [path,digest(text)])));
    const analysisIdentity=(this.analyzer?.identity??'configured')+':technologies-v1';
    const technologyChoices:Record<string,TechnologyChoice>={};
    for(const fact of facts){const choice=oldState?.technologyChoices?.[fact.id],detected=fact.technologies?.find(t=>t.id===choice?.id);if(choice&&detected&&choice.refs.length&&choice.refs.every(ref=>detected.refs.some(r=>r.path===ref.path&&r.line===ref.line&&r.contains===ref.contains))){fact.primaryTechnology=choice.id;technologyChoices[fact.id]=choice;}}
    const analysisFiles:Record<string,string>=oldState?.analysisIdentity===analysisIdentity?{...oldState.analysisFiles}:{};
    for(const path of Object.keys(analysisFiles))if(!texts.has(path))delete analysisFiles[path];
    let aiComplete = !!this.analyzer && config.ai && !options.check;
    for(const fact of facts){const label=oldState?.labels?.[fact.id];if(label&&label.source===fact.label)fact.label=label.analysis;}
    if (config.ai && !this.analyzer && selected.some(e => CODE.test(e.path)&&!developmentSource(e.path)) && oldState?.analysisFingerprint !== fingerprint) status.pending.push('AI provider is not configured; semantic code analysis is pending.');
    if(config.ai&&this.analyzer&&options.check&&oldState?.analysisFingerprint!==fingerprint)status.pending.push('Code analysis is pending; synchronize the repository to run the configured AI provider.');
    if (config.ai && this.analyzer && !options.check) {
      let batch: { path: string; text: string }[] = [], size = 0, analysisPaused=false;
      const analyze = async () => {
        if (!batch.length||analysisPaused) return;
        const key = digest(analysisIdentity+stableStringify(batch));
        let analysis = this.analyses.get(key);
        if (!analysis) {
          if (status.metrics.aiCalls >= config.maxAiCalls) { aiComplete=false; status.pending.push('AI analysis budget reached.'); return; }
          status.metrics.aiCalls++; try { analysis = await this.analyzer!.analyze({ files: batch, facts, revision, signal: options.signal }); } catch (error) { options.signal?.throwIfAborted(); aiComplete=false; analysisPaused=true; status.pending.push(error instanceof RepositoryProviderNotConfigured ? error.message : 'AI analysis is paused: provider unavailable, credits exhausted or request limit reached.'); return; }
          this.analyses.set(key, analysis);
        }
        status.proposals=status.proposals.filter(proposal=>!proposal.refs.some(ref=>batch.some(file=>file.path===ref.path)));
        for(const file of batch)analysisFiles[file.path]=digest(file.text);
        // Existing facts can receive grounded descriptive labels. New semantic claims require review.
        const validRef = (ref: SourceRef) => !!ref && typeof ref.path === 'string' && Number.isInteger(ref.line) && ref.line > 0 && typeof ref.contains === 'string' && ref.contains.trim().length > 0 && texts.get(ref.path)?.split(/\r?\n/)[ref.line-1]?.includes(ref.contains);
        for (const fact of analysis.facts ?? []) {
          if(!fact || typeof fact!=='object')continue;
          const existing = facts.find(f => f.id === fact.id);
          if (existing && Array.isArray(fact.refs) && fact.refs.length && fact.refs.every(validRef) && typeof fact.label === 'string' && fact.label.length <= 120) {
            existing.label = fact.label;
            // AI can choose among locally proven technologies; a plausible name or file alone is insufficient.
            const technology=repositoryTechnology(fact.primaryTechnology)&&existing.technologies?.find(t=>t.id===fact.primaryTechnology);
            const refs=technology?technology.refs.filter(ref=>fact.refs.some(r=>r.path===ref.path&&r.line===ref.line)):[];
            if(technology&&refs.length){existing.primaryTechnology=technology.id;technologyChoices[existing.id]={id:technology.id,refs};}
          }
          else if (Array.isArray(fact.refs) && fact.refs.length && fact.refs.every(validRef)) status.proposals.push({ id: digest(JSON.stringify(fact)).slice(0,16), summary: fact.label, refs: fact.refs, ops: [], reason: 'Semantic inference requires architecture review.' });
        }
        for (const proposal of analysis.proposals ?? []) if (proposal && typeof proposal.id === 'string' && typeof proposal.summary === 'string' && proposal.summary.length <= 2000 && Array.isArray(proposal.ops) && proposal.ops.length <= 1000 && Array.isArray(proposal.refs) && proposal.refs.length && proposal.refs.every(validRef)) status.proposals.push(proposal);
      };
      for (const [path, text] of texts) {
        if(analysisPaused)break;
        if (developmentSource(path)||!CODE.test(path) && !DOC.test(path) && !INPUT.test(path)) continue;
        if(analysisFiles[path]===digest(text))continue;
        if (text.length > 60_000) { aiComplete=false; status.pending.push(`AI input requires a narrower file: ${path}`); continue; }
        if (size + text.length > 60_000) { await analyze(); batch = []; size = 0; emit(); }
        batch.push({ path, text }); size += text.length;
      }
      await analyze();
    }
    const projected=projectRepositoryDocuments(texts,data,oldState?.knowledge,portuguese);data=projected.data;status.pending.push(...projected.pending);
    const view=repositoryPresentation(facts,config,plainLabels),model={model:view.model};
    for(const fact of view.modules){const slug=moduleReadme(fact,projected.documents),element=view.model.elements[fact.id];if(slug&&element)element.link='doc:'+slug;}
    let previous: ManagedState | null = null;
    if (beforeFiles.get(REPOSITORY_STATE)) {
      previous = JSON.parse(beforeFiles.get(REPOSITORY_STATE)!) as ManagedState;
      if (previous.version !== 1 || previous.diagram !== config.diagram) throw Error('Repository baseline needs review before changing its managed diagram.');
    }
    if (!data.diagrams[config.diagram]) {
      const added = addItem(data, 'diagram', 'Repository'); data = added.data;
      if (added.slug !== config.diagram) {
        const snapshot = data.diagrams[added.slug]!;
        delete data.diagrams[added.slug]; data.diagrams[config.diagram] = snapshot;
        data.manifest.diagrams = data.manifest.diagrams.map(d => d.slug === added.slug ? { ...d, slug: config.diagram } : d);
      }
      data.manifest.diagrams = data.manifest.diagrams.map(d => d.slug === config.diagram ? { ...d, title: presentation.diagramTitle } : d);
    } else if (!previous && loaded) {
      status.pending.push('An existing repository diagram has no managed baseline; review its first merge.');
    }
    if (previous) data.manifest.diagrams = data.manifest.diagrams.map(d => d.slug === config.diagram && d.title === (previous.presentation?.diagramTitle ?? 'Repository') ? { ...d, title: presentation.diagramTitle } : d);
    const snapshot = data.diagrams[config.diagram]!, base = previous ? parseDiagramJson(JSON.stringify(previous.base)).model : undefined;
    const merged = mergeIntoDiagram(snapshot.model, model.model, base, 'merge');
    for (const note of merged.notes) status.pending.push(note.message);
    const applied = applyOps(snapshot.model, merged.ops);
    if (!applied.ok) throw Error(applied.error.message);
    // Nested JSON has a canonical parent/child order. Context must use the same order before and after reload.
    const synchronized=parseDiagramJson(printDiagramJson(applied.model)).model;
    const placement=await repositoryLayout(synchronized,snapshot.layout,view.mode,previous??undefined),layout=placement.layout;
    if(placement.keptManual)status.pending.push('Existing positions preserved; use Reorganize to compact the module overview.');
    data = { ...data, diagrams: { ...data.diagrams, [config.diagram]: { model: synchronized, layout } }, evidence: structuredClone(data.evidence ?? {}) };
    const evidence: EvidenceIndex = { [config.diagram]: {} };
    for (const fact of facts) if(synchronized.elements[fact.id]) evidence[config.diagram]![fact.id] = fact.refs.map(r => withSnippet(r, texts.get(r.path)!));
    const edges = normalizeEdgeIds(synchronized).edges;
    for (const edge of edges) {
      const ref = facts.find(f => f.id === edge.from)?.dependencies.find(d => d.target === edge.to)?.ref;
      if (ref && edge.id) evidence[config.diagram]![`edge:${edge.id}`] = [withSnippet(ref, texts.get(ref.path)!)];
    }
    const owned = previous?.evidence[config.diagram] ?? {};
    const currentEvidence = data.evidence![config.diagram] ?? {};
    for (const id of Object.keys(owned)) if (!evidence[config.diagram]![id] && stableStringify(currentEvidence[id] ?? []) === stableStringify(owned[id])) delete currentEvidence[id];
    for (const [id, refs] of Object.entries(evidence[config.diagram]!)) {
      if (currentEvidence[id] && owned[id] && stableStringify(currentEvidence[id]) !== stableStringify(owned[id])) { status.pending.push(`Manually edited evidence preserved: ${id}`); continue; }
      currentEvidence[id] = refs;
    }
    data.evidence![config.diagram] = currentEvidence;
    const readmes = [...texts].filter(([path]) => DOC.test(path)).map(([path]) => `- ${path}`);
    const {readme,overview}=repositoryReadme(texts);
    const provenance = portuguese ? 'Gerado automaticamente pelo Joinlet a partir dos manifestos, imports e documentos encontrados no repositório. A cobertura semântica é parcial; revise comportamentos inferidos.' : 'Generated automatically by Joinlet from repository manifests, imports and documents. Semantic coverage is partial; review inferred behavior.';
    const documentText = `# ${presentation.documentTitle}\n\n${provenance}\n\n${overview ? `## ${portuguese ? 'Contexto do projeto' : 'Project context'}\n\n${overview}\n\n${portuguese ? 'Fonte' : 'Source'}: \`${readme![0]}\`\n\n` : ''}## ${portuguese ? 'Módulos' : 'Modules'}\n\n${view.modules.map(f => `- ${f.label}${f.path?' — `'+f.path+'`':''}`).join('\n')}\n\n${view.mode==='modules'?(portuguese?'A visão geral mostra os módulos do projeto; o detalhe das bibliotecas está listado abaixo.':'The overview shows project modules; library details are listed below.')+'\n\n':''}${technologyDocumentation(facts,portuguese)}${dependencyDocumentation(facts,portuguese)}\n## ${portuguese ? 'Documentação encontrada' : 'Source documentation'}\n\n${readmes.join('\n') || (portuguese ? 'Nenhum README encontrado.' : 'No README found.')}\n`;
    let docSlug = previous?.document.slug;
    if (!docSlug) { const added = addItem(data, 'doc', 'Repository architecture', documentText); data = added.data; docSlug = added.slug; }
    else if (data.docs[docSlug] === previous!.document.text) data = { ...data, docs: { ...data.docs, [docSlug]: documentText } };
    else if (data.docs[docSlug] !== documentText) status.pending.push('Repository architecture document was edited manually; generated update requires review.');
    data.manifest.docs = data.manifest.docs.map(d => d.slug === docSlug && d.title === (previous?.presentation?.documentTitle ?? 'Repository architecture') ? { ...d, title: presentation.documentTitle } : d);
    const state: ManagedState = { technologyChoices,presentation:{...presentation,view:view.mode},layouts:placement.layouts,generatedLayouts:placement.generatedLayouts, proposals:status.proposals, ...(this.analyzer?{analysisIdentity,analysisFiles}:oldState?.analysisIdentity?{analysisIdentity:oldState.analysisIdentity,analysisFiles:oldState.analysisFiles}:{}), ...(aiComplete ? {analysisFingerprint:fingerprint} : oldState?.analysisFingerprint ? {analysisFingerprint:oldState.analysisFingerprint} : {}), labels:Object.fromEntries(facts.map(f=>[f.id,{source:plainLabels.get(f.id)!,analysis:f.label}])), version: 1, diagram: config.diagram, base: JSON.parse(printDiagramJson(model.model)), document: { slug: docSlug, text: documentText }, evidence };
    const imported = await synchronizeDiscoveredSources(texts, data, beforeFiles);
    data = imported.data; status.pending.push(...imported.pending);
    const generated=[...new Set([config.diagram,...parseSources(imported.files['sources.json']??null).sources.map(source=>source.diagram)])];
    const folders=organizeRepositoryItems(data,generated,docSlug,oldState?.knowledge,portuguese);
    const connected=connectRepositoryKnowledge(data,projected.documents,oldState?.knowledge,config.diagram,docSlug,portuguese,readme?.[0]);
    data=connected.data;status.pending.push(...connected.pending);
    state.knowledge={documents:projected.documents,connections:connected.connections,folders};
    status.knowledge={documents:Object.keys(projected.documents).filter(path=>texts.has(path)).length,connections:Object.values(connected.connections).filter(edge=>data.board.connections.some(c=>(c.from===edge.from&&c.to===edge.to)||(c.to===edge.from&&c.from===edge.to))).length};
    const files: Record<string, string> = { ...imported.files, ...workspaceFiles(data), [REPOSITORY_CONFIG]: stableStringify(config), [REPOSITORY_STATE]: stableStringify(state), ...contextFiles(data) };
    const changed = Object.keys(files).filter(path => files[path] !== (beforeFiles.get(path) ?? null)).sort();
    status.phase = 'sync'; emit();
    // Re-list stat metadata before applying: code changed during a network/AI await invalidates the result.
    await this.reader.list();
    if (await this.reader.revision() !== revision) throw Error('Repository changed during analysis. Retry against its current revision.');
    if (!options.check) await writeBatch(this.adapter, changed.map(path => ({ path, text: files[path]!, expected: beforeFiles.get(path) ?? null })));
    if(!options.check&&changed.length&&this.adapter.stamps){const current=await this.adapter.stamps();for(const path of changed)if(current[path]!==undefined)this.architectureCache.set(path,{stamp:current[path]!,text:await this.adapter.read(path)});}
    status.analyzedRevision = revision; status.persistedRevision = options.check ? null : revision;
    status.metrics.written = options.check ? 0 : changed.length;
    status.pending = [...new Set(status.pending)];
    status.proposals=[...new Map(status.proposals.map(proposal=>[proposal.id,proposal])).values()];
    status.phase = status.proposals.length || status.pending.some(x => !x.startsWith('AI provider')) ? 'review' : status.pending.length ? 'paused' : 'ready';
    emit();
    return { status, files, data, changed };
  }
}

export { inspectRepository } from './inspect';
