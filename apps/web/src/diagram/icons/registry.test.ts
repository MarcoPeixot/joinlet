import { describe, expect, it } from 'vitest';
import subset from './logos-subset.json';
import { CLOUD_COMPONENT_PRESETS, CLOUD_ICONS } from '@strukt/core/cloud';
import { ALIASES, ICON_SUGGESTIONS, iconSvg, loadIcon, peekIcon } from './registry';

describe('icon registry', () => {
  it('resolves every official cloud icon and component without a provider fallback', async () => {
    expect(CLOUD_ICONS.length).toBeGreaterThan(1700);
    const unresolved: string[] = [];
    for (const item of CLOUD_ICONS) {
      const icon = await loadIcon(item.name);
      if (!icon || icon.mode !== 'color' || !icon.body) unresolved.push(item.name);
    }
    expect(unresolved).toEqual([]);
    expect(CLOUD_COMPONENT_PRESETS.length).toBeGreaterThan(1600);
    expect(CLOUD_COMPONENT_PRESETS.every((preset) => CLOUD_ICONS.some((icon) => icon.name === preset.icon))).toBe(true);
    for (const provider of ['aws', 'azure', 'gcp']) expect(await loadIcon(`${provider}:does-not-exist`)).toBeNull();
  });

  it('keeps cloud SVGs passive and scopes their gradients, masks and clips', async () => {
    for (const item of CLOUD_ICONS) {
      const icon = (await loadIcon(item.name))!;
      for (const body of [icon.body, ...(icon.darkBody ? [icon.darkBody] : [])]) {
        expect(body, item.name).not.toMatch(/<script|<style|<foreignObject|<image|\son\w+=|javascript:|https?:|data:/i);
        const ids = new Set([...body.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!));
        const references = [...body.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((match) => match[1] ?? match[2]!);
        expect(references.every((id) => ids.has(id)), item.name).toBe(true);
      }
    }
    expect(await loadIcon('aws:lambda')).toMatchObject({ viewBox: '0 0 80 80', mode: 'color' });
    expect(await loadIcon('azure:function-apps')).toMatchObject({ viewBox: '0 0 18 18', mode: 'color' });
    expect(await loadIcon('gcp:cloud-run')).toMatchObject({ viewBox: '0 0 512 512', mode: 'color' });
  });

  it('uses the official dark variant in dark SVG exports', async () => {
    const icon = (await loadIcon('aws:resource-server'))!;
    expect(icon.darkBody).toBeTruthy();
    expect(icon.darkBody).not.toBe(icon.body);
    expect(iconSvg(icon, 0, 0, 48, '#fff', 'dark')).toContain(icon.darkBody);
    expect(iconSvg(icon, 0, 0, 48, '#000', 'light')).toContain(icon.body);
  });
  it('resolves lucide glyphs by kebab-case name', async () => {
    const icon = await loadIcon('database');
    expect(icon).toMatchObject({ mode: 'stroke', viewBox: '0 0 24 24' });
    expect(icon?.body).toContain('<ellipse');
  });

  it('resolves document in cards and group headers to the same file-text glyph', async () => {
    expect(await loadIcon('document')).toEqual(await loadIcon('lucide:file-text'));
    expect(await loadIcon('document')).toMatchObject({ mode: 'stroke', viewBox: '0 0 24 24' });
    expect((await loadIcon('document'))?.body).toContain('<path');
  });

  it('resolves brand icons with their color', async () => {
    expect(await loadIcon('redis')).toMatchObject({ mode: 'fill', color: '#FF4438' });
    expect(await loadIcon('Kafka')).toMatchObject({ mode: 'fill' });
  });

  it('falls back to provider icons for Eraser cloud names', async () => {
    expect(await loadIcon('k8s-api')).toMatchObject({ mode: 'fill', color: '#326CE5' });
    expect(await loadIcon('aws-auto-scaling')).toEqual(await loadIcon('aws'));
    expect(await loadIcon('azure-virtual-machine')).toEqual(await loadIcon('microsoft-azure'));
    expect(await loadIcon('gcp-pubsub')).toEqual(await loadIcon('google-cloud'));
  });

  it('resolves official cloud service logos in color', async () => {
    for (const name of ['aws-ec2', 'aws-lambda', 'aws-s3', 'aws-rds', 'aws-api-gateway', 'aws-simple-storage-service']) {
      expect(await loadIcon(name), name).toMatchObject({ mode: 'color', viewBox: '0 0 256 256' });
    }
    expect((await loadIcon('aws-ec2'))?.body).toContain('linearGradient');
    expect(await loadIcon('google-cloud')).toMatchObject({ mode: 'color', viewBox: '0 0 256 206' });
    expect(await loadIcon('microsoft-azure')).toMatchObject({ mode: 'color', viewBox: '0 0 256 242' });
  });

  it('loads logos from a small committed subset of @iconify-json/logos', async () => {
    const names = Object.keys(subset.icons);
    expect(names.length).toBeLessThan(120);
    expect(names).toEqual(expect.arrayContaining(['aws', 'aws-ec2', 'google-cloud', 'microsoft-azure', 'azure-icon', 'slack-icon', 'kubernetes']));
    for (const name of ICON_SUGGESTIONS.filter((n) => n.startsWith('aws-') || n === 'microsoft-azure')) {
      expect(await loadIcon(name), name).toMatchObject({ mode: 'color' });
    }
  });

  it('scopes logo ids per icon, so logos sharing an id upstream never paint with each other’s gradients', async () => {
    const ids = (body: string) => [...body.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
    const refs = (body: string) => [...body.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]!);
    const ec2 = (await loadIcon('aws-ec2'))!.body;
    const lambda = (await loadIcon('aws-lambda'))!.body;
    expect(ids(ec2).length).toBeGreaterThan(0);
    expect(ids(ec2).filter((id) => ids(lambda).includes(id))).toEqual([]);
    for (const body of [ec2, lambda]) expect(refs(body).every((ref) => ids(body).includes(ref))).toBe(true);
  });

  it('prefers the square logo mark and keeps simple-icons brands first', async () => {
    expect(await loadIcon('slack')).toMatchObject({ mode: 'color', viewBox: '0 0 256 256' });
    expect(await loadIcon('azure')).toMatchObject({ mode: 'color', viewBox: '0 0 256 199' });
    expect(await loadIcon('postgresql')).toMatchObject({ mode: 'fill', color: '#4169E1' });
  });

  it('returns null for unknown names and caches results', async () => {
    expect(await loadIcon('definitely-not-an-icon')).toBeNull();
    const first = await loadIcon('server');
    expect(peekIcon(' Server ')).toBe(first);
  });

  it('never resolves a name through Object.prototype', async () => {
    for (const name of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) expect(await loadIcon(name), name).toBeNull();
  });

  it('every alias resolves', async () => {
    for (const name of Object.keys(ALIASES)) expect(await loadIcon(name), name).not.toBeNull();
  });

  it('renders multicolor logos without overriding their paint', () => {
    expect(iconSvg({ viewBox: '0 0 256 256', body: '<path fill="#f90" d="M0 0"/>', mode: 'color' }, 0, 0, 20, '#000')).toBe(
      '<svg x="0" y="0" width="20" height="20" viewBox="0 0 256 256"><path fill="#f90" d="M0 0"/></svg>',
    );
  });

  it('renders nested svg markup', () => {
    const markup = iconSvg({ viewBox: '0 0 24 24', body: '<path d="M0 0"/>', mode: 'fill', color: '#123456' }, 1, 2, 20, '#000');
    expect(markup).toBe('<svg x="1" y="2" width="20" height="20" viewBox="0 0 24 24" fill="#123456"><path d="M0 0"/></svg>');
  });
});
