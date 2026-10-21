import metadata from './cloudIcons.json' with { type: 'json' };
import type { ComponentPreset } from './components';

export type CloudProvider = 'aws' | 'azure' | 'gcp';

export interface CloudIconMetadata {
  name: string;
  label: string;
  provider: CloudProvider;
  family: string;
  kind: 'service' | 'resource' | 'group' | 'category';
  legacy: boolean;
}

export const CLOUD_ICONS = metadata as CloudIconMetadata[];

const PROVIDER_LABELS: Record<CloudProvider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };

export const CLOUD_COMPONENT_PRESETS: readonly ComponentPreset[] = CLOUD_ICONS
  .filter((icon) => icon.kind !== 'category')
  .map((icon) => ({
    id: icon.name,
    label: icon.label,
    category: PROVIDER_LABELS[icon.provider],
    description: `${icon.family} · ${icon.kind === 'group' ? 'Fronteira' : icon.kind === 'resource' ? 'Recurso' : 'Serviço'} oficial ${PROVIDER_LABELS[icon.provider]}`,
    ...(icon.kind === 'group' ? { kind: 'group' as const, width: 400, height: 260 } : { presentation: 'icon' as const }),
    icon: icon.name,
    color: 'gray',
  }));
