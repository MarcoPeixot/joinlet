import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('consented analytics v2', () => {
  const storage=new Map<string,string>();
  let enabled=true;
  const events=()=>vi.mocked(fetch).mock.calls.filter(([url])=>url==='/telemetry').map(([,init])=>JSON.parse(init!.body as string));
  beforeEach(()=>{
    vi.resetModules();storage.clear();enabled=true;
    vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
    vi.stubGlobal('navigator',{doNotTrack:'0',globalPrivacyControl:false});
    vi.stubGlobal('location',{search:'?utm_source=github&utm_campaign=launch&token=private'});
    vi.stubGlobal('document',{visibilityState:'visible',referrer:'https://github.com/private-repo?token=secret',body:{dataset:{}},documentElement:{lang:'en'},querySelector:(s:string)=>s.includes('joinlet-analytics-source')?{getAttribute:()=> 'editor'}:enabled?{getAttribute:()=>'/telemetry'}:null});
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json({version:2,consent:null})));
  });
  afterEach(()=>vi.unstubAllGlobals());
  it('sends nothing without consent, after declining or without operator configuration',async()=>{
    const c=await import('./client');c.trackAnalytics('editor_ready');expect(events()).toEqual([]);
    c.setAnalyticsConsent('declined');c.trackAnalytics('editor_ready');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));expect(events()).toEqual([]);
    enabled=false;c.setAnalyticsConsent('allowed');c.trackAnalytics('page_view');expect(events()).toEqual([]);
  });
  it('sends a versioned minimized payload only after consent is registered; revocation drops the identifier',async()=>{
    const c=await import('./client');c.setAnalyticsConsent('allowed');
    await vi.waitFor(()=>expect(events()).toHaveLength(1));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/telemetry/consent');
    const e=events()[0];expect(e).toMatchObject({version:2,event:'page_view',source:'editor',referrer:'github.com',page:'editor',guide:'',language:'en',utm_source:'github',utm_campaign:'launch'});
    expect(e.event_id).toMatch(/^[0-9a-f-]{36}$/);expect(e.visitor).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(e)).not.toMatch(/private-repo|secret|token|prompt|country/);
    expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.credentials).toBe('same-origin');
    c.setAnalyticsConsent('declined');c.trackAnalytics('editor_ready');expect([...storage.values()].join('')).not.toContain('visitor');
  });
  it('retries the same event ID and cancels queued telemetry after revocation',async()=>{
    let attempts=0;vi.mocked(fetch).mockImplementation(async(url)=>{if(url==='/telemetry'&&attempts++===0)throw Error('offline');return Response.json({});});
    const c=await import('./client');c.setAnalyticsConsent('allowed');await vi.waitFor(()=>expect(events()).toHaveLength(2));expect(events()[0].event_id).toBe(events()[1].event_id);
    c.trackAnalytics('export_generated',false,{format:'zip'});c.setAnalyticsConsent('declined');await Promise.resolve();expect(events()).toHaveLength(2);
  });
  it('honors privacy controls, v1 consent migration and expiration',async()=>{
    storage.set('joinlet:analytics:v1',JSON.stringify({consent:'allowed',visitor:crypto.randomUUID(),expires:Date.now()+100000}));
    const c=await import('./client');expect(c.analyticsConsent()).toBeNull();c.trackAnalytics('page_view');expect(events()).toEqual([]);
    vi.stubGlobal('navigator',{globalPrivacyControl:true});c.setAnalyticsConsent('allowed');expect(c.analyticsConsent()).toBe('declined');expect(events()).toEqual([]);
    vi.stubGlobal('navigator',{doNotTrack:'0'});c.setAnalyticsConsent('allowed');const key='joinlet:analytics:v2';const value=JSON.parse(storage.get(key)!);storage.set(key,JSON.stringify({...value,expires:0}));expect(c.analyticsConsent()).toBeNull();
  });
  it('never interrupts work when storage is unavailable',async()=>{
    const c=await import('./client');vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});expect(()=>c.trackAnalytics('content_saved',false,{kind:'doc'})).not.toThrow();expect(()=>c.setAnalyticsConsent('allowed')).not.toThrow();
  });
});
