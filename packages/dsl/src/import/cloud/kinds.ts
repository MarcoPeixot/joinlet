import type { Shape } from '@strukt/core';
import type { CloudProvider } from './types';

/** How a kind appears in the diagram: a node, a container group (VPC, subnet), or tracked for drift but not drawn. */
export type KindRole = 'node' | 'vpc' | 'subnet' | 'hidden';

/** Canonical attribute ← Terraform value: a flat key, or a function over the (non-sensitive) values. */
export type TfAttr = string | ((values: Record<string, unknown>) => unknown);

export interface KindInfo {
  type: string;
  provider: CloudProvider;
  label: string;
  /** Catalog id of the official icon (`packages/core/src/cloudIcons.json`); a test keeps these in sync with the catalog. */
  icon: string;
  role: KindRole;
  shape?: Shape;
  /** Terraform resource types that map to this kind. */
  tf?: readonly string[];
  /** The only Terraform values that are read for this kind. Everything else (user_data, passwords, policies…) is never looked at. */
  tfAttrs?: Record<string, TfAttr>;
}

const scheme = (values: Record<string, unknown>) => (values.internal === true ? 'internal' : values.internal === false ? 'internet-facing' : undefined);

const AWS: KindInfo[] = [
  { type: 'aws:ec2:instance', provider: 'aws', label: 'EC2', icon: 'aws:resource-amazon-ec2-instance', role: 'node', tf: ['aws_instance'], tfAttrs: { instanceType: 'instance_type', az: 'availability_zone' } },
  { type: 'aws:ec2:vpc', provider: 'aws', label: 'VPC', icon: 'aws:group-virtual-private-cloud-vpc', role: 'vpc', tf: ['aws_vpc'], tfAttrs: { cidr: 'cidr_block' } },
  { type: 'aws:ec2:subnet', provider: 'aws', label: 'Sub-rede', icon: 'aws:group-private-subnet', role: 'subnet', tf: ['aws_subnet'], tfAttrs: { cidr: 'cidr_block', az: 'availability_zone', public: (v) => (v.map_public_ip_on_launch === true ? true : undefined) } },
  { type: 'aws:ec2:security-group', provider: 'aws', label: 'Security Group', icon: 'aws:vpc', role: 'hidden', tf: ['aws_security_group'] },
  { type: 'aws:ec2:nat-gateway', provider: 'aws', label: 'NAT Gateway', icon: 'aws:vpc', role: 'node', tf: ['aws_nat_gateway'] },
  { type: 'aws:ec2:internet-gateway', provider: 'aws', label: 'Internet Gateway', icon: 'aws:resource-amazon-vpc-internet-gateway', role: 'node', tf: ['aws_internet_gateway'] },
  { type: 'aws:elbv2:load-balancer', provider: 'aws', label: 'Load Balancer', icon: 'aws:elastic-load-balancing', role: 'node', tf: ['aws_lb', 'aws_alb'], tfAttrs: { lbType: 'load_balancer_type', scheme } },
  { type: 'aws:elbv2:target-group', provider: 'aws', label: 'Target Group', icon: 'aws:elastic-load-balancing', role: 'hidden', tf: ['aws_lb_target_group', 'aws_alb_target_group'], tfAttrs: { protocol: 'protocol', port: 'port' } },
  { type: 'aws:rds:instance', provider: 'aws', label: 'RDS', icon: 'aws:rds', role: 'node', shape: 'cylinder', tf: ['aws_db_instance'], tfAttrs: { engine: 'engine', engineVersion: 'engine_version', instanceClass: 'instance_class', multiAz: 'multi_az' } },
  { type: 'aws:rds:cluster', provider: 'aws', label: 'Aurora/RDS cluster', icon: 'aws:rds', role: 'node', shape: 'cylinder', tf: ['aws_rds_cluster'], tfAttrs: { engine: 'engine', engineVersion: 'engine_version' } },
  { type: 'aws:lambda:function', provider: 'aws', label: 'Lambda', icon: 'aws:resource-aws-lambda-lambda-function', role: 'node', tf: ['aws_lambda_function'], tfAttrs: { runtime: 'runtime', memory: 'memory_size' } },
  { type: 'aws:s3:bucket', provider: 'aws', label: 'S3', icon: 'aws:resource-amazon-simple-storage-service-bucket', role: 'node', shape: 'cylinder', tf: ['aws_s3_bucket'] },
  { type: 'aws:sqs:queue', provider: 'aws', label: 'SQS', icon: 'aws:sqs', role: 'node', tf: ['aws_sqs_queue'], tfAttrs: { fifo: 'fifo_queue' } },
  { type: 'aws:sns:topic', provider: 'aws', label: 'SNS', icon: 'aws:sns', role: 'node', tf: ['aws_sns_topic'], tfAttrs: { fifo: 'fifo_topic' } },
  { type: 'aws:dynamodb:table', provider: 'aws', label: 'DynamoDB', icon: 'aws:dynamodb', role: 'node', shape: 'cylinder', tf: ['aws_dynamodb_table'], tfAttrs: { billingMode: 'billing_mode' } },
  { type: 'aws:apigateway:api', provider: 'aws', label: 'API Gateway', icon: 'aws:api-gateway', role: 'node', tf: ['aws_apigatewayv2_api', 'aws_api_gateway_rest_api'], tfAttrs: { protocol: 'protocol_type' } },
  { type: 'aws:ecs:cluster', provider: 'aws', label: 'ECS cluster', icon: 'aws:ecs', role: 'node', tf: ['aws_ecs_cluster'] },
  { type: 'aws:ecs:service', provider: 'aws', label: 'ECS service', icon: 'aws:ecs', role: 'node', tf: ['aws_ecs_service'], tfAttrs: { launchType: 'launch_type', desired: 'desired_count' } },
  { type: 'aws:eks:cluster', provider: 'aws', label: 'EKS', icon: 'aws:eks', role: 'node', tf: ['aws_eks_cluster'], tfAttrs: { version: 'version' } },
];

const AZURE: KindInfo[] = [
  { type: 'azure:compute:virtual-machine', provider: 'azure', label: 'Máquina virtual', icon: 'azure:virtual-machine', role: 'node', tf: ['azurerm_linux_virtual_machine', 'azurerm_windows_virtual_machine', 'azurerm_virtual_machine'], tfAttrs: { size: 'size' } },
  { type: 'azure:compute:disk', provider: 'azure', label: 'Disco', icon: 'azure:disks', role: 'hidden', tf: ['azurerm_managed_disk'] },
  { type: 'azure:network:virtual-network', provider: 'azure', label: 'Rede virtual', icon: 'azure:virtual-networks', role: 'node', tf: ['azurerm_virtual_network'] },
  { type: 'azure:network:interface', provider: 'azure', label: 'Interface de rede', icon: 'azure:network-interfaces', role: 'hidden', tf: ['azurerm_network_interface'] },
  { type: 'azure:network:security-group', provider: 'azure', label: 'NSG', icon: 'azure:network-security-groups', role: 'hidden', tf: ['azurerm_network_security_group'] },
  { type: 'azure:network:public-ip', provider: 'azure', label: 'IP público', icon: 'azure:public-ip-addresses', role: 'node', tf: ['azurerm_public_ip'] },
  { type: 'azure:network:load-balancer', provider: 'azure', label: 'Load Balancer', icon: 'azure:load-balancers', role: 'node', tf: ['azurerm_lb'] },
  { type: 'azure:network:application-gateway', provider: 'azure', label: 'Application Gateway', icon: 'azure:application-gateways', role: 'node', tf: ['azurerm_application_gateway'] },
  { type: 'azure:storage:account', provider: 'azure', label: 'Storage Account', icon: 'azure:storage-accounts', role: 'node', shape: 'cylinder', tf: ['azurerm_storage_account'] },
  { type: 'azure:sql:server', provider: 'azure', label: 'SQL Server', icon: 'azure:sql-server', role: 'node', tf: ['azurerm_mssql_server', 'azurerm_sql_server'] },
  { type: 'azure:sql:database', provider: 'azure', label: 'SQL Database', icon: 'azure:sql-database', role: 'node', shape: 'cylinder', tf: ['azurerm_mssql_database', 'azurerm_sql_database'] },
  { type: 'azure:web:site', provider: 'azure', label: 'App Service', icon: 'azure:app-services', role: 'node', tf: ['azurerm_linux_web_app', 'azurerm_windows_web_app', 'azurerm_app_service', 'azurerm_linux_function_app', 'azurerm_windows_function_app'] },
  { type: 'azure:web:server-farm', provider: 'azure', label: 'Plano do App Service', icon: 'azure:app-service-plans', role: 'node', tf: ['azurerm_service_plan', 'azurerm_app_service_plan'] },
  { type: 'azure:keyvault:vault', provider: 'azure', label: 'Key Vault', icon: 'azure:key-vaults', role: 'node', tf: ['azurerm_key_vault'] },
  { type: 'azure:documentdb:database-account', provider: 'azure', label: 'Cosmos DB', icon: 'azure:azure-cosmos-db', role: 'node', shape: 'cylinder', tf: ['azurerm_cosmosdb_account'] },
  { type: 'azure:containerservice:managed-cluster', provider: 'azure', label: 'AKS', icon: 'azure:kubernetes-services', role: 'node', tf: ['azurerm_kubernetes_cluster'] },
  { type: 'azure:servicebus:namespace', provider: 'azure', label: 'Service Bus', icon: 'azure:azure-service-bus', role: 'node', tf: ['azurerm_servicebus_namespace'] },
  { type: 'azure:eventhub:namespace', provider: 'azure', label: 'Event Hubs', icon: 'azure:event-hubs', role: 'node', tf: ['azurerm_eventhub_namespace'] },
];

const GCP: KindInfo[] = [
  { type: 'gcp:compute:instance', provider: 'gcp', label: 'Compute Engine', icon: 'gcp:compute-engine', role: 'node', tf: ['google_compute_instance'], tfAttrs: { machineType: (v) => lastSegment(v.machine_type), zone: 'zone' } },
  { type: 'gcp:compute:disk', provider: 'gcp', label: 'Disco', icon: 'gcp:compute-engine', role: 'hidden', tf: ['google_compute_disk'] },
  { type: 'gcp:compute:network', provider: 'gcp', label: 'Rede VPC', icon: 'gcp:vpc', role: 'node', tf: ['google_compute_network'] },
  { type: 'gcp:compute:subnetwork', provider: 'gcp', label: 'Sub-rede', icon: 'gcp:vpc', role: 'hidden', tf: ['google_compute_subnetwork'] },
  { type: 'gcp:compute:firewall', provider: 'gcp', label: 'Firewall', icon: 'gcp:cloud-firewall-rules', role: 'hidden', tf: ['google_compute_firewall'] },
  { type: 'gcp:compute:forwarding-rule', provider: 'gcp', label: 'Load Balancer', icon: 'gcp:cloud-load-balancing', role: 'node', tf: ['google_compute_forwarding_rule', 'google_compute_global_forwarding_rule'] },
  { type: 'gcp:storage:bucket', provider: 'gcp', label: 'Cloud Storage', icon: 'gcp:cloud-storage', role: 'node', shape: 'cylinder', tf: ['google_storage_bucket'], tfAttrs: { storageClass: 'storage_class' } },
  { type: 'gcp:sql:instance', provider: 'gcp', label: 'Cloud SQL', icon: 'gcp:cloud-sql', role: 'node', shape: 'cylinder', tf: ['google_sql_database_instance'], tfAttrs: { databaseVersion: 'database_version' } },
  { type: 'gcp:run:service', provider: 'gcp', label: 'Cloud Run', icon: 'gcp:cloud-run', role: 'node', tf: ['google_cloud_run_service', 'google_cloud_run_v2_service'] },
  { type: 'gcp:functions:function', provider: 'gcp', label: 'Cloud Functions', icon: 'gcp:cloud-functions', role: 'node', tf: ['google_cloudfunctions_function', 'google_cloudfunctions2_function'], tfAttrs: { runtime: 'runtime' } },
  { type: 'gcp:container:cluster', provider: 'gcp', label: 'GKE', icon: 'gcp:gke', role: 'node', tf: ['google_container_cluster'] },
  { type: 'gcp:pubsub:topic', provider: 'gcp', label: 'Pub/Sub', icon: 'gcp:pubsub', role: 'node', tf: ['google_pubsub_topic'] },
  { type: 'gcp:bigquery:dataset', provider: 'gcp', label: 'BigQuery', icon: 'gcp:bigquery', role: 'node', shape: 'cylinder', tf: ['google_bigquery_dataset'] },
];

export const KINDS: readonly KindInfo[] = [...AWS, ...AZURE, ...GCP];

const BY_TYPE = new Map(KINDS.map((kind) => [kind.type, kind]));
const BY_TF = new Map(KINDS.flatMap((kind) => (kind.tf ?? []).map((tf) => [tf, kind] as const)));

export const kindByType = (type: string): KindInfo | undefined => BY_TYPE.get(type);
export const kindByTerraform = (tfType: string): KindInfo | undefined => BY_TF.get(tfType);

/** Generic icons for kinds this table does not know: the provider's mark (the same ids the HCL importer uses). */
export const PROVIDER_ICON: Record<CloudProvider, string> = { aws: 'aws', azure: 'microsoft-azure', gcp: 'gcp' };

function lastSegment(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(value.lastIndexOf('/') + 1) : undefined;
}

/** `az resource list` `type` (lowercase) → canonical kind. */
const ARM: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'azure:compute:virtual-machine',
  'microsoft.compute/disks': 'azure:compute:disk',
  'microsoft.network/virtualnetworks': 'azure:network:virtual-network',
  'microsoft.network/networkinterfaces': 'azure:network:interface',
  'microsoft.network/networksecuritygroups': 'azure:network:security-group',
  'microsoft.network/publicipaddresses': 'azure:network:public-ip',
  'microsoft.network/loadbalancers': 'azure:network:load-balancer',
  'microsoft.network/applicationgateways': 'azure:network:application-gateway',
  'microsoft.storage/storageaccounts': 'azure:storage:account',
  'microsoft.sql/servers': 'azure:sql:server',
  'microsoft.sql/servers/databases': 'azure:sql:database',
  'microsoft.web/sites': 'azure:web:site',
  'microsoft.web/serverfarms': 'azure:web:server-farm',
  'microsoft.keyvault/vaults': 'azure:keyvault:vault',
  'microsoft.documentdb/databaseaccounts': 'azure:documentdb:database-account',
  'microsoft.containerservice/managedclusters': 'azure:containerservice:managed-cluster',
  'microsoft.servicebus/namespaces': 'azure:servicebus:namespace',
  'microsoft.eventhub/namespaces': 'azure:eventhub:namespace',
};

/** Cloud Asset Inventory `assetType` → canonical kind. */
const ASSET: Record<string, string> = {
  'compute.googleapis.com/Instance': 'gcp:compute:instance',
  'compute.googleapis.com/Disk': 'gcp:compute:disk',
  'compute.googleapis.com/Network': 'gcp:compute:network',
  'compute.googleapis.com/Subnetwork': 'gcp:compute:subnetwork',
  'compute.googleapis.com/Firewall': 'gcp:compute:firewall',
  'compute.googleapis.com/ForwardingRule': 'gcp:compute:forwarding-rule',
  'compute.googleapis.com/GlobalForwardingRule': 'gcp:compute:forwarding-rule',
  'storage.googleapis.com/Bucket': 'gcp:storage:bucket',
  'sqladmin.googleapis.com/Instance': 'gcp:sql:instance',
  'run.googleapis.com/Service': 'gcp:run:service',
  'cloudfunctions.googleapis.com/CloudFunction': 'gcp:functions:function',
  'cloudfunctions.googleapis.com/Function': 'gcp:functions:function',
  'container.googleapis.com/Cluster': 'gcp:container:cluster',
  'pubsub.googleapis.com/Topic': 'gcp:pubsub:topic',
  'bigquery.googleapis.com/Dataset': 'gcp:bigquery:dataset',
};

export const kindByArm = (armType: string): KindInfo | undefined => {
  const type = Object.hasOwn(ARM, armType.toLowerCase()) ? ARM[armType.toLowerCase()] : undefined;
  return type ? BY_TYPE.get(type) : undefined;
};
export const kindByAsset = (assetType: string): KindInfo | undefined => {
  const type = Object.hasOwn(ASSET, assetType) ? ASSET[assetType] : undefined;
  return type ? BY_TYPE.get(type) : undefined;
};

/**
 * Resource types whose whole purpose is holding credentials. They are left out of every import (Terraform, CLI listings),
 * not just stripped of their values: a diagram has no use for them and they must never be a reason to read secret data.
 */
const SECRET_BEARING = /(secret|password|private[_-]?key|access[_-]?key|credential|service[_-]?account[_-]?key|cryptokey|kms|certificate|iam[_-]?(?:access|user[_-]?login)|ssh[_-]?key|ssm[_-]?parameter|random_)/i;
export const credentialKind = (type: string): boolean => SECRET_BEARING.test(type);
