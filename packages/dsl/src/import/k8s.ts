import type { NodeProps } from './common';
import { ModelBuilder, asArray, asString, cleanText, failure, isRecord, pick, pickPath, tooBigResult } from './common';
import type { ImportResult } from './common';
import { loadDocuments } from './yaml';

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']);
const PROPS: Record<string, NodeProps> = {
  Deployment: { icon: 'kubernetes' }, StatefulSet: { icon: 'kubernetes' }, DaemonSet: { icon: 'kubernetes' },
  Job: { icon: 'kubernetes' }, CronJob: { icon: 'scheduler' },
  Service: { icon: 'load-balancer' }, Ingress: { icon: 'gateway' },
  ConfigMap: { shape: 'document' }, Secret: { shape: 'document', icon: 'lock' },
  PersistentVolumeClaim: { shape: 'cylinder', icon: 'storage' },
};
const MAX_ITEMS = 2000;

interface Resource {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  doc: unknown;
  line: number;
}

export function importKubernetes(text: string): ImportResult {
  const big = tooBigResult(text);
  if (big) return big;
  const b = new ModelBuilder();
  try {
    const docs = loadDocuments(text, b);
    if (!docs.length) return b.diagnostics.length ? { model: b.build().model, diagnostics: b.diagnostics } : failure('O texto não contém documentos Kubernetes.');
    run(docs, b);
  } catch {
    b.warn(1, 'Não foi possível ler os manifestos Kubernetes por completo.');
  }
  return b.build();
}

/** Test-only instrumentation: how many (service, workload) candidate pairs the selector matcher examined. */
export const k8sProbe = { candidates: 0 };

/** `kind: List` wraps several manifests in `items`. */
function flatten(docs: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const doc of docs) {
    if (pick(doc, 'kind') === 'List' && Array.isArray(pick(doc, 'items'))) out.push(...asArray(pick(doc, 'items'), MAX_ITEMS));
    else out.push(doc);
    if (out.length > MAX_ITEMS * 2) break;
  }
  return out;
}

const key = (namespace: string, kind: string, name: string) => `${namespace}\u0000${kind}\u0000${name}`;

const pairKey = (namespace: string, k: string, v: string) => `${namespace}\u0000${k}\u0000${v}`;

function labelsOf(map: unknown): [string, string][] {
  return isRecord(map) ? Object.entries(map).map(([k, v]) => [k, String(v)]) : [];
}

function podTemplate(resource: Resource): unknown {
  return resource.kind === 'CronJob'
    ? pickPath(resource.doc, 'spec', 'jobTemplate', 'spec', 'template')
    : pickPath(resource.doc, 'spec', 'template');
}

/** Config/secret/claim names a pod spec mounts or reads. */
function podReferences(podSpec: unknown): { kind: string; name: string }[] {
  const refs: { kind: string; name: string }[] = [];
  const add = (kind: string, name: unknown) => { const value = asString(name); if (value) refs.push({ kind, name: value }); };
  for (const volume of asArray(pick(podSpec, 'volumes'))) {
    add('ConfigMap', pickPath(volume, 'configMap', 'name'));
    add('Secret', pickPath(volume, 'secret', 'secretName'));
    add('PersistentVolumeClaim', pickPath(volume, 'persistentVolumeClaim', 'claimName'));
    for (const source of asArray(pickPath(volume, 'projected', 'sources'))) {
      add('ConfigMap', pickPath(source, 'configMap', 'name'));
      add('Secret', pickPath(source, 'secret', 'name'));
    }
  }
  for (const container of [...asArray(pick(podSpec, 'containers')), ...asArray(pick(podSpec, 'initContainers'))]) {
    for (const from of asArray(pick(container, 'envFrom'))) {
      add('ConfigMap', pickPath(from, 'configMapRef', 'name'));
      add('Secret', pickPath(from, 'secretRef', 'name'));
    }
    for (const env of asArray(pick(container, 'env'))) {
      add('ConfigMap', pickPath(env, 'valueFrom', 'configMapKeyRef', 'name'));
      add('Secret', pickPath(env, 'valueFrom', 'secretKeyRef', 'name'));
    }
  }
  return refs;
}

function ingressBackends(doc: unknown): { service: string; label?: string }[] {
  const out: { service: string; label?: string }[] = [];
  const backendName = (backend: unknown) => asString(pickPath(backend, 'service', 'name')) ?? asString(pick(backend, 'serviceName'));
  const fallback = backendName(pickPath(doc, 'spec', 'defaultBackend'));
  if (fallback) out.push({ service: fallback });
  for (const rule of asArray(pickPath(doc, 'spec', 'rules'))) {
    for (const path of asArray(pickPath(rule, 'http', 'paths'))) {
      const service = backendName(pick(path, 'backend'));
      const route = asString(pick(path, 'path'));
      if (service) out.push({ service, ...(route && route !== '/' ? { label: route } : {}) });
    }
  }
  return out;
}

function run(rawDocs: unknown[], b: ModelBuilder): void {
  const resources: Resource[] = [];
  const index = new Map<string, Resource>();
  for (const [position, doc] of flatten(rawDocs).entries()) {
    const kind = asString(pick(doc, 'kind'));
    const name = asString(pickPath(doc, 'metadata', 'name'));
    if (!kind || !asString(pick(doc, 'apiVersion'))) { b.warnOnce('not-k8s', position + 1, 'Documento sem "apiVersion" e "kind" ignorado.'); continue; }
    if (kind === 'Namespace') continue;
    if (!Object.hasOwn(PROPS, kind)) { b.warnOnce(`kind:${kind}`, position + 1, `Tipo "${cleanText(kind, 60)}" ignorado: ainda não é importado.`); continue; }
    if (!name) { b.warnOnce('no-name', position + 1, `Recurso ${kind} sem "metadata.name" ignorado.`); continue; }
    const namespace = asString(pickPath(doc, 'metadata', 'namespace')) ?? '';
    if (name === '__proto__' || namespace === '__proto__') { b.warnOnce('reserved', position + 1, 'O nome "__proto__" é reservado e foi ignorado.'); continue; }
    const id = `${namespace ? `${namespace}/` : ''}${kind}/${name}`;
    const k = key(namespace, kind, name);
    if (index.has(k)) continue;
    const resource: Resource = { id, kind, name, namespace, doc, line: position + 1 };
    if (namespace && !b.has(namespace)) { if (b.add(namespace, { label: namespace }, resource.line) !== null) b.setGroup(namespace); }
    const added = b.add(id, { label: cleanText(name), tech: kind, ...PROPS[kind], ...(namespace && b.isGroup(namespace) ? { parentId: namespace } : {}) }, resource.line);
    if (added === null) continue;
    resources.push(resource);
    index.set(k, resource);
  }

  // Inverted index: (namespace, label pair) -> workloads carrying it, so a selector only visits candidates for its first pair.
  const byLabel = new Map<string, Resource[]>();
  const labelSets = new Map<Resource, Set<string>>();
  for (const r of resources) {
    if (!WORKLOADS.has(r.kind)) continue;
    const pairs = new Set(labelsOf(pickPath(podTemplate(r), 'metadata', 'labels')).map(([k, v]) => pairKey(r.namespace, k, v)));
    labelSets.set(r, pairs);
    for (const pair of pairs) { const list = byLabel.get(pair); if (list) list.push(r); else byLabel.set(pair, [r]); }
  }
  const find = (namespace: string, kind: string, name: string) => index.get(key(namespace, kind, name));

  for (const resource of resources) {
    if (b.edgesFull) break;
    if (resource.kind === 'Service') {
      const selector = labelsOf(pickPath(resource.doc, 'spec', 'selector'));
      if (!selector.length) continue;
      // Start from the rarest pair: a selector with any pair no workload carries visits no candidate at all.
      let candidates: Resource[] = [];
      for (const [k, v] of selector) {
        const list = byLabel.get(pairKey(resource.namespace, k, v)) ?? [];
        if (candidates.length === 0 || list.length < candidates.length) candidates = list;
        if (!list.length) { candidates = list; break; }
      }
      for (const r of candidates) {
        k8sProbe.candidates += 1;
        const labels = labelSets.get(r)!;
        if (selector.every(([k, v]) => labels.has(pairKey(r.namespace, k, v)))) b.connect(resource.id, r.id, '>', undefined, resource.line);
        if (b.edgesFull) break;
      }
    } else if (resource.kind === 'Ingress') {
      for (const backend of ingressBackends(resource.doc)) {
        const service = find(resource.namespace, 'Service', backend.service);
        if (service) b.connect(resource.id, service.id, '>', backend.label, resource.line);
      }
    } else if (WORKLOADS.has(resource.kind)) {
      for (const ref of podReferences(pickPath(podTemplate(resource), 'spec'))) {
        const target = find(resource.namespace, ref.kind, ref.name);
        if (target) b.connect(resource.id, target.id, '>', undefined, resource.line);
      }
    }
  }
}
