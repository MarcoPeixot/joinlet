import { cleanText } from '../common';
import type { ImportDiagnostic } from '../common';
import { kindByType } from './kinds';
import { safeName } from './safe';
import type { CloudAttrs, CloudProvider, CloudResource } from './types';

export const MAX_RESOURCES = 5000;
const MAX_DIAGNOSTICS = 60;
const MAX_SUBNETS = 50;

export interface NewResource {
  id: string;
  provider: CloudProvider;
  type: string;
  name: string | undefined;
  region?: string | undefined;
  scope?: string | undefined;
  attrs?: CloudAttrs;
  net?: CloudResource['net'];
  address?: string;
  /** Overrides the kind's role: `false` tracks the resource without drawing it. */
  show?: boolean;
}

/** Accumulates resources and relations from one normalizer; unknown link targets are dropped when it is read back. */
export class GraphCollector {
  readonly diagnostics: ImportDiagnostic[] = [];
  private readonly map = new Map<string, CloudResource>();
  private readonly pending = new Map<string, Set<string>>();
  private readonly once = new Set<string>();
  private full = false;

  warn(message: string): void {
    if (this.diagnostics.length < MAX_DIAGNOSTICS) this.diagnostics.push({ line: 1, message });
    else if (this.diagnostics.length === MAX_DIAGNOSTICS) this.diagnostics.push({ line: 1, message: 'Muitos avisos: os demais foram omitidos.' });
  }

  warnOnce(kind: string, message: string): void {
    if (this.once.has(kind)) return;
    this.once.add(kind);
    this.warn(message);
  }

  has(id: string): boolean { return this.map.has(id); }
  get(id: string): CloudResource | undefined { return this.map.get(id); }

  add(input: NewResource): CloudResource | undefined {
    const id = cleanText(input.id, 600);
    if (!id || id === '__proto__') return undefined;
    const existing = this.map.get(id);
    if (existing) return existing;
    if (this.map.size >= MAX_RESOURCES) {
      if (!this.full) { this.full = true; this.warn(`Limite de ${MAX_RESOURCES} recursos atingido: o restante foi ignorado.`); }
      return undefined;
    }
    const kind = kindByType(input.type);
    const resource: CloudResource = {
      id,
      provider: input.provider,
      type: input.type,
      name: safeName(input.name) ?? id.slice(id.lastIndexOf('/') + 1).slice(0, 80),
      ...(input.region ? { region: input.region } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      show: input.show ?? kind?.role !== 'hidden',
      attrs: input.attrs ?? {},
      links: [],
      ...(input.net && (input.net.vpc || input.net.subnets?.length) ? { net: { ...(input.net.vpc ? { vpc: input.net.vpc } : {}), ...(input.net.subnets?.length ? { subnets: [...new Set(input.net.subnets)].slice(0, MAX_SUBNETS) } : {}) } } : {}),
      ...(input.address ? { address: input.address } : {}),
    };
    this.map.set(id, resource);
    return resource;
  }

  /** `from` → `to` in the diagram's direction of flow. */
  link(from: string, to: string): void {
    if (from === to) return;
    let set = this.pending.get(from);
    if (!set) { set = new Set(); this.pending.set(from, set); }
    set.add(to);
  }

  /** Resources in a stable order, with only the links whose target is part of the graph. */
  resources(): CloudResource[] {
    return [...this.map.values()]
      .map((resource) => ({ ...resource, links: [...(this.pending.get(resource.id) ?? [])].filter((id) => this.map.has(id)).sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
