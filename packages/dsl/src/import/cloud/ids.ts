/** The ARN pieces the importers need; `undefined` for anything that is not a plain `arn:partition:service:region:account:resource`. */
export function parseArn(value: unknown): { partition: string; service: string; region: string; account: string; resource: string } | undefined {
  if (typeof value !== 'string' || !value.startsWith('arn:') || value.length > 2048) return undefined;
  const parts = value.split(':');
  if (parts.length < 6) return undefined;
  return { partition: parts[1]!, service: parts[2]!, region: parts[3]!, account: parts[4]!, resource: parts.slice(5).join(':') };
}

/** Path segment of an EC2-family ARN (`arn:aws:ec2:<region>:<account>:<segment>/<id>`) per canonical kind. */
const EC2_SEGMENT: Record<string, string> = {
  'aws:ec2:instance': 'instance',
  'aws:ec2:vpc': 'vpc',
  'aws:ec2:subnet': 'subnet',
  'aws:ec2:security-group': 'security-group',
  'aws:ec2:nat-gateway': 'natgateway',
  'aws:ec2:internet-gateway': 'internet-gateway',
};

/** The ARN of an EC2-family resource from its native id, so the CLI import and Terraform agree on one drift key. */
export function ec2Arn(type: string, nativeId: string, region: string | undefined, account: string | undefined): string | undefined {
  const segment = Object.hasOwn(EC2_SEGMENT, type) ? EC2_SEGMENT[type] : undefined;
  return segment && region && account ? `arn:aws:ec2:${region}:${account}:${segment}/${nativeId}` : undefined;
}

export const azureId = (id: string): string => id.trim().replace(/\/+$/, '').toLowerCase();

/**
 * `//compute.googleapis.com/projects/p/zones/z/instances/i` and Terraform's `projects/p/zones/z/instances/i` become the same
 * key; a bare Cloud Storage bucket name becomes its canonical `projects/_/buckets/<name>`.
 */
export function gcpName(raw: string): string {
  const name = raw.slice(0, 2048);
  const bucket = /^\/\/storage\.googleapis\.com\/([a-z0-9._-]{3,222})$/.exec(name);
  if (bucket) return `projects/_/buckets/${bucket[1]}`;
  const stripped = name.replace(/^\/\/[a-z0-9.-]+\.googleapis\.com\//, '').replace(/^https:\/\/[a-z0-9.-]+\.googleapis\.com\/(?:[a-z0-9_.-]+\/)*?(?=projects\/)/, '');
  return stripped.replace(/^\/+/, '');
}

/** `us-east-1a` → `us-east-1`; `us-central1-b` → `us-central1`. */
export function regionOfZone(zone: string): string {
  return /^[a-z]{2}-[a-z]+-\d[a-z]$/.test(zone) ? zone.slice(0, -1) : /^[a-z]+-[a-z]+\d-[a-z]$/.test(zone) ? zone.slice(0, zone.lastIndexOf('-')) : zone;
}

/** The first value of an AWS-style tag list (`[{Key, Value}]`) or map named `Name`. */
export function nameTag(tags: unknown): string | undefined {
  if (Array.isArray(tags)) {
    for (const tag of tags.slice(0, 100)) {
      if (typeof tag === 'object' && tag !== null && (tag as Record<string, unknown>).Key === 'Name') {
        const value = (tag as Record<string, unknown>).Value;
        if (typeof value === 'string') return value;
      }
    }
    return undefined;
  }
  if (typeof tags === 'object' && tags !== null && Object.hasOwn(tags, 'Name')) {
    const value = (tags as Record<string, unknown>).Name;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
