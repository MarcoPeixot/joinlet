import { applyOps } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { ModelBuilder, MAX_EDGES, MAX_ELEMENTS, cleanText } from '../common';
import type { ImportResult } from '../common';
import { PROVIDER_ICON, kindByType } from './kinds';
import type { CloudGraph, CloudResource } from './types';

export interface GraphModelOptions {
  /** True when the icon id exists in the catalog; ids it rejects fall back to the provider's generic mark. Without it every id is trusted. */
  hasIcon?: (id: string) => boolean;
}

export interface GraphModel {
  result: ImportResult;
  /** Resource id → element id, for every resource that was drawn (groups included). */
  nodes: Map<string, string>;
}

const SUMMARY_ORDER = ['instanceType', 'machineType', 'size', 'engine', 'engineVersion', 'instanceClass', 'runtime', 'lbType', 'scheme', 'cidr', 'az', 'zone', 'launchType', 'state'];

/** One short line of the most telling attributes, for the node description. */
export function summarize(resource: CloudResource): string {
  const parts: string[] = [];
  for (const key of SUMMARY_ORDER) {
    const value = Object.hasOwn(resource.attrs, key) ? resource.attrs[key] : undefined;
    if (value !== undefined) parts.push(String(value));
  }
  // AWS nodes already sit in their region group; elsewhere the location is part of what tells two resources apart.
  if (resource.region && resource.provider !== 'aws' && !parts.includes(resource.region)) parts.push(resource.region);
  return parts.join(' · ');
}

/** Public subnets get the public-subnet frame. */
const structuralIcon = (resource: CloudResource): string | undefined => (resource.type === 'aws:ec2:subnet' && resource.attrs.public === true ? 'aws:group-public-subnet' : undefined);

const rawTail = (type: string): string => type.slice(Math.max(type.lastIndexOf(':'), type.lastIndexOf('/')) + 1);

/**
 * Turns a resource graph into a diagram: AWS resources nest region › VPC › subnet, Azure ones sit in their resource group
 * and GCP ones in their project. Ids are the display names (made unique), resources are visited in a fixed order so a
 * second import of the same cloud produces the same ids.
 */
export function graphToModel(graph: CloudGraph, options: GraphModelOptions = {}): GraphModel {
  const b = new ModelBuilder();
  for (const diagnostic of graph.diagnostics) b.warn(diagnostic.line, diagnostic.message);
  const known = new Map<string, CloudResource>();
  for (const resource of [...graph.resources].sort(byOrder)) {
    if (known.has(resource.id)) b.warn(1, `Recurso duplicado ignorado: ${cleanText(resource.id, 120)}.`);
    else known.set(resource.id, resource);
  }
  const resolve = (id: string) => (known.get(id)?.show ? known.get(id) : undefined);
  const nodes = new Map<string, string>();
  const containers = new Map<string, string>(); // `region:<r>` / `rg:<scope>` → group id
  const descriptions = new Map<string, string>();
  const iconOf = (wanted: string | undefined, provider: CloudResource['provider']): string => {
    const icon = wanted ?? PROVIDER_ICON[provider];
    return !options.hasIcon || options.hasIcon(icon) ? icon : PROVIDER_ICON[provider];
  };

  const containerFor = (resource: CloudResource): string | undefined => {
    if (resource.provider === 'aws' && resource.region) return group(`region:${resource.region}`, resource.region, iconOf('aws:group-region', 'aws'));
    if (resource.provider === 'azure' && resource.scope) return group(`rg:${resource.scope.toLowerCase()}`, resource.scope, iconOf('azure:resource-groups', 'azure'));
    if (resource.provider === 'gcp' && resource.scope) return group(`project:${resource.scope}`, resource.scope, iconOf('gcp:project', 'gcp'));
    return undefined;
  };
  const group = (key: string, label: string, icon: string): string | undefined => {
    const existing = containers.get(key);
    if (existing) return existing;
    const id = b.addUnique(label, { label, icon });
    if (!id) return undefined;
    b.setGroup(id);
    containers.set(key, id);
    return id;
  };

  const structural = [...known.values()].filter((r) => kindByType(r.type)?.role === 'vpc' || kindByType(r.type)?.role === 'subnet');
  // VPCs first (inside their region), then subnets (inside their VPC): parents always exist before children.
  for (const role of ['vpc', 'subnet'] as const) {
    for (const resource of structural.filter((r) => kindByType(r.type)?.role === role)) {
      const kind = kindByType(resource.type)!;
      const parentResource = role === 'subnet' ? known.get(resource.net?.vpc ?? '') : undefined;
      const parentId = (parentResource && nodes.get(parentResource.id)) ?? containerFor(resource);
      const id = b.addUnique(resource.name, { label: resource.name, icon: iconOf(structuralIcon(resource) ?? kind.icon, resource.provider), tech: kind.label, parentId });
      if (!id) continue;
      b.setGroup(id);
      nodes.set(resource.id, id);
    }
  }

  const parentOf = (resource: CloudResource): string | undefined => {
    const subnets = [...new Set((resource.net?.subnets ?? []).filter((id) => nodes.has(id) && kindByType(known.get(id)?.type ?? '')?.role === 'subnet'))];
    if (subnets.length === 1) return nodes.get(subnets[0]!);
    if (subnets.length > 1) {
      const vpc = known.get(subnets[0]!)?.net?.vpc;
      if (vpc && nodes.has(vpc)) return nodes.get(vpc);
    }
    if (resource.net?.vpc && nodes.has(resource.net.vpc)) return nodes.get(resource.net.vpc);
    return containerFor(resource);
  };

  for (const resource of known.values()) {
    if (!resource.show || nodes.has(resource.id)) continue;
    const kind = kindByType(resource.type);
    const description = summarize(resource);
    const id = b.addUnique(resource.name, {
      label: resource.name,
      icon: iconOf(kind?.icon, resource.provider),
      tech: kind?.label ?? rawTail(resource.type),
      ...(kind?.shape ? { shape: kind.shape } : {}),
      parentId: parentOf(resource),
    });
    if (!id) continue;
    nodes.set(resource.id, id);
    if (description) descriptions.set(id, description);
  }

  for (const resource of known.values()) {
    const from = resolve(resource.id) && nodes.get(resource.id);
    if (!from || b.isGroup(from)) continue;
    for (const link of throughTargetGroups(resource.links, known)) {
      const target = resolve(link);
      const to = target && nodes.get(target.id);
      if (to && !b.isGroup(to)) b.connect(from, to);
      if (b.edgesFull) break;
    }
  }

  const polished = polish(b.build(), descriptions);
  return { result: polished, nodes: new Map([...nodes].filter(([, id]) => Object.hasOwn(polished.model.elements, id))) };
}

/** Cards become icon tiles with their one-line summary; the builder's own diagnostics are kept. */
function polish(built: ImportResult, summaries: ReadonlyMap<string, string>): ImportResult {
  const ops: DiagramOp[] = [];
  for (const id of built.model.order) {
    const element = built.model.elements[id];
    if (element?.kind !== 'node') continue;
    const description = summaries.get(id);
    ops.push({ op: 'update', id, set: { presentation: 'icon', ...(description ? { description } : {}) } });
  }
  if (ops.length === 0) return built;
  const applied = applyOps(built.model, ops);
  return applied.ok ? { model: applied.model, diagnostics: built.diagnostics } : built;
}

/** A target group is plumbing: the load balancer is drawn pointing at what the group routes to. */
function throughTargetGroups(links: readonly string[], known: ReadonlyMap<string, CloudResource>): string[] {
  const out = new Set<string>();
  for (const link of links) {
    if (out.size >= MAX_EDGES) break;
    const target = known.get(link);
    if (target?.type === 'aws:elbv2:target-group') for (const behind of target.links) { if (out.size >= MAX_EDGES) break; out.add(behind); }
    else out.add(link);
  }
  return [...out];
}

function byOrder(a: CloudResource, b: CloudResource): number {
  return (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const MAX_GRAPH_RESOURCES = MAX_ELEMENTS;
