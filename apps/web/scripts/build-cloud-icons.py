"""Import official cloud SVG packs from an extracted directory (see docs/third-party/cloud-icons.md)."""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'apps/web/src/diagram/icons/cloud'
OUTPUT.mkdir(parents=True, exist_ok=True)
TAGS = set('svg g defs path polygon polyline rect circle ellipse line clipPath linearGradient radialGradient stop mask use filter feBlend feColorMatrix feFlood'.split())
ATTRS = set('id d points x y width height viewBox cx cy r rx ry x1 x2 y1 y2 fx fy transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit clip-path clip-rule opacity gradientTransform gradientUnits offset stop-color stop-opacity mask maskUnits href isolation filter filterUnits flood-color enable-background overflow color-interpolation-filters in in2 result type values'.split())
ALIASES = {
    'aws:simple-storage-service': 's3', 'aws:elastic-container-service': 'ecs', 'aws:elastic-container-registry': 'ecr',
    'aws:elastic-kubernetes-service': 'eks', 'aws:virtual-private-cloud': 'vpc',
    'aws:simple-queue-service': 'sqs', 'aws:simple-notification-service': 'sns',
    'aws:relational-database-service': 'rds', 'aws:elasticache': 'elasticache',
    'aws:resource-elastic-load-balancing-application-load-balancer': 'application-load-balancer',
}
LABELS = {
    'aws:s3': 'Amazon S3', 'aws:ecs': 'Amazon ECS', 'aws:ecr': 'Amazon ECR', 'aws:eks': 'Amazon EKS',
    'aws:vpc': 'Amazon VPC', 'aws:sqs': 'Amazon SQS', 'aws:sns': 'Amazon SNS',
    'gcp:gke': 'Google Kubernetes Engine', 'gcp:vertexai': 'Vertex AI',
}
GCP_RENAMES = {'vertexai': 'vertex-ai', 'cloud-spanner': 'spanner', 'virtual-private-cloud': 'vpc'}
icons = {p: {} for p in ['aws', 'azure', 'gcp']}
metadata = {}


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def declarations(value):
    result = {}
    for statement in value.split(';'):
        if ':' not in statement:
            continue
        key, val = statement.split(':', 1)
        key, val = key.strip(), val.strip()
        if key not in ATTRS or re.search(r'javascript:|https?:|data:|expression\s*\(', val, re.I):
            raise ValueError(f'Unsafe SVG style: {key}: {val}')
        result[key] = val
    return result


def sanitize(path):
    node = ET.fromstring(path.read_text())
    view_box = node.attrib.get('viewBox') or node.attrib.get('xviewBox')
    if not view_box:
        view_box = f"0 0 {node.attrib.get('width', '24').replace('px', '')} {node.attrib.get('height', '24').replace('px', '')}"
    css = {}
    for element in node.iter():
        if element.tag.split('}')[-1] != 'style':
            continue
        for selectors, values in re.findall(r'([^{}]+)\{([^{}]*)\}', element.text or ''):
            for selector in selectors.split(','):
                match = re.fullmatch(r'\.([\w-]+)', selector.strip())
                if not match:
                    raise ValueError(f'Unsupported SVG selector in {path}: {selector}')
                css.setdefault(match[1], {}).update(declarations(values))

    def clean(element):
        element.tag = element.tag.split('}')[-1]
        if element.tag not in TAGS:
            return False
        original = element.attrib.copy()
        element.attrib.clear()
        for name in original.get('class', '').split():
            element.attrib.update(css.get(name, {}))
        for attr, value in original.items():
            attr = attr.split('}')[-1]
            if attr == 'style':
                element.attrib.update(declarations(value))
            elif attr in ATTRS:
                if attr == 'href' and not value.startswith('#'):
                    raise ValueError(f'External SVG href in {path}')
                if re.search(r'javascript:|https?:|data:|expression\s*\(', value, re.I):
                    raise ValueError(f'External SVG attribute in {path}')
                element.set(attr, value)
        element.text = None
        element.tail = None
        for child in list(element):
            if not clean(child):
                element.remove(child)
        return True

    clean(node)
    node.tag = 'g'
    for attr in ['viewBox', 'width', 'height', 'x', 'y']:
        node.attrib.pop(attr, None)
    return {'viewBox': view_box, 'body': ET.tostring(node, encoding='unicode')}


def add(provider, name, label, family, path, kind='service', legacy=False):
    name = ALIASES.get(f'{provider}:{name}', name)
    if provider == 'gcp':
        name = GCP_RENAMES.get(name, name)
    key = f'{provider}:{name}'
    icons[provider][name] = sanitize(path)
    metadata[key] = {
        'name': key, 'label': LABELS.get(key, label), 'provider': provider,
        'family': family, 'kind': kind, 'legacy': legacy,
    }


def aws_identity(path):
    filename = re.sub(r'_\d+(?:_(?:Light|Dark))?\.svg$', '', path.name)
    if filename.startswith('Arch_') and '/64/' in str(path):
        label = filename[5:].replace('-', ' ')
        name = re.sub(r'^(Amazon|AWS)-', '', filename[5:])
        family = path.parents[1].name.removeprefix('Arch_').replace('-', ' ')
        return slug(name), label, family, 'service'
    if filename.startswith('Res_'):
        label = filename[4:].replace('_', ' ').replace('-', ' ')
        family = path.parent.name.removeprefix('Res_').replace('-', ' ')
        if family.startswith('48 '):
            family = 'General icons'
        return 'resource-' + slug(filename[4:]), label, family, 'resource'
    if filename.startswith('Arch-Category_'):
        label = filename.removeprefix('Arch-Category_').replace('-', ' ')
        return 'category-' + slug(label), label, label, 'category'
    if 'Architecture-Group-Icons' in str(path):
        return 'group-' + slug(filename), filename.replace('-', ' '), 'Boundaries', 'group'
    return None


aws_files = sorted((SOURCE / 'aws').rglob('*.svg'))
for path in aws_files:
    if '__MACOSX' in str(path) or '_Dark' in path.name:
        continue
    identity = aws_identity(path)
    if identity:
        name, label, family, kind = identity
        add('aws', name, label, family, path, kind)

for path in aws_files:
    if '__MACOSX' in str(path) or '_Dark' not in path.name:
        continue
    identity = aws_identity(path)
    if not identity:
        continue
    name = ALIASES.get(f'aws:{identity[0]}', identity[0])
    existing = icons['aws'].get(name)
    if existing:
        dark = sanitize(path)
        if dark['viewBox'] != existing['viewBox']:
            raise ValueError(f'Incompatible dark variant: {path}')
        existing['darkBody'] = dark['body']

for path in sorted((SOURCE / 'azure').rglob('*.svg')):
    label = re.sub(r'^\d+-icon-service-', '', path.stem).replace('-', ' ')
    name = slug(label)
    key = f'azure:{name}'
    if key in metadata:
        continue
    add('azure', name, label, path.parent.name, path)

for path in sorted((SOURCE / 'entra').rglob('*color icon.svg')):
    label = path.stem.removesuffix(' color icon')
    add('azure', slug(label.removeprefix('Microsoft ')), label, 'identity', path)

for path in sorted((SOURCE / 'gcp-legacy').rglob('*.svg')):
    name = slug(path.stem)
    label = path.stem.replace('_', ' ').title()
    add('gcp', name, label, 'Legacy console', path, legacy=True)

for path in sorted((SOURCE / 'gcp').rglob('*.svg')):
    label = path.parents[1].name
    add('gcp', slug(label), label, 'Core products', path)

for path in sorted((SOURCE / 'gcp-categories').rglob('*.svg')):
    label = path.parents[1].name.replace(' _ ', ' / ')
    add('gcp', 'category-' + slug(label), label, 'Product categories', path, 'category')

for provider, bodies in icons.items():
    (OUTPUT / f'{provider}.json').write_text(json.dumps(dict(sorted(bodies.items())), ensure_ascii=False, separators=(',', ':')) + '\n')
    print(provider, len(bodies), 'icons')

out = ROOT / 'packages/core/src/cloudIcons.json'
out.write_text(json.dumps(sorted(metadata.values(), key=lambda m: (m['provider'], m['label'])), ensure_ascii=False, indent=2) + '\n')
print('metadata', len(metadata))
