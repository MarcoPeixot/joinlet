import { describe, expect, it } from 'vitest';
import { createInviteRegistry, INVITE_TTLS } from './invites';
import type { InviteEvent } from './invites';
import { UserError } from './userError';

function setup(start = 1_000_000) {
  let time = start;
  const events: InviteEvent[] = [];
  let counter = 0;
  const registry = createInviteRegistry({
    now: () => time,
    newId: () => `id${++counter}`,
    newToken: () => `tok${counter}-${'x'.repeat(40)}`,
    onEvent: (event) => events.push(event),
  });
  return { registry, events, advance: (ms: number) => { time += ms; } };
}

describe('invite registry', () => {
  it('creates named invites with a role, a token of their own and an expiry', () => {
    const { registry, events } = setup();
    const invite = registry.create({ name: ' Ana  Souza ', role: 'comment', ttl: '24h' });
    expect(invite).toMatchObject({ id: 'id1', name: 'Ana Souza', role: 'comment', createdAt: 1_000_000, expiresAt: 1_000_000 + INVITE_TTLS['24h'] });
    expect(invite.token.length).toBeGreaterThan(30);
    expect(registry.create({ name: 'Sem prazo', role: 'view', ttl: 'never' }).expiresAt).toBeNull();
    expect(registry.list().map((entry) => entry.name)).toEqual(['Ana Souza', 'Sem prazo']);
    expect(events.map((event) => event.type)).toEqual(['create', 'create']);
  });

  it('generates 256-bit tokens by default and never repeats one', () => {
    const registry = createInviteRegistry();
    const tokens = new Set(Array.from({ length: 50 }, () => registry.create({ name: 'x', role: 'view', ttl: 'never' }).token));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refuses a bad name, role or validity, and too many invites, with pt-BR messages', () => {
    const { registry } = setup();
    const bad = (input: Record<string, unknown>) => () => registry.create(input as never);
    expect(bad({ name: '', role: 'view', ttl: '1h' })).toThrow(UserError);
    expect(bad({ name: '   ', role: 'view', ttl: '1h' })).toThrow('nome');
    expect(bad({ name: 'x'.repeat(61), role: 'view', ttl: '1h' })).toThrow('60');
    expect(bad({ name: 'a\u0000b', role: 'view', ttl: '1h' })).toThrow('nome');
    expect(bad({ name: 'a\u202ab', role: 'view', ttl: '1h' })).not.toThrow(); // bidi marks are formatting, whitespace is collapsed
    expect(bad({ name: 'a\u2028b', role: 'view', ttl: '1h' })).toThrow('nome');
    expect(registry.list().map((invite) => invite.name)).toContain('a\u202ab');
    expect(bad({ name: 7, role: 'view', ttl: '1h' })).toThrow('nome');
    expect(bad({ name: 'ok', role: 'admin', ttl: '1h' })).toThrow('papel');
    expect(bad({ name: 'ok', role: '__proto__', ttl: '1h' })).toThrow('papel');
    expect(bad({ name: 'ok', role: 'view', ttl: '30d' })).toThrow('validade');
    expect(bad({ name: 'ok', role: 'view', ttl: 'constructor' })).toThrow('validade');
    expect(bad({ name: 'ok', role: 'view' })).toThrow('validade');
    for (let i = 0; i < 49; i++) registry.create({ name: `n${i}`, role: 'view', ttl: 'never' });
    expect(() => registry.create({ name: 'a mais', role: 'view', ttl: 'never' })).toThrow('Limite');
  });

  it('resolves a token to its invite and nothing else', () => {
    const { registry } = setup();
    const invite = registry.create({ name: 'Ana', role: 'edit', ttl: '1h' });
    expect(registry.resolve(invite.token)).toMatchObject({ status: 'live', invite: { id: invite.id, role: 'edit' } });
    for (const token of ['', 'x', `${invite.token}x`, invite.token.slice(0, -1), undefined, null]) expect(registry.resolve(token as never).status, String(token)).toBe('unknown');
  });

  it('compares every invite in constant shape: the number of comparisons does not depend on where the match is', () => {
    const { registry } = setup();
    const invites = Array.from({ length: 5 }, (_, i) => registry.create({ name: `n${i}`, role: 'view', ttl: 'never' }));
    const first = registry.resolve(invites[0]!.token);
    const last = registry.resolve(invites[4]!.token);
    expect([first.status, last.status]).toEqual(['live', 'live']);
    expect(registry.comparisons()).toBe(10); // 5 + 5: no early exit
    registry.resolve('nope');
    expect(registry.comparisons()).toBe(15);
  });

  it('revoking is immediate, reported once and remembered as revoked (not as unknown)', () => {
    const { registry, events } = setup();
    const invite = registry.create({ name: 'Ana', role: 'edit', ttl: 'never' });
    expect(registry.revoke('nada')).toBe(false);
    expect(registry.revoke(invite.id)).toBe(true);
    expect(registry.revoke(invite.id)).toBe(false);
    expect(registry.resolve(invite.token)).toEqual({ status: 'dead', reason: 'revoked', name: 'Ana' });
    expect(registry.isLive(invite.id)).toBe(false);
    expect(registry.list()).toEqual([]);
    expect(events.filter((event) => event.type === 'revoke')).toHaveLength(1);
  });

  it('expires on the clock at every request, once, and tells it', () => {
    const { registry, events, advance } = setup();
    const invite = registry.create({ name: 'Ana', role: 'edit', ttl: '1h' });
    advance(INVITE_TTLS['1h'] - 1);
    expect(registry.resolve(invite.token).status).toBe('live');
    advance(1);
    expect(registry.resolve(invite.token)).toEqual({ status: 'dead', reason: 'expired', name: 'Ana' });
    expect(registry.resolve(invite.token).status).toBe('dead');
    expect(events.filter((event) => event.type === 'expire').map((event) => event.invite.name)).toEqual(['Ana']);
    expect(registry.list()).toEqual([]);
  });

  it('sweep expires the ones due even when nobody asks (the host drops their sockets)', () => {
    const { registry, events, advance } = setup();
    const a = registry.create({ name: 'a', role: 'view', ttl: '1h' });
    registry.create({ name: 'b', role: 'view', ttl: 'never' });
    advance(INVITE_TTLS['1h']);
    registry.sweep();
    registry.sweep();
    expect(events.filter((event) => event.type === 'expire').map((event) => event.invite.id)).toEqual([a.id]);
    expect(registry.list().map((entry) => entry.name)).toEqual(['b']);
  });

  it('isLive follows revocation and expiry', () => {
    const { registry, advance } = setup();
    const invite = registry.create({ name: 'a', role: 'view', ttl: '1h' });
    expect(registry.isLive(invite.id)).toBe(true);
    advance(INVITE_TTLS['1h']);
    expect(registry.isLive(invite.id)).toBe(false);
  });

  it('adds the default links with fixed tokens and names', () => {
    const { registry } = setup();
    const edit = registry.create({ name: 'Link para editar', role: 'edit', ttl: 'never', token: 'edit-token-edit-token-edit-token-edit-token-1' });
    expect(registry.resolve('edit-token-edit-token-edit-token-edit-token-1')).toMatchObject({ status: 'live', invite: { id: edit.id } });
  });

  it('keeps the memory of dead tokens bounded', () => {
    const { registry } = setup();
    const first = registry.create({ name: 'primeiro', role: 'view', ttl: 'never' });
    registry.revoke(first.id);
    for (let i = 0; i < 700; i++) {
      const invite = registry.create({ name: 'n', role: 'view', ttl: 'never' });
      registry.revoke(invite.id);
    }
    expect(registry.resolve(first.token).status).toBe('unknown');
    expect(registry.deadCount()).toBeLessThanOrEqual(500);
  });
});
