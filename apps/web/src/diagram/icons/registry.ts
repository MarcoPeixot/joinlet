import type { IconifyJSON } from '@iconify-json/logos';
import { own } from '@strukt/core';
import type { Theme } from '../../ui/theme';
import { legibleBrandColor } from '../palette';

export interface IconDef {
  viewBox: string;
  body: string;
  darkBody?: string;
  /** stroke = lucide line glyph, fill = single-color brand mark, color = multicolor logo (paints itself). */
  mode: 'stroke' | 'fill' | 'color';
  color?: string;
}

type IconNode = [string, Record<string, string | number>][];

/**
 * Eraser-style names → concrete icons. `lucide:` = generic glyphs (ISC), `si:` = simple-icons brands (CC0),
 * `logos:` = colored logos from @iconify-json/logos (CC0) — AWS/GCP/Azure service icons and the brands the
 * others lack, from the committed subset `logos-subset.json` (`scripts/build-logos-subset.ts`).
 */
export const ALIASES: Record<string, string> = {
  bitcoin: 'si:bitcoin',
  api: 'lucide:plug',
  gateway: 'lucide:door-open',
  queue: 'lucide:list-ordered',
  cache: 'lucide:zap',
  db: 'lucide:database',
  storage: 'lucide:hard-drive',
  bucket: 'lucide:archive',
  document: 'lucide:file-text',
  function: 'lucide:square-function',
  client: 'lucide:monitor-smartphone',
  browser: 'lucide:globe',
  web: 'lucide:globe',
  mobile: 'lucide:smartphone',
  cdn: 'lucide:globe',
  dns: 'lucide:globe',
  'load-balancer': 'lucide:split',
  loadbalancer: 'lucide:split',
  auth: 'lucide:shield-check',
  security: 'lucide:shield',
  email: 'lucide:mail',
  notification: 'lucide:bell',
  worker: 'lucide:cog',
  scheduler: 'lucide:clock',
  analytics: 'lucide:chart-bar',
  ai: 'lucide:sparkles',
  llm: 'lucide:sparkles',
  kafka: 'si:apachekafka',
  postgres: 'si:postgresql',
  mongo: 'si:mongodb',
  k8s: 'si:kubernetes',
  gcp: 'logos:google-cloud',
  'google-cloud': 'logos:google-cloud',
  'aws-simple-storage-service': 'logos:aws-s3',
  node: 'si:nodedotjs',
  nodejs: 'si:nodedotjs',
  next: 'si:nextdotjs',
  nextjs: 'si:nextdotjs',
};

const PROVIDER_FALLBACK: [string, string][] = [
  ['aws-', 'logos:aws'],
  ['azure-', 'logos:microsoft-azure'],
  ['gcp-', 'logos:google-cloud'],
  ['k8s-', 'si:kubernetes'],
];

export const ICON_SUGGESTIONS = [
  ...Object.keys(ALIASES),
  'server', 'database', 'user', 'users', 'globe', 'shield', 'lock', 'key', 'cloud', 'box', 'layers', 'cpu',
  'redis', 'postgresql', 'mysql', 'mongodb', 'docker', 'kubernetes', 'nginx', 'react', 'graphql', 'rabbitmq',
  'elasticsearch', 'stripe', 'github', 'slack', 'python', 'go',
  'aws-ec2', 'aws-lambda', 'aws-s3', 'aws-rds', 'aws-api-gateway', 'aws-dynamodb', 'aws-sqs', 'aws-sns',
  'microsoft-azure', 'terraform',
].sort();

const cache = new Map<string, IconDef | null>();
let lucideIcons: Promise<Record<string, IconNode>> | null = null;
let simpleIcons: Promise<Map<string, SimpleBrand>> | null = null;
let subsetIcons: Promise<Record<string, SimpleBrand>> | null = null;
let logoSet: Promise<IconifyJSON> | null = null;
type CloudIconSet = Record<string, { viewBox: string; body: string; darkBody?: string }>;
const cloudSets = new Map<string, Promise<CloudIconSet>>();
const cloudLoaders: Record<string, () => Promise<CloudIconSet>> = {
  aws: () => import('./cloud/aws.json').then((mod) => mod.default),
  azure: () => import('./cloud/azure.json').then((mod) => mod.default),
  gcp: () => import('./cloud/gcp.json').then((mod) => mod.default),
};

export const iconKey = (name: string) => name.trim().toLowerCase();

function lucide(): Promise<Record<string, IconNode>> {
  lucideIcons ??= import('lucide').then((mod) => mod.icons as unknown as Record<string, IconNode>);
  return lucideIcons;
}

/** The PascalCase keys lucide names resolve through (deprecated aliases included), for the picker's catalog. */
export async function lucideKeys(): Promise<string[]> {
  return Object.keys(await lucide());
}

type SimpleBrand = { path: string; hex: string };

/** The brands the app references (`scripts/build-icon-subset.ts`), a few hundred KB instead of the whole package. */
function simpleSubset(): Promise<Record<string, SimpleBrand>> {
  subsetIcons ??= import('./simple-subset.json').then((mod) => mod.default as Record<string, SimpleBrand>);
  return subsetIcons;
}

/** The whole simple-icons package, only for a brand outside the subset. */
function simple(): Promise<Map<string, SimpleBrand>> {
  simpleIcons ??= import('simple-icons').then((mod) => {
    const map = new Map<string, SimpleBrand>();
    for (const value of Object.values(mod)) {
      if (value && typeof value === 'object' && 'slug' in value && 'path' in value && 'hex' in value) {
        const icon = value as { slug: string; path: string; hex: string };
        map.set(icon.slug, icon);
      }
    }
    return map;
  });
  return simpleIcons;
}

function logos(): Promise<IconifyJSON> {
  logoSet ??= import('./logos-subset.json').then((mod) => mod.default as IconifyJSON);
  return logoSet;
}

const escapeAttr = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const pascal = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

async function fromLucide(name: string): Promise<IconDef | null> {
  const node = own(await lucide(), pascal(name));
  if (!node) return null;
  const body = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`)
    .join('');
  return { viewBox: '0 0 24 24', body, mode: 'stroke' };
}

async function fromSimple(slug: string): Promise<IconDef | null> {
  const icon = own(await simpleSubset(), slug) ?? (await simple()).get(slug);
  if (!icon) return null;
  return { viewBox: '0 0 24 24', body: `<path d="${escapeAttr(icon.path)}"/>`, mode: 'fill', color: `#${icon.hex}` };
}

/**
 * Upstream logos reuse ids for different gradients (`SVGeyciVcvH` in aws-ec2 and aws-lambda); ids are global in
 * a page or an exported SVG, so two logos would paint with whichever definition comes first. Scope them per icon.
 */
const scopeIds = (body: string, scope: string) =>
  body
    .replace(/ id="([^"]+)"/g, ` id="${scope}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${scope}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${scope}$1"`);

/** Prefers the square mark (`slack-icon`) over the wordmark (`slack`). */
async function fromLogos(name: string): Promise<IconDef | null> {
  const set = await logos();
  const alias = set.aliases && own(set.aliases, name);
  const key = [`${name}-icon`, name, alias?.parent].find((k) => k !== undefined && Object.hasOwn(set.icons, k));
  if (!key) return null;
  const icon = set.icons[key]!;
  const w = icon.width ?? set.width ?? 16;
  const h = icon.height ?? set.height ?? 16;
  return { viewBox: `${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}`, body: scopeIds(icon.body, `logos-${key}-`), mode: 'color' };
}

async function fromCloud(provider: string, name: string): Promise<IconDef | null> {
  const loader = own(cloudLoaders, provider);
  if (!loader) return null;
  let loading = cloudSets.get(provider);
  if (!loading) {
    loading = loader().catch((error: unknown) => {
      cloudSets.delete(provider);
      throw error;
    });
    cloudSets.set(provider, loading);
  }
  const icon = own(await loading, name);
  return icon ? {
    viewBox: icon.viewBox,
    body: scopeIds(icon.body, `cloud-${provider}-${name}-`),
    ...(icon.darkBody ? { darkBody: scopeIds(icon.darkBody, `cloud-${provider}-${name}-dark-`) } : {}),
    mode: 'color',
  } : null;
}

async function resolve(key: string): Promise<IconDef | null> {
  const target = own(ALIASES, key) ?? key;
  if (target.startsWith('domain:')) {
    const pack = await import('./specialist-icons.json');
    const icon = pack.default.find(entry => entry.name === target);
    return icon ? { viewBox: '0 0 24 24', body: icon.body, mode: 'stroke' } : null;
  }
  if (target.startsWith('lucide:')) return fromLucide(target.slice('lucide:'.length));
  if (target.startsWith('si:')) return fromSimple(target.slice('si:'.length));
  if (target.startsWith('logos:')) return fromLogos(target.slice('logos:'.length));
  const cloud = /^(aws|azure|gcp):(.+)$/.exec(target);
  if (cloud) return fromCloud(cloud[1]!, cloud[2]!);
  const direct = (await fromLucide(key)) ?? (await fromSimple(key.replace(/[^a-z0-9]/g, ''))) ?? (await fromLogos(key));
  if (direct) return direct;
  const fallback = PROVIDER_FALLBACK.find(([prefix]) => key.startsWith(prefix));
  return fallback ? resolve(fallback[1]) : null;
}

export async function loadIcon(name: string): Promise<IconDef | null> {
  const key = iconKey(name);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const icon = await resolve(key);
  cache.set(key, icon);
  return icon;
}

/** Synchronous cache read: undefined = not loaded yet, null = unknown icon. */
export function peekIcon(name: string): IconDef | null | undefined {
  return cache.get(iconKey(name));
}

/** An icon as a nested `<svg>`; with `theme`, a brand mark that would vanish on it is painted with `color` instead. */
export function iconSvg(icon: IconDef, x: number, y: number, size: number, color: string, theme?: Theme): string {
  const brand = icon.color && theme ? legibleBrandColor(icon.color, theme) : icon.color;
  const paint =
    icon.mode === 'color'
      ? ''
      : icon.mode === 'fill'
        ? ` fill="${brand ?? color}"`
        : ` fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`;
  const body = theme === 'dark' && icon.darkBody ? icon.darkBody : icon.body;
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${icon.viewBox}"${paint}>${body}</svg>`;
}
