import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_ENDED, setAccessEndedHandler } from './accessEnded';
import { StorageConflict, printManifest } from '@strukt/workspace';
import type { Manifest } from '@strukt/workspace';
import { createRemoteAdapter, matchesRemoteSource, remoteSession } from './remote';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); setAccessEndedHandler(null); });

describe('opening a shared session', () => {
  it('binds Cloud diagram and document collaboration without exposing its scope in the label', () => {
    const session = { repo: 'cloud:workspace-id', csrf: 'c', mcpUrl: 'http://x', mode: 'cloud' as const };
    expect(matchesRemoteSource(session, 'Joinlet Cloud')).toBe(true);
    expect(matchesRemoteSource(session, 'IndexedDB')).toBe(false);
    expect(matchesRemoteSource(session, 'GitHub: cloud:workspace-id')).toBe(false);
  });
  it('reads the role the host gave this invite', async () => {
    vi.stubGlobal('fetch', async () => json({ repo: 'r', csrf: 'c', mcpUrl: 'http://x', mode: 'lan', role: 'comment', readOnly: true }));
    expect(await remoteSession()).toEqual({ kind: 'ready', session: { repo: 'r', csrf: 'c', mcpUrl: 'http://x', mode: 'lan', role: 'comment', readOnly: true } });
  });

  it('tells a person whose invite ended (not the generic "remote server unavailable")', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'Este convite foi revogado ou expirou. Peça um novo link a quem compartilhou.', code: 'invite_ended' }, 401));
    expect(await remoteSession()).toEqual({ kind: 'ended', message: 'Este convite foi revogado ou expirou. Peça um novo link a quem compartilhou.' });
  });

  it('keeps the login flow for the GitHub-hosted 401', async () => {
    vi.stubGlobal('fetch', async () => json({ mcpUrl: 'https://mcp.example' }, 401));
    expect(await remoteSession()).toEqual({ kind: 'login', mcpUrl: 'https://mcp.example' });
  });
});

describe('the remote adapter', () => {
  const session = { repo: 'r', csrf: 'c', mcpUrl: 'http://x', mode: 'lan' as const };

  it('keeps each Cloud adapter pinned to its workspace when another tab is opened',async()=>{
    const scopes:string[]=[];
    vi.stubGlobal('fetch',async(_url:string,init?:RequestInit)=>{scopes.push(new Headers(init?.headers).get('x-joinlet-workspace')!);return json({text:null});});
    const first=createRemoteAdapter({...session,mode:'cloud',repo:'cloud:first'}),second=createRemoteAdapter({...session,mode:'cloud',repo:'cloud:second'});
    await first.read('docs/note.md');await second.read('docs/note.md');await first.write('docs/note.md','First project');
    expect(scopes).toEqual(['cloud:first','cloud:second','cloud:first']);
  });

  it('a request refused because the invite ended tells the app once and fails with the host\'s words', async () => {
    const ended = vi.fn();
    setAccessEndedHandler(ended);
    vi.stubGlobal('fetch', async () => json({ error: 'Este convite foi revogado ou expirou.', code: 'invite_ended' }, 401));
    const adapter = createRemoteAdapter(session);
    await expect(adapter.read('strukt.json')).rejects.toThrow('Este convite foi revogado ou expirou.');
    await expect(adapter.list()).rejects.toThrow('revogado ou expirou');
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith(ACCESS_ENDED);
  });

  it('an ordinary failure does not end the session', async () => {
    const ended = vi.fn();
    setAccessEndedHandler(ended);
    vi.stubGlobal('fetch', async () => json({ error: 'Arquivo alterado fora da sessão.' }, 409));
    await expect(createRemoteAdapter(session).write('docs/a.md', 'x')).rejects.toThrow('Arquivo alterado');
    expect(ended).not.toHaveBeenCalled();
  });

  it('a refused write for a file that changed is a conflict the comments store can retry', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'Arquivo alterado fora da sessão.' }, 409));
    await expect(createRemoteAdapter(session).write('comments/diagram-a.json', 'x')).rejects.toBeInstanceOf(StorageConflict);
  });

  it('a comment link sends comment files and nothing else; a view link sends nothing', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') sent.push(JSON.parse(String(init.body)).path);
      return json({ ok: true, text: null });
    });
    const comment = createRemoteAdapter({ ...session, role: 'comment', readOnly: true, member: 'i:1' });
    await comment.write('comments/diagram-a.json', '{}');
    await comment.write('docs/a.md', 'x');
    await comment.remove('comments/diagram-a.json');
    await comment.remove('strukt.json');
    const view = createRemoteAdapter({ ...session, role: 'view', readOnly: true, member: 'i:2' });
    await view.write('comments/diagram-a.json', '{}');
    expect(sent).toEqual(['comments/diagram-a.json', 'comments/diagram-a.json']);
  });
});

describe('the manifest is shared by every guest (P1: a second guest\'s new item used to be lost)', () => {
  const session = { repo: 'r', csrf: 'c', mcpUrl: 'http://x', mode: 'lan' as const };
  const manifest = (...slugs: string[]): Manifest => ({ version: 1, name: 'Loja', diagrams: slugs.map((slug) => ({ slug, title: slug })), docs: [], sketches: [] });

  /** A tiny host: one `strukt.json`, refusing a write whose `expected` is not what it holds (like the REST surface). */
  function host(initial: Manifest) {
    const state = { text: printManifest(initial), writes: 0 };
    const fetcher = async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { text: string; expected: string | null };
        if (body.expected !== state.text) return json({ error: 'Arquivo alterado fora da sessão.' }, 409);
        state.text = body.text;
        state.writes++;
        return json({ ok: true, revision: 1 });
      }
      return json({ text: state.text });
    };
    return { state, fetcher };
  }

  it('a write over a manifest that moved on keeps both guests\' items, tells the app, and is retried by the next save', async () => {
    const remote = host(manifest('mapa'));
    vi.stubGlobal('fetch', remote.fetcher);
    const cris = createRemoteAdapter(session);
    await cris.read('strukt.json'); // Cris loads the list: only Mapa
    const merged: { base: string | null; theirs: string }[] = [];
    cris.onManifestMerged((update) => merged.push(update));
    remote.state.text = printManifest(manifest('mapa', 'do-ana')); // Ana saved her item meanwhile
    await cris.write('strukt.json', printManifest(manifest('mapa', 'do-cris')));
    expect((JSON.parse(remote.state.text) as Manifest).diagrams.map((d) => d.slug)).toEqual(['mapa', 'do-ana', 'do-cris']);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.theirs).toBe(remote.state.text);
    // The baseline moved to what is on the host: the next save is not a conflict again.
    await cris.write('strukt.json', printManifest(manifest('mapa', 'do-ana', 'do-cris', 'terceiro')));
    expect((JSON.parse(remote.state.text) as Manifest).diagrams.map((d) => d.slug)).toEqual(['mapa', 'do-ana', 'do-cris', 'terceiro']);
    expect(merged).toHaveLength(1);
  });

  it('after a failed save the retry still works (the baseline is the host\'s text, not the stale one)', async () => {
    const remote = host(manifest('mapa'));
    let failOnce = true;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && failOnce) { failOnce = false; remote.state.text = printManifest(manifest('mapa', 'do-ana')); }
      return remote.fetcher(url, init);
    });
    const cris = createRemoteAdapter(session);
    await cris.read('strukt.json');
    await cris.write('strukt.json', printManifest(manifest('mapa', 'do-cris')));
    expect((JSON.parse(remote.state.text) as Manifest).diagrams.map((d) => d.slug)).toEqual(['mapa', 'do-ana', 'do-cris']);
  });

  it('polling reports a manifest someone else saved, once, and nothing when it is unchanged', async () => {
    const remote = host(manifest('mapa'));
    vi.stubGlobal('fetch', remote.fetcher);
    const guest = createRemoteAdapter(session);
    const first = await guest.read('strukt.json');
    expect(await guest.pollManifest()).toBeNull();
    remote.state.text = printManifest(manifest('mapa', 'novo'));
    expect(await guest.pollManifest()).toEqual({ base: first, theirs: remote.state.text });
    expect(await guest.pollManifest()).toBeNull();
  });

  it('its own save is never reported back as somebody else\'s', async () => {
    const remote = host(manifest('mapa'));
    vi.stubGlobal('fetch', remote.fetcher);
    const guest = createRemoteAdapter(session);
    await guest.read('strukt.json');
    await guest.write('strukt.json', printManifest(manifest('mapa', 'meu')));
    expect(await guest.pollManifest()).toBeNull();
  });
});
