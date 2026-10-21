import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';

/** Similar topology to the reported streaming example, without encoding AWS rules in the layout. */
export function streamingFixture(presentation: 'icon' | 'card' = 'icon') {
  const ops: DiagramOp[] = [
    { op: 'set_style', set: { direction: 'right' } },
    { op: 'add_group', id: 'Cloud', label: 'AWS Cloud', icon: 'cloud', color: 'orange' },
    { op: 'add_group', id: 'Region', label: 'Region · us-east-1', parentId: 'Cloud', color: 'blue' },
    { op: 'add_group', id: 'VPC', parentId: 'Region', color: 'green' },
    { op: 'add_group', id: 'Subnet', label: 'Private subnet', parentId: 'VPC', color: 'purple' },
    ...[
      ['Viewers', undefined, 'users', ''], ['CloudFront', 'Cloud', 'aws:cloudfront', 'CDN'],
      ['Gateway', 'Region', 'aws:api-gateway', 'API Gateway'], ['Playback', 'Subnet', 'aws:lambda', 'Lambda'],
      ['Cache', 'Subnet', 'redis', 'Redis'], ['Queue', 'Region', 'aws:sqs', 'SQS'],
      ['Transcoder', 'Region', 'cpu', 'MediaConvert'], ['Metadata', 'Region', 'aws:dynamodb', 'DynamoDB'],
      ['Segments', 'Region', 'aws:s3', 'S3'], ['Assets', 'Region', 'aws:s3', 'S3'],
    ].map(([id, parentId, icon, tech]) => ({ op: 'add_node', id, parentId, icon, tech, presentation } as DiagramOp)),
    ...[
      ['Viewers', 'CloudFront', 'HTTPS'], ['CloudFront', 'Gateway', 'API'], ['CloudFront', 'Assets', 'assets'],
      ['CloudFront', 'Segments', 'segments'], ['Gateway', 'Playback', 'REST'], ['Playback', 'Cache', 'session'],
      ['Playback', 'Metadata', 'catalog'], ['Playback', 'Queue', 'enqueue', '-->'], ['Queue', 'Transcoder', 'jobs', '-->'],
      ['Transcoder', 'Segments', 'write'], ['Transcoder', 'Metadata', 'status'],
    ].map(([from, to, label, connector]) => ({ op: 'connect', from, to, label, connector: connector ?? '>' } as DiagramOp)),
  ];
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw Error(result.error.message);
  return result.model;
}
