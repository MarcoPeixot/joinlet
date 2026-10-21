import { MAX_IMPORT, asArray, asString, cleanText, failure, isRecord, pick } from '../common';
import type { ImportResult } from '../common';
import { GraphCollector } from './collector';
import { graphToModel } from './graph';
import type { GraphModelOptions } from './graph';
import { azureId, ec2Arn, gcpName, nameTag, parseArn, regionOfZone } from './ids';
import { credentialKind, kindByTerraform, kindByType } from './kinds';
import type { KindInfo } from './kinds';
import { setAttr } from './safe';
import type { CloudAttrs, CloudGraph, CloudProvider } from './types';

/** `terraform show -json` of a real state is large; files are read by the CLI, the web paste box keeps the common 2 MB cap. */
export const MAX_TERRAFORM_JSON = 64_000_000;
const MAX_MODULE_DEPTH = 25;
const MAX_WALK_NODES = 3000;
const MAX_WALK_DEPTH = 6;

const PROVIDERS: [string, CloudProvider][] = [['aws_', 'aws'], ['azurerm_', 'azure'], ['google_', 'gcp']];
const NOISE = /^(aws_(iam_|route_table|route$|main_route|network_acl|eip_association|cloudwatch_|kms_|ssm_|secretsmanager_|.*_association$|.*_attachment$|.*_rule$|.*_policy$|.*_permission$|.*_version$|.*_configuration$)|azurerm_(role_|monitor_|.*_association$|.*_extension$|.*_rule$)|google_(project_|service_account|.*_iam_|.*_binding$|.*_member$))/;

/** Resources that only express a relation between two others: they produce links and are not resources of their own. */
const RELATION_TYPES = new Set(['aws_lb_listener', 'aws_alb_listener', 'aws_lb_target_group_attachment', 'aws_alb_target_group_attachment', 'aws_lambda_event_source_mapping', 'aws_sns_topic_subscription', 'aws_apigatewayv2_integration']);
const LAMBDA_ARN = /arn:aws[a-z-]*:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]{1,64}/;

interface Raw {
  address: string;
  type: string;
  name: string;
  index: unknown;
  provider: CloudProvider;
  values: Record<string, unknown>;
  sensitive: unknown;
  dependsOn: string[];
}

const providerOf = (type: string): CloudProvider | undefined => PROVIDERS.find(([prefix]) => type.startsWith(prefix))?.[1];

/** Resources of a state or plan: every module of `values.root_module` / `planned_values.root_module`, breadth first and bounded. */
function collect(moduleRoot: unknown, c: GraphCollector): { raws: Raw[]; ignored: number } {
  const raws: Raw[] = [];
  let ignored = 0;
  const queue: { module: unknown; depth: number }[] = [{ module: moduleRoot, depth: 0 }];
  for (let at = 0; at < queue.length; at += 1) {
    const { module, depth } = queue[at]!;
    for (const resource of asArray(pick(module, 'resources'), 20000)) {
      const type = asString(pick(resource, 'type'));
      const address = asString(pick(resource, 'address'));
      if (!type || !address || pick(resource, 'mode') === 'data') continue;
      const provider = providerOf(type);
      if (!provider || credentialKind(type)) { ignored += 1; continue; }
      const values = pick(resource, 'values');
      raws.push({
        address, type, provider,
        name: asString(pick(resource, 'name')) ?? address,
        index: pick(resource, 'index'),
        values: isRecord(values) ? values : {},
        sensitive: pick(resource, 'sensitive_values'),
        dependsOn: asArray(pick(resource, 'depends_on'), 200).filter((v): v is string => typeof v === 'string'),
      });
    }
    if (depth >= MAX_MODULE_DEPTH) { if (asArray(pick(module, 'child_modules'), 1).length) c.warnOnce('depth', 'Módulos aninhados demais: o restante foi ignorado.'); continue; }
    for (const child of asArray(pick(module, 'child_modules'), 2000)) queue.push({ module: child, depth: depth + 1 });
  }
  return { raws, ignored };
}

/** `configuration` of a plan: address (without index) → every address it references or depends on. */
function configurationReferences(configuration: unknown): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const queue: { module: unknown; prefix: string; depth: number }[] = [{ module: pick(configuration, 'root_module'), prefix: '', depth: 0 }];
  for (let at = 0; at < queue.length; at += 1) {
    const { module, prefix, depth } = queue[at]!;
    for (const resource of asArray(pick(module, 'resources'), 20000)) {
      const address = asString(pick(resource, 'address'));
      if (!address) continue;
      const found: string[] = [];
      collectReferences(pick(resource, 'expressions'), found, 0);
      for (const dep of asArray(pick(resource, 'depends_on'), 200)) if (typeof dep === 'string') found.push(dep);
      refs.set(`${prefix}${address}`, found.map((ref) => resourceAddress(ref, prefix)).filter((ref): ref is string => !!ref));
    }
    const calls = pick(module, 'module_calls');
    if (isRecord(calls) && depth < MAX_MODULE_DEPTH) {
      for (const [name, call] of Object.entries(calls).slice(0, 2000)) queue.push({ module: pick(call, 'module'), prefix: `${prefix}module.${name}.`, depth: depth + 1 });
    }
  }
  return refs;
}

function collectReferences(value: unknown, out: string[], depth: number): void {
  if (depth > MAX_WALK_DEPTH || out.length > MAX_WALK_NODES) return;
  if (Array.isArray(value)) { for (const item of value.slice(0, 500)) collectReferences(item, out, depth + 1); return; }
  if (!isRecord(value)) return;
  const references = pick(value, 'references');
  if (Array.isArray(references)) for (const ref of references.slice(0, 200)) if (typeof ref === 'string') out.push(ref);
  for (const [key, child] of Object.entries(value)) if (key !== 'references') collectReferences(child, out, depth + 1);
}

/** `aws_subnet.a.id` → `<prefix>aws_subnet.a`; variables, locals, data and module outputs are not resources. */
function resourceAddress(ref: string, prefix: string): string | undefined {
  const [type, name] = ref.split('.', 3);
  if (!type || !name || type === 'var' || type === 'local' || type === 'data' || type === 'module' || type === 'each' || type === 'count' || type === 'path' || type === 'self') return undefined;
  return `${prefix}${type}.${name}`;
}

const stripIndex = (address: string): string => address.replace(/\[[^\]]*\]$/, '');
const modulePrefix = (address: string): string => {
  const match = /^((?:module\.[^.]+(?:\[[^\]]*\])?\.)+)/.exec(address);
  return match ? match[1]!.replace(/\[[^\]]*\]/g, '') : '';
};

/** `sensitive_values` mirrors `values`: `true` marks a sensitive leaf, objects and arrays describe what is sensitive inside. */
function sensitiveChild(sensitive: unknown, key: string | number): unknown {
  if (Array.isArray(sensitive) && typeof key === 'number') return sensitive[key];
  return isRecord(sensitive) && typeof key === 'string' && Object.hasOwn(sensitive, key) ? sensitive[key] : undefined;
}

function tfAttrs(kind: KindInfo | undefined, raw: Raw): CloudAttrs {
  const attrs: CloudAttrs = {};
  for (const [name, source] of Object.entries(kind?.tfAttrs ?? {})) {
    if (typeof source === 'string') { if (sensitiveChild(raw.sensitive, source) !== true) setAttr(attrs, name, raw.values[source]); }
    else setAttr(attrs, name, source(raw.values));
  }
  return attrs;
}

/** The shared walk: every string below `values` that is an id of another resource, without ever emitting the string. */
function referencedStrings(values: Record<string, unknown>, sensitive: unknown, known: ReadonlyMap<string, string>): Set<string> {
  const found = new Set<string>();
  let budget = MAX_WALK_NODES;
  const walk = (value: unknown, flag: unknown, depth: number): void => {
    if (budget-- <= 0 || depth > MAX_WALK_DEPTH || flag === true) return;
    if (typeof value === 'string') { const hit = value.length <= 600 ? known.get(value) : undefined; if (hit) found.add(hit); return; }
    if (Array.isArray(value)) { value.slice(0, 500).forEach((item, index) => walk(item, sensitiveChild(flag, index), depth + 1)); return; }
    if (isRecord(value)) for (const [key, child] of Object.entries(value).slice(0, 500)) if (key !== 'id' && key !== 'arn') walk(child, sensitiveChild(flag, key), depth + 1);
  };
  walk(values, sensitive, 0);
  return found;
}

function parseShow(text: string, limit: number): { graph?: CloudGraph; error?: string } {
  if (text.length > limit) return { error: `Entrada grande demais (limite de ${limit.toLocaleString('pt-BR')} caracteres).` };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { error: 'Não é um JSON válido: use a saída de "terraform show -json".' }; }
  if (!isRecord(json) || typeof pick(json, 'format_version') !== 'string') return { error: 'Não parece a saída de "terraform show -json" (falta format_version).' };
  const state = pick(pick(json, 'values'), 'root_module');
  const plan = pick(pick(json, 'planned_values'), 'root_module');
  const root = state ?? plan;
  if (!isRecord(root)) return { error: 'O JSON do Terraform não traz recursos (values/planned_values ausentes). Rode "terraform apply" antes, ou use um plano.' };
  const c = new GraphCollector();
  const { raws, ignored } = collect(root, c);
  if (ignored) c.warn(`${ignored} recurso${ignored === 1 ? '' : 's'} de outros provedores ou de credenciais foram omitidos.`);
  if (!state) c.warn('Plano do Terraform: recursos ainda não criados não têm identificador real e não casam com a nuvem.');

  const account = raws.map((raw) => parseArn(raw.values.arn)?.account).find((value): value is string => !!value);
  const regionHint = raws.map((raw) => parseArn(raw.values.arn)?.region).find((value): value is string => !!value);

  // Pass 1: identity of every resource.
  const info = new Map<string, { id: string; kind: KindInfo | undefined; raw: Raw }>();
  const known = new Map<string, string>(); // any native id / arn → canonical id
  const byAddress = new Map<string, string>();
  for (const raw of raws) {
    if (RELATION_TYPES.has(raw.type)) continue;
    const kind = kindByTerraform(raw.type);
    const id = canonicalId(raw, kind, account, regionHint);
    info.set(raw.address, { id, kind, raw });
    byAddress.set(stripIndex(raw.address), id);
    for (const key of ['id', 'arn'] as const) {
      const value = raw.values[key];
      if (typeof value === 'string' && value && !known.has(value)) known.set(value, id);
    }
    if (typeof raw.values.bucket === 'string' && raw.type === 'aws_s3_bucket' && !known.has(raw.values.bucket)) known.set(raw.values.bucket, id);
  }

  const references = configurationReferences(pick(json, 'configuration'));
  const resolveRefs = (raw: Raw): Set<string> => {
    const found = referencedStrings(raw.values, raw.sensitive, known);
    for (const ref of references.get(stripIndex(raw.address)) ?? []) { const hit = byAddress.get(ref); if (hit) found.add(hit); }
    const prefix = modulePrefix(raw.address);
    for (const dep of raw.dependsOn) { const hit = byAddress.get(`${prefix}${dep}`) ?? byAddress.get(dep); if (hit) found.add(hit); }
    return found;
  };

  // Pass 2: resources, placement and links.
  const links: [string, string][] = [];
  const typeById = new Map([...info.values()].map((entry) => [entry.id, entry.kind?.type] as const));
  for (const { id, kind, raw } of info.values()) {
    const type = kind?.type ?? `${raw.provider}:${raw.type}`;
    const targets = [...resolveRefs(raw)].filter((target) => target !== id);
    const net: { vpc?: string; subnets?: string[] } = {};
    for (const target of targets) {
      const role = kindByType(typeById.get(target) ?? '')?.role;
      if (role === 'vpc') net.vpc = target;
      else if (role === 'subnet') (net.subnets ??= []).push(target);
      else links.push([id, target]);
    }
    c.add({
      id, provider: raw.provider, type, name: displayName(raw), address: raw.address,
      region: regionOf(raw), scope: scopeOf(raw), attrs: tfAttrs(kind, raw),
      ...(net.vpc || net.subnets ? { net } : {}),
      ...(!kind && NOISE.test(raw.type) ? { show: false } : {}),
    });
  }

  // Relation-only resources become links between the resources they mention.
  for (const raw of raws) {
    if (!RELATION_TYPES.has(raw.type)) continue;
    const targets = [...resolveRefs(raw)];
    const ofKind = (suffix: string) => targets.filter((target) => typeById.get(target)?.endsWith(suffix));
    if (raw.type.endsWith('_listener')) for (const lb of ofKind(':load-balancer')) for (const tg of ofKind(':target-group')) links.push([lb, tg]);
    else if (raw.type.endsWith('_target_group_attachment')) { for (const tg of ofKind(':target-group')) for (const target of targets) if (target !== tg && typeById.get(target) !== typeById.get(tg)) links.push([tg, target]); }
    else if (raw.type === 'aws_lambda_event_source_mapping') { const fns = ofKind(':function'); for (const source of targets.filter((target) => !fns.includes(target))) for (const fn of fns) links.push([source, fn]); }
    else if (raw.type === 'aws_sns_topic_subscription') { const topics = ofKind(':topic'); for (const topic of topics) for (const target of targets) if (target !== topic) links.push([topic, target]); }
    else if (raw.type === 'aws_apigatewayv2_integration') {
      const apis = ofKind(':api');
      const uri = typeof raw.values.integration_uri === 'string' ? LAMBDA_ARN.exec(raw.values.integration_uri)?.[0] : undefined;
      for (const api of apis) { if (uri) links.push([api, uri]); }
    }
  }
  for (const [from, to] of links) c.link(from, to);
  return { graph: { origin: 'terraform', scope: {}, resources: c.resources(), diagnostics: c.diagnostics } };
}

function displayName(raw: Raw): string {
  const tags = raw.values.tags_all ?? raw.values.tags;
  const named = nameTag(tags) ?? ['name', 'function_name', 'bucket', 'identifier', 'cluster_identifier', 'family'].map((key) => raw.values[key]).find((v): v is string => typeof v === 'string' && !!v);
  if (named) return named;
  return raw.index === undefined || raw.index === null ? raw.name : `${raw.name}[${String(raw.index)}]`;
}

function regionOf(raw: Raw): string | undefined {
  const { values } = raw;
  if (raw.provider === 'aws') {
    const arn = parseArn(values.arn);
    if (arn?.region) return arn.region;
    return typeof values.availability_zone === 'string' ? regionOfZone(values.availability_zone) : undefined;
  }
  const where = values.location ?? values.region ?? values.zone;
  return typeof where === 'string' && where ? (raw.provider === 'gcp' ? regionOfZone(where) : where) : undefined;
}

function scopeOf(raw: Raw): string | undefined {
  const value = raw.provider === 'azure' ? raw.values.resource_group_name : raw.provider === 'gcp' ? raw.values.project : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

/** The drift key: the same one the provider's CLI import produces for the same resource, or `tf:<address>` when Terraform has no real id yet. */
function canonicalId(raw: Raw, kind: KindInfo | undefined, account: string | undefined, regionHint: string | undefined): string {
  const { values } = raw;
  const text = (key: string): string | undefined => (typeof values[key] === 'string' && values[key] ? (values[key] as string) : undefined);
  const fallback = `tf:${cleanText(raw.address, 400)}`;
  if (raw.provider === 'aws') {
    const arn = text('arn');
    if (arn) return arn;
    const native = text('id');
    if (!native) return fallback;
    return (kind && ec2Arn(kind.type, native, regionOf(raw) ?? regionHint, account)) ?? native;
  }
  if (raw.provider === 'azure') {
    const id = text('id');
    return id?.startsWith('/') ? azureId(id) : fallback;
  }
  const id = text('id');
  if (id?.startsWith('projects/')) return gcpName(id);
  const selfLink = text('self_link');
  const fromLink = selfLink ? /(projects\/.+)$/.exec(selfLink)?.[1] : undefined;
  if (fromLink) return gcpName(fromLink);
  if (kind?.type === 'gcp:storage:bucket' && id) return `projects/_/buckets/${id}`;
  return fallback;
}

/** `terraform show -json` (state or plan) → resource graph. `error` is a pt-BR message when the text is not that format. */
export function parseTerraformShow(text: string, limit = MAX_TERRAFORM_JSON): { graph: CloudGraph } | { error: string } {
  const parsed = parseShow(text, limit);
  return parsed.graph ? { graph: parsed.graph } : { error: parsed.error ?? 'Não foi possível ler o JSON do Terraform.' };
}

/** The web import: same parser with the 2 MB cap, drawn straight into a model. */
export function importTerraformShow(text: string, options: GraphModelOptions = {}): ImportResult {
  const parsed = parseTerraformShow(text, MAX_IMPORT);
  return 'error' in parsed ? failure(parsed.error) : graphToModel(parsed.graph, options).result;
}
