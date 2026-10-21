import type { ProviderId } from './client';
/** Local SVG brand assets; masks keep marks legible in both themes. */
export function ProviderLogo({ id, size = 24 }: { id: ProviderId; size?: number }) {
  const asset = id === 'opencodego' ? 'opencode' : id;
  return <span aria-hidden="true" style={{ display: 'inline-block', flexShrink: 0, width: size, height: size, backgroundColor: 'currentColor', mask: `url(/brand/providers/${asset}.svg) center / contain no-repeat`, WebkitMask: `url(/brand/providers/${asset}.svg) center / contain no-repeat` }} />;
}
