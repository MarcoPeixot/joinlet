import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditFileName, createAuditLog } from './audit';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'strukt-audit-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const make = (options: Partial<Parameters<typeof createAuditLog>[0]> = {}) => createAuditLog({ dir: join(dir, 'audit'), root: '/work/meu repo', now: () => Date.parse('2026-10-03T12:00:00.000Z'), ...options });

describe('audit log', () => {
  it('names the file after the workspace folder, with a short hash so two folders of the same name never share one', () => {
    const a = auditFileName('/work/meu repo');
    expect(a).toMatch(/^meu-repo-[0-9a-f]{8}\.jsonl$/);
    expect(auditFileName('/other/meu repo')).not.toBe(a);
    expect(auditFileName('/work/..')).toMatch(/^workspace-[0-9a-f]{8}\.jsonl$/);
    expect(auditFileName('/work/__proto__')).toMatch(/^__proto__-[0-9a-f]{8}\.jsonl$/); // a plain file name, never a key
  });

  it('appends one JSON line per event, newest last on disk and newest first when read, private to the owner', async () => {
    const audit = make();
    audit.record({ type: 'share.start' });
    audit.record({ type: 'invite.create', invite: 'Ana', inviteId: 'i1', role: 'edit', expiresAt: 1234 });
    audit.record({ type: 'join', invite: 'Ana', role: 'edit', ip: audit.hashIp('10.0.0.7') });
    await audit.flush();
    const file = join(dir, 'audit', auditFileName('/work/meu repo'));
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(['share.start', 'invite.create', 'join']);
    expect(lines[0]).toEqual({ t: '2026-10-03T12:00:00.000Z', type: 'share.start' });
    expect(lines[1]).toMatchObject({ invite: 'Ana', inviteId: 'i1', role: 'edit', expiresAt: 1234 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'audit'))).mode & 0o777).toBe(0o700);
    expect((await audit.recent()).map((entry) => entry.type)).toEqual(['join', 'invite.create', 'share.start']);
    expect(await audit.recent(2)).toHaveLength(2);
  });

  it('records a short salted hash of the IP, never the address', async () => {
    const audit = make();
    const hash = audit.hashIp('203.0.113.9');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(audit.hashIp('203.0.113.9')).toBe(hash);
    expect(audit.hashIp('203.0.113.10')).not.toBe(hash);
    expect(make().hashIp('203.0.113.9')).not.toBe(hash); // another salt per log
    audit.record({ type: 'denied', ip: hash, reason: 'invalid_token' });
    await audit.flush();
    expect(await readFile(join(dir, 'audit', auditFileName('/work/meu repo')), 'utf8')).not.toContain('203.0.113');
    expect(audit.hashIp(undefined)).toBe('unknown');
  });

  it('keeps only the fields of its schema and trims what they may hold: no content, no tokens, no free text', async () => {
    const audit = make();
    audit.record({
      type: 'write', invite: 'Ana\u0000\nSouza'.padEnd(500, 'x'), inviteId: 'i1', role: 'edit', path: 'diagrams/mapa.strukt.json', op: 'write',
      text: '# conteúdo secreto', token: 'segredo', body: { a: 1 }, reason: 'drop table',
    } as never);
    audit.record({ type: 'write', path: '../../etc/passwd\u0000' as string, role: 'root' as never, op: 'format' as never });
    audit.record({ type: 'nope' } as never);
    await audit.flush();
    const raw = await readFile(join(dir, 'audit', auditFileName('/work/meu repo')), 'utf8');
    for (const secret of ['conteúdo secreto', 'segredo', 'drop table', 'etc/passwd', 'root']) expect(raw).not.toContain(secret);
    const [first, second, ...rest] = raw.trim().split('\n').map((line) => JSON.parse(line));
    expect(rest).toEqual([]);
    expect(first.invite.length).toBeLessThanOrEqual(60);
    expect(first.invite).not.toMatch(/[\u0000-\u001f]/);
    expect(Object.keys(first).sort()).toEqual(['invite', 'inviteId', 'op', 'path', 'role', 't', 'type']);
    expect(Object.keys(second).sort()).toEqual(['t', 'type']);
  });

  it('rotates by size, keeping the last files, and reads across them', async () => {
    const audit = make({ maxBytes: 600, keep: 2 });
    for (let i = 0; i < 40; i++) audit.record({ type: 'write', invite: `convidado ${i}`, path: `docs/n${i}.md`, op: 'write' });
    await audit.flush();
    const files = (await readdir(join(dir, 'audit'))).sort();
    const base = auditFileName('/work/meu repo');
    expect(files).toEqual([base, `${base}.1`, `${base}.2`]);
    for (const file of files) expect((await stat(join(dir, 'audit', file))).size).toBeLessThan(900);
    const recent = await audit.recent(100);
    expect(recent[0]!.invite).toBe('convidado 39');
    expect(recent.length).toBeGreaterThan(10);
    expect(recent.length).toBeLessThan(40);
    expect(recent.map((entry) => entry.invite)).toEqual([...recent.map((entry) => entry.invite)].sort((a, b) => Number(b!.split(' ')[1]) - Number(a!.split(' ')[1])));
  });

  it('returns at most the last 100 and skips damaged lines', async () => {
    const audit = make();
    await mkdir(join(dir, 'audit'), { recursive: true });
    const file = join(dir, 'audit', auditFileName('/work/meu repo'));
    const lines = Array.from({ length: 130 }, (_, i) => JSON.stringify({ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: `p${i}` }));
    lines.splice(5, 0, '{quebrado', '', JSON.stringify({ type: 'desconhecido' }), JSON.stringify([1]));
    await writeFile(file, `${lines.join('\n')}\n`);
    const recent = await audit.recent(1000);
    expect(recent).toHaveLength(100);
    expect(recent[0]!.invite).toBe('p129');
    expect(recent.at(-1)!.invite).toBe('p30');
  });

  it('never throws to its caller: a disk failure only warns (without the event)', async () => {
    const blocked = join(dir, 'file');
    await writeFile(blocked, 'x');
    const warnings: string[] = [];
    const audit = createAuditLog({ dir: join(blocked, 'audit'), root: '/r', warn: (message) => warnings.push(message) });
    audit.record({ type: 'join', invite: 'Ana' });
    await audit.flush();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('Ana');
    expect(await audit.recent()).toEqual([]);
  });
});
