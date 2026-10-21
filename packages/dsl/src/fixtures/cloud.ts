import type { AwsInputs } from '../import/cloud/aws';
import identityJson from './cloud/aws/sts-get-caller-identity.json' with { type: 'json' };
import instancesJson from './cloud/aws/ec2-describe-instances.json' with { type: 'json' };
import vpcsJson from './cloud/aws/ec2-describe-vpcs.json' with { type: 'json' };
import subnetsJson from './cloud/aws/ec2-describe-subnets.json' with { type: 'json' };
import securityGroupsJson from './cloud/aws/ec2-describe-security-groups.json' with { type: 'json' };
import natGatewaysJson from './cloud/aws/ec2-describe-nat-gateways.json' with { type: 'json' };
import internetGatewaysJson from './cloud/aws/ec2-describe-internet-gateways.json' with { type: 'json' };
import loadBalancersJson from './cloud/aws/elbv2-describe-load-balancers.json' with { type: 'json' };
import targetGroupsJson from './cloud/aws/elbv2-describe-target-groups.json' with { type: 'json' };
import healthWebJson from './cloud/aws/elbv2-describe-target-health-shop-web-tg.json' with { type: 'json' };
import healthApiJson from './cloud/aws/elbv2-describe-target-health-shop-api-tg.json' with { type: 'json' };
import rdsInstancesJson from './cloud/aws/rds-describe-db-instances.json' with { type: 'json' };
import rdsClustersJson from './cloud/aws/rds-describe-db-clusters.json' with { type: 'json' };
import lambdaFunctionsJson from './cloud/aws/lambda-list-functions.json' with { type: 'json' };
import eventSourceMappingsJson from './cloud/aws/lambda-list-event-source-mappings.json' with { type: 'json' };
import bucketsJson from './cloud/aws/s3api-list-buckets.json' with { type: 'json' };
import queuesJson from './cloud/aws/sqs-list-queues.json' with { type: 'json' };
import topicsJson from './cloud/aws/sns-list-topics.json' with { type: 'json' };
import subscriptionsJson from './cloud/aws/sns-list-subscriptions.json' with { type: 'json' };
import dynamoTablesJson from './cloud/aws/dynamodb-list-tables.json' with { type: 'json' };
import apisJson from './cloud/aws/apigatewayv2-get-apis.json' with { type: 'json' };
import integrationsJson from './cloud/aws/apigatewayv2-get-integrations-abc123xyz.json' with { type: 'json' };
import ecsClustersJson from './cloud/aws/ecs-list-clusters.json' with { type: 'json' };
import ecsServicesListJson from './cloud/aws/ecs-list-services-shop-cluster.json' with { type: 'json' };
import ecsServicesJson from './cloud/aws/ecs-describe-services-shop-cluster.json' with { type: 'json' };
import eksListJson from './cloud/aws/eks-list-clusters.json' with { type: 'json' };
import eksClusterJson from './cloud/aws/eks-describe-cluster-shop-eks.json' with { type: 'json' };
import azureListing from './cloud/azure/az-resource-list.json' with { type: 'json' };
import gcpListing from './cloud/gcp/asset-search-all-resources.json' with { type: 'json' };
import tfState from './cloud/terraform/terraform-show-state.json' with { type: 'json' };
import tfPlan from './cloud/terraform/terraform-show-plan.json' with { type: 'json' };

/**
 * Recorded-shape outputs of the read-only cloud CLIs (`aws … --output json`, `az resource list`, `gcloud asset
 * search-all-resources`) and of `terraform show -json`, for a small shop. They are hand-written from the documented
 * output formats, NOT captured from a real account; sentinel strings (SENTINEL…) mark every value an import must never carry.
 */
export const AWS_ACCOUNT = '123456789012';
export const AWS_REGION = 'us-east-1';
export const SECRET_SENTINELS = ['SENTINEL', 'hunter2', 'sk_live', 'wJalrXUtnFEMI', 'ops-oncall@example.com', 'shopadmin', 'AccountKey'] as const;

export const awsOutputs = {
  identity: identityJson,
  instances: instancesJson,
  vpcs: vpcsJson,
  subnets: subnetsJson,
  securityGroups: securityGroupsJson,
  natGateways: natGatewaysJson,
  internetGateways: internetGatewaysJson,
  loadBalancers: loadBalancersJson,
  targetGroups: targetGroupsJson,
  healthWeb: healthWebJson,
  healthApi: healthApiJson,
  rdsInstances: rdsInstancesJson,
  rdsClusters: rdsClustersJson,
  lambdaFunctions: lambdaFunctionsJson,
  eventSourceMappings: eventSourceMappingsJson,
  buckets: bucketsJson,
  queues: queuesJson,
  topics: topicsJson,
  subscriptions: subscriptionsJson,
  dynamoTables: dynamoTablesJson,
  apis: apisJson,
  integrations: integrationsJson,
  ecsClusters: ecsClustersJson,
  ecsServicesList: ecsServicesListJson,
  ecsServices: ecsServicesJson,
  eksList: eksListJson,
  eksCluster: eksClusterJson,
} as const;

export function awsInputs(): AwsInputs {
  const o = awsOutputs;
  const tg = o.targetGroups.TargetGroups;
  return {
    region: AWS_REGION,
    account: o.identity.Account,
    instances: o.instances, vpcs: o.vpcs, subnets: o.subnets, securityGroups: o.securityGroups, natGateways: o.natGateways, internetGateways: o.internetGateways,
    loadBalancers: o.loadBalancers, targetGroups: o.targetGroups,
    targetHealth: { [tg[0]!.TargetGroupArn]: o.healthWeb, [tg[1]!.TargetGroupArn]: o.healthApi },
    rdsInstances: o.rdsInstances, rdsClusters: o.rdsClusters, lambdaFunctions: o.lambdaFunctions, eventSourceMappings: o.eventSourceMappings,
    buckets: o.buckets, queues: o.queues, topics: o.topics, subscriptions: o.subscriptions, dynamoTables: o.dynamoTables,
    apis: o.apis, integrations: { abc123xyz: o.integrations },
    ecsClusters: o.ecsClusters, ecsServices: { [o.ecsClusters.clusterArns[0]!]: o.ecsServices },
    eksClusters: [o.eksCluster],
  };
}

export const azureListingJson = azureListing;
export const gcpListingJson = gcpListing;
export const terraformStateText = JSON.stringify(tfState, null, 2);
export const terraformPlanText = JSON.stringify(tfPlan, null, 2);
