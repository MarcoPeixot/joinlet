import type { ImportDiagnostic } from '../common';

export type CloudProvider = 'aws' | 'azure' | 'gcp';
/** Where a graph came from: a provider's CLI, or a `terraform show -json` file (any providers inside). */
export type CloudOrigin = CloudProvider | 'terraform';

/** Plain, non-secret facts about a resource. Only values from the per-kind allowlists ever get here. */
export type CloudAttrs = Record<string, string | number | boolean>;

export interface CloudResource {
  /** Canonical identity (ARN, Azure resource id, GCP full resource name, or the Terraform `arn`/`id`): the drift key. */
  id: string;
  provider: CloudProvider;
  /** Canonical kind such as `aws:ec2:instance`; unknown kinds are `<provider>:<raw type>`. */
  type: string;
  name: string;
  region?: string;
  /** Azure resource group / GCP project: the grouping outside AWS. */
  scope?: string;
  /** Drawn as a node. Structural resources (security groups…) are tracked for drift but not drawn. */
  show: boolean;
  attrs: CloudAttrs;
  /** Ids of resources this one points at (load balancer → target, queue → function it triggers). Unknown targets are dropped. */
  links: string[];
  /** Network placement, resolved into groups when the diagram is built; never persisted. */
  net?: { vpc?: string; subnets?: string[] };
  /** Terraform address when the resource came from Terraform. */
  address?: string;
}

export interface CloudScope {
  region?: string;
  subscription?: string;
  resourceGroup?: string;
  project?: string;
}

export interface CloudGraph {
  origin: CloudOrigin;
  scope: CloudScope;
  resources: CloudResource[];
  diagnostics: ImportDiagnostic[];
  /** Kinds a failed or denied CLI call could not read: the absence of those resources says nothing, so drift skips them. */
  unreadable?: string[];
}
