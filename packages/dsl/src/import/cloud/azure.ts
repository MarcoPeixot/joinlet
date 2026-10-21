import { asArray, asString, pick } from '../common';
import { GraphCollector } from './collector';
import { azureId } from './ids';
import { credentialKind, kindByArm } from './kinds';
import { setAttr } from './safe';
import type { CloudAttrs, CloudGraph, CloudScope } from './types';

/** Resource types that add noise without architecture: extensions, role assignments, diagnostics, watchers. */
const NOISE = /\/(extensions|roleassignments|roledefinitions|locks|diagnosticsettings|networkwatchers|solutions|alertrules|metricalerts|actiongroups|namespaces\/authorizationrules)(\/|$)/i;
const MAX_ITEMS = 5000;

/** `/subscriptions/s/resourceGroups/g/providers/Microsoft.Sql/servers/srv/databases/db` → the parent id when the path has a child segment. */
function parentId(id: string): string | undefined {
  const at = id.toLowerCase().indexOf('/providers/');
  if (at < 0) return undefined;
  const parts = id.slice(at + '/providers/'.length).split('/');
  // namespace / type / name [/ childType / childName]...
  return parts.length >= 5 ? id.slice(0, id.lastIndexOf('/', id.lastIndexOf('/') - 1)) : undefined;
}

/** Normalizes the JSON array printed by `az resource list`. Tags, properties and everything not listed below are never read. */
export function normalizeAzure(listing: unknown, scope: CloudScope = {}): CloudGraph {
  const c = new GraphCollector();
  const links: [string, string][] = [];
  let skipped = 0;
  for (const entry of asArray(listing, MAX_ITEMS)) {
    const rawId = asString(pick(entry, 'id'));
    const armType = asString(pick(entry, 'type'));
    if (!rawId || !armType) continue;
    if (credentialKind(armType) || NOISE.test(armType) || NOISE.test(rawId) || /\bsystem\b/.test(asString(pick(entry, 'kind')) ?? '')) { skipped += 1; continue; }
    const id = azureId(rawId);
    const kind = kindByArm(armType);
    const attrs: CloudAttrs = {};
    const sku = pick(entry, 'sku');
    setAttr(attrs, 'sku', asString(pick(sku, 'name')) ?? (typeof sku === 'string' ? sku : undefined));
    setAttr(attrs, 'kind', pick(entry, 'kind'));
    const location = asString(pick(entry, 'location'));
    c.add({
      id,
      provider: 'azure',
      type: kind?.type ?? `azure:${armType.toLowerCase()}`,
      name: asString(pick(entry, 'name')),
      region: location,
      scope: asString(pick(entry, 'resourceGroup')),
      attrs,
    });
    const managedBy = asString(pick(entry, 'managedBy'));
    if (managedBy) links.push([azureId(managedBy), id]);
    const parent = parentId(rawId);
    if (parent) links.push([azureId(parent), id]);
  }
  if (skipped) c.warn(`${skipped} recurso${skipped === 1 ? '' : 's'} de credenciais, extensões ou controle de acesso foram omitidos.`);
  for (const [from, to] of links) c.link(from, to);
  return { origin: 'azure', scope, resources: c.resources(), diagnostics: c.diagnostics };
}
