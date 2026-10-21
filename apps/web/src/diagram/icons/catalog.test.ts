import { beforeAll, describe, expect, it } from 'vitest';
import brandCategories from './brand-categories.json';
import { browseSections, findIcon, loadIconCatalog, searchIcons } from './catalog';
import type { IconCatalog, IconEntry } from './catalog';
import lucideCategories from './lucide-categories.json';
import { ALIASES, loadIcon } from './registry';

const entry = (name: string, label: string, extra: Partial<IconEntry> = {}): IconEntry => ({
  name,
  label,
  category: 'misc',
  keywords: [],
  source: 'lucide',
  ...extra,
});

function fixture(entries: IconEntry[]): IconCatalog {
  const ids = [...new Set(entries.map((e) => e.category))];
  const labels: Record<string, string> = { misc: 'Diversos', databases: 'Bancos de dados', arrows: 'Setas' };
  return {
    entries,
    categories: ids.map((id) => ({ id, label: labels[id] ?? id, group: 'Ícones gerais', count: entries.filter((e) => e.category === id).length })),
  };
}

const names = (entries: readonly IconEntry[]) => entries.map((e) => e.name);

describe('searchIcons', () => {
  const boxes = fixture([
    entry('inbox', 'Inbox'),
    entry('package', 'Package', { keywords: ['box'] }),
    entry('square-box', 'Square box'),
    entry('boxes', 'Boxes'),
    entry('box-select', 'Box select'),
    entry('box', 'Box'),
    entry('sandbox', 'Sandbox'),
    entry('arrow-up', 'Arrow up', { category: 'arrows' }),
  ]);

  it('ranks exact name, then whole-word prefix, prefix, word prefix, contains — stable inside each rank', () => {
    expect(names(searchIcons(boxes, 'box'))).toEqual(['box', 'box-select', 'boxes', 'square-box', 'inbox', 'package', 'sandbox']);
    expect(names(searchIcons(boxes, '  BOX '))).toEqual(names(searchIcons(boxes, 'box')));
  });

  it('requires every token to match somewhere (name, label, keywords or category)', () => {
    expect(names(searchIcons(boxes, 'box select'))).toEqual(['box-select']);
    expect(names(searchIcons(boxes, 'square box'))).toEqual(['square-box']);
    expect(names(searchIcons(boxes, 'box zebra'))).toEqual([]);
    expect(names(searchIcons(boxes, 'setas'))).toEqual(['arrow-up']);
  });

  it('matches labels and names ignoring punctuation and spacing', () => {
    const catalog = fixture([
      entry('nodemon', 'Nodemon'),
      entry('nodedotjs', 'Node.js', { source: 'simple-icons' }),
      entry('aws-api-gateway', 'API Gateway', { source: 'logos' }),
      entry('gateway', 'Gateway'),
    ]);
    expect(names(searchIcons(catalog, 'nodejs'))).toEqual(['nodedotjs']);
    expect(names(searchIcons(catalog, 'node.js'))).toEqual(['nodedotjs']);
    expect(names(searchIcons(catalog, 'node'))).toEqual(['nodedotjs', 'nodemon']);
    expect(names(searchIcons(catalog, 'api gateway'))).toEqual(['aws-api-gateway']);
    expect(names(searchIcons(catalog, 'apigateway'))).toEqual(['aws-api-gateway']);
  });

  it('ignores accents on both sides', () => {
    const catalog = fixture([entry('user', 'User', { keywords: ['usuario'] }), entry('queue', 'Fila de espera', { keywords: ['mensagens'] })]);
    expect(names(searchIcons(catalog, 'usuário'))).toEqual(['user']);
    expect(names(searchIcons(catalog, 'FÍLA'))).toEqual(['queue']);
    expect(names(searchIcons(catalog, 'mensagéns'))).toEqual(['queue']);
  });

  it('filters by category, and lists the whole category (or catalog) for an empty query', () => {
    const catalog = fixture([entry('a1', 'Um'), entry('b1', 'Dois', { category: 'databases' }), entry('a2', 'Três'), entry('b2', 'Um dois', { category: 'databases' })]);
    expect(names(searchIcons(catalog, 'um', 'databases'))).toEqual(['b2']);
    expect(names(searchIcons(catalog, '', 'databases'))).toEqual(['b1', 'b2']);
    expect(names(searchIcons(catalog, '   '))).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(names(searchIcons(catalog, 'bancos'))).toEqual(['b1', 'b2']);
  });

  it('matches a category only by the start of its words', () => {
    const catalog = fixture([entry('zeta', 'Zeta', { category: 'brands' })]);
    catalog.categories[0]!.label = 'Outras marcas';
    expect(names(searchIcons(catalog, 'marc'))).toEqual(['zeta']);
    expect(names(searchIcons(catalog, 'ar'))).toEqual([]);
  });

  it('never breaks on names from Object.prototype', () => {
    expect(searchIcons(boxes, 'constructor')).toEqual([]);
    expect(searchIcons(boxes, '__proto__')).toEqual([]);
    expect(findIcon(boxes, 'toString')).toBeUndefined();
    expect(findIcon(boxes, '__proto__')).toBeUndefined();
  });
});

describe('icon catalog', () => {
  let catalog: IconCatalog;
  beforeAll(async () => {
    catalog = await loadIconCatalog();
  });

  it('loads once', () => {
    expect(loadIconCatalog()).toBe(loadIconCatalog());
  });

  it('groups every entry in exactly one category, in a fixed order with pt-BR labels', () => {
    const ids = catalog.categories.map((c) => c.id);
    expect(ids.slice(0, 5)).toEqual(['architecture', 'aws', 'gcp', 'azure', 'kubernetes']);
    expect(catalog.categories.map((c) => c.label)).toEqual(
      expect.arrayContaining(['AWS', 'Google Cloud', 'Azure', 'Kubernetes', 'Linguagens', 'Frameworks', 'Bancos de dados', 'Mensageria e streaming', 'DevOps e CI/CD', 'Observabilidade', 'Nuvem e hospedagem', 'Autenticação e segurança', 'IA e dados', 'Outras marcas', 'Arquitetura', 'Setas', 'Dispositivos', 'Arquivos', 'Comunicação', 'Desenvolvimento', 'Dados', 'Pessoas', 'Segurança', 'Mídia', 'Clima', 'Formas', 'Texto', 'Diversos']),
    );
    expect(ids.at(-1)).toBe('misc');
    expect(new Set(catalog.categories.map((c) => c.group))).toEqual(new Set([undefined, 'Provedores de nuvem', 'Marcas e tecnologias', 'Ícones gerais', 'Bibliotecas temáticas']));
    for (const category of catalog.categories) {
      expect(category.count, category.id).toBe(catalog.entries.filter((e) => e.category === category.id).length);
      expect(category.count, category.id).toBeGreaterThan(0);
    }
    expect(catalog.categories.reduce((sum, c) => sum + c.count, 0)).toBe(catalog.entries.length);
    expect(names(catalog.entries)).toEqual(catalog.categories.flatMap((c) => names(catalog.entries.filter((e) => e.category === c.id))));
  });

  it('has every lucide icon and every simple-icons brand the registry can reach, each name once', () => {
    expect(new Set(names(catalog.entries)).size).toBe(catalog.entries.length);
    const count = (source: IconEntry['source']) => catalog.entries.filter((e) => e.source === source && e.category !== 'architecture').length;
    expect(count('lucide')).toBe(Object.keys(lucideCategories).length);
    expect(count('simple-icons')).toBeGreaterThan(3300);
    expect(count('logos')).toBeGreaterThan(70);
    for (const [name, category] of Object.entries(lucideCategories)) {
      const key = ALIASES[name]?.startsWith('si:') || ALIASES[name]?.startsWith('logos:') ? `lucide:${name}` : name;
      expect(findIcon(catalog, key)?.category, key).toBe(category);
    }
  });

  it('resolves every catalog name with loadIcon, from the source it claims', async () => {
    const mode = { lucide: 'stroke', 'simple-icons': 'fill', logos: 'color', 'official-cloud': 'color', specialist: 'stroke' } as const;
    const wrong: string[] = [];
    for (const e of catalog.entries) {
      const icon = await loadIcon(e.name);
      if (icon?.mode !== mode[e.source]) wrong.push(`${e.name} (${e.source} → ${icon?.mode ?? 'null'})`);
    }
    expect(wrong).toEqual([]);
  });

  it('files the curated brands under their subcategory, in the curated order', () => {
    for (const [category, list] of Object.entries(brandCategories)) {
      for (const name of list) expect(findIcon(catalog, name)?.category, name).toBe(category);
      const inCategory = names(searchIcons(catalog, '', category)).filter((name) => list.includes(name));
      expect(inCategory, category).toEqual(list);
    }
    expect(findIcon(catalog, 'stripe')?.category).toBe('brands');
  });

  it('lists the cloud provider icons under AWS, Google Cloud, Azure and Kubernetes', () => {
    const aws = searchIcons(catalog, '', 'aws');
    expect(aws[0]).toMatchObject({ name: 'aws', label: 'AWS', source: 'logos' });
    expect(aws).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'aws-ec2', label: 'EC2' }),
        expect.objectContaining({ name: 'aws-api-gateway', label: 'API Gateway' }),
        expect.objectContaining({ name: 'aws-dynamodb', label: 'DynamoDB' }),
        expect.objectContaining({ name: 'aws-route53', label: 'Route 53' }),
      ]),
    );
    expect(names(searchIcons(catalog, '', 'azure')).slice(0, 2)).toEqual(['azure', 'microsoft-azure']);
    expect(names(searchIcons(catalog, '', 'azure'))).toContain('azure:app-services');
    expect(searchIcons(catalog, '', 'gcp')[0]).toMatchObject({ name: 'google-cloud', label: 'Google Cloud' });
    expect(names(searchIcons(catalog, '', 'gcp'))).toContain('googlebigquery');
    expect(searchIcons(catalog, '', 'kubernetes')[0]).toMatchObject({ name: 'kubernetes', source: 'simple-icons' });
    expect(names(searchIcons(catalog, '', 'kubernetes'))).toContain('helm');
    for (const name of ['azure-icon', 'slack-icon', 'tableau-icon']) expect(findIcon(catalog, name), name).toBeUndefined();
  });

  it('finds official provider services by product name and family', () => {
    expect(searchIcons(catalog, 'aws lambda').map((icon) => icon.name)).toContain('aws:lambda');
    expect(searchIcons(catalog, 'azure identity').map((icon) => icon.name)).toContain('azure:entra-id');
    expect(searchIcons(catalog, 'gcp cloud run').map((icon) => icon.name)).toContain('gcp:cloud-run');
    expect(searchIcons(catalog, 'aws storage').map((icon) => icon.name)).toContain('aws:s3');
    for (const name of ['aws:lambda', 'azure:function-apps', 'gcp:cloud-run']) {
      expect(findIcon(catalog, name)).toMatchObject({ name, source: 'official-cloud' });
    }
  });

  it('offers the Eraser generic names as "Arquitetura", with pt-BR labels', () => {
    const architecture = searchIcons(catalog, '', 'architecture');
    expect(architecture).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api', label: 'API', source: 'lucide' }),
        expect.objectContaining({ name: 'queue', label: 'Fila' }),
        expect.objectContaining({ name: 'document', label: 'Documento', source: 'lucide' }),
        expect.objectContaining({ name: 'load-balancer', label: 'Balanceador de carga', keywords: expect.arrayContaining(['loadbalancer', 'split']) }),
      ]),
    );
    const lucideAliases = Object.entries(ALIASES).filter(([, target]) => target.startsWith('lucide:'));
    expect(architecture.length).toBe(lucideAliases.length - 1); // `loadbalancer` is a keyword of `load-balancer`
    for (const name of ['loadbalancer', 'postgres', 'kafka', 'k8s', 'gcp', 'node']) expect(names(catalog.entries), name).not.toContain(name);
  });

  it('finds brands through their Eraser aliases', () => {
    expect(findIcon(catalog, 'postgres')?.name).toBe('postgresql');
    expect(findIcon(catalog, ' Kafka ')?.name).toBe('apachekafka');
    expect(findIcon(catalog, 'k8s')?.name).toBe('kubernetes');
    expect(findIcon(catalog, 'gcp')?.name).toBe('google-cloud');
    expect(findIcon(catalog, 'aws-simple-storage-service')?.name).toBe('aws-s3');
    expect(findIcon(catalog, 'nodejs')?.name).toBe('nodedotjs');
    expect(searchIcons(catalog, 'postgres')[0]?.name).toBe('postgresql');
    expect(searchIcons(catalog, 'kafka')[0]?.name).toBe('apachekafka');
    expect(searchIcons(catalog, 'redis')[0]?.name).toBe('redis');
  });

  it('keeps the registry precedence: lucide wins a name, unreachable brand slugs are left out', () => {
    expect(findIcon(catalog, 'box')?.source).toBe('lucide');
    expect(findIcon(catalog, 'snowflake')?.source).toBe('lucide');
    expect(findIcon(catalog, 'backstage_casting')).toBeUndefined();
  });

  it('answers pt-BR searches', () => {
    expect(searchIcons(catalog, 'fila')[0]?.name).toBe('queue');
    expect(names(searchIcons(catalog, 'usuario'))).toContain('user');
    expect(names(searchIcons(catalog, 'banco de dados')).slice(0, 3)).toContain('db');
  });

  it('browses "Neste diagrama" (most used first), then "Sugeridos", then every category', () => {
    const sections = browseSections(catalog, ['redis', 'postgres', 'redis', 'definitely-unknown', 'server', 'redis', 'postgresql', '']);
    expect(sections[0]).toMatchObject({ id: 'used', title: 'Neste diagrama' });
    expect(names(sections[0]!.entries)).toEqual(['redis', 'postgresql', 'server']);
    expect(sections[1]).toMatchObject({ id: 'suggested', title: 'Sugeridos' });
    const suggested = names(sections[1]!.entries);
    expect(new Set(suggested).size).toBe(suggested.length);
    expect(suggested).toEqual(expect.arrayContaining(['apachekafka', 'postgresql', 'aws-ec2', 'google-cloud', 'database', 'server']));
    expect(suggested).not.toContain('api'); // "Arquitetura" comes right after
    expect(sections[2]?.id).toBe('architecture');
    expect(sections.slice(2).map((s) => s.id)).toEqual(catalog.categories.map((c) => c.id));
    expect(sections.slice(2).map((s) => s.title)).toEqual(catalog.categories.map((c) => c.label));
    expect(browseSections(catalog, [])[0]?.id).toBe('suggested');
  });
});
