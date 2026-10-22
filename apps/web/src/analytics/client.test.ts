import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('optional analytics privacy boundary', () => {
  const storage = new Map<string, string>();
  let enabled = true;
  beforeEach(() => {
    vi.resetModules(); storage.clear(); enabled = true;
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('navigator', { doNotTrack: '0', globalPrivacyControl: false });
    vi.stubGlobal('document', { visibilityState: 'visible', referrer: 'https://github.com/private-repo?token=secret', querySelector: (selector: string) => selector.includes('joinlet-analytics-source') ? { getAttribute: () => 'editor' } : enabled ? { getAttribute: () => '/telemetry' } : null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('sends nothing without consent or without operator configuration', async () => {
    const client = await import('./client');
    client.trackAnalytics('editor_ready'); expect(fetch).not.toHaveBeenCalled();
    client.setAnalyticsConsent('declined'); client.trackAnalytics('editor_ready'); expect(fetch).not.toHaveBeenCalled();
    enabled = false; client.setAnalyticsConsent('allowed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('only sends a random id, explicit event, source and approved referrer; revocation removes id', async () => {
    const client = await import('./client'); client.setAnalyticsConsent('allowed');
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(['event','referrer','source','visitor']);
    expect(body).toMatchObject({ event: 'page_view', source: 'editor', referrer: 'github.com' });
    expect(JSON.stringify(body)).not.toContain('private-repo'); expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.visitor).toMatch(/^[0-9a-f-]{36}$/);
    vi.mocked(fetch).mockClear(); client.setAnalyticsConsent('declined'); client.trackAnalytics('editor_ready');
    expect(fetch).not.toHaveBeenCalled(); expect([...storage.values()][0]).not.toContain('visitor');
  });
  it('honors browser privacy controls and expired preferences', async () => {
    const client = await import('./client'); client.setAnalyticsConsent('allowed'); vi.mocked(fetch).mockClear();
    vi.stubGlobal('navigator', { globalPrivacyControl: true }); client.trackAnalytics('editor_edited'); expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { doNotTrack: '0' });
    const key = [...storage.keys()][0]!; const value = JSON.parse(storage.get(key)!); storage.set(key, JSON.stringify({ ...value, expires: 0 }));
    client.trackAnalytics('editor_ready'); expect(fetch).not.toHaveBeenCalled(); expect(client.analyticsConsent()).toBeNull();
  });
  it('swallows transport and storage failures', async () => {
    const client = await import('./client'); client.setAnalyticsConsent('allowed');
    vi.mocked(fetch).mockRejectedValue(new Error('offline')); expect(() => client.trackAnalytics('export_generated')).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); } }); expect(() => client.trackAnalytics('editor_ready')).not.toThrow();
  });
});
