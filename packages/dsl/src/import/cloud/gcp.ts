import { asArray, asString, pick } from '../common';
import { GraphCollector } from './collector';
import { gcpName, regionOfZone } from './ids';
import { credentialKind, kindByAsset } from './kinds';
import { setAttr } from './safe';
import type { CloudAttrs, CloudGraph, CloudScope } from './types';

const NOISE = /^(serviceusage|iam|logging|cloudresourcemanager|cloudbilling|monitoring|orgpolicy|accesscontextmanager)\.googleapis\.com\/|^compute\.googleapis.com\/(Route|Address|Router|Project|Image|Snapshot|Zone|Region|InstanceGroupManager|InstanceTemplate|HealthCheck|SslCertificate)$/;
const MAX_ITEMS = 5000;

/** The project id out of a Cloud Asset `name` (`//compute.googleapis.com/projects/<id>/…`). */
function projectOf(name: string): string | undefined {
  const match = /(?:^|\/)projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])(?:\/|$)/.exec(name);
  return match?.[1];
}

/**
 * Normalizes the JSON array printed by `gcloud asset search-all-resources --format=json`. Labels, IP addresses,
 * network tags and `additionalAttributes` are never read; the listing carries no relations, so none are drawn.
 */
export function normalizeGcp(listing: unknown, scope: CloudScope = {}): CloudGraph {
  const c = new GraphCollector();
  let skipped = 0;
  for (const entry of asArray(listing, MAX_ITEMS)) {
    const rawName = asString(pick(entry, 'name'));
    const assetType = asString(pick(entry, 'assetType'));
    if (!rawName || !assetType) continue;
    if (credentialKind(assetType) || NOISE.test(assetType)) { skipped += 1; continue; }
    const kind = kindByAsset(assetType);
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'state', pick(entry, 'state'));
    const location = asString(pick(entry, 'location'));
    const name = gcpName(rawName);
    c.add({
      id: name,
      provider: 'gcp',
      type: kind?.type ?? `gcp:${assetType.toLowerCase()}`,
      name: asString(pick(entry, 'displayName')) ?? name.slice(name.lastIndexOf('/') + 1),
      region: location ? regionOfZone(location) : undefined,
      scope: projectOf(rawName) ?? scope.project,
      attrs,
    });
  }
  if (skipped) c.warn(`${skipped} recurso${skipped === 1 ? '' : 's'} de credenciais, identidade ou controle foram omitidos.`);
  return { origin: 'gcp', scope, resources: c.resources(), diagnostics: c.diagnostics };
}
