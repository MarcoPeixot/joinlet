import { describe, expect, it } from 'vitest';
import { renameWho, resolveWho } from './identity';
import type { KeyValue } from './identity';

const memory = (initial: Record<string, string> = {}): KeyValue & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};
const counter = () => { let n = 0; return () => ((n = (n * 7 + 3) % 11) / 11); };

describe('who is commenting', () => {
  it('a guest comments as its presence: the name and color the others see, owned by its invite', () => {
    const tab = memory({ 'strukt:collaborator': JSON.stringify({ name: 'Bia', color: '#c75c8f', cid: 'abcdefghijkl' }) });
    const who = resolveWho({ session: { role: 'comment', readOnly: true, member: 'i:1234' }, tab, local: memory(), random: counter() });
    expect(who).toEqual({ name: 'Bia', color: '#c75c8f', cid: 'abcdefghijkl', owner: 'i:1234', moderator: false, canWrite: true, named: true });
  });

  it('creates the presence record the collaboration client will read, so both agree on the name', () => {
    const tab = memory();
    const who = resolveWho({ session: { role: 'edit', member: 'i:9' }, tab, local: memory(), random: counter() });
    expect(JSON.parse(tab.data.get('strukt:collaborator')!)).toMatchObject({ name: who.name, color: who.color, cid: who.cid });
    expect(who.name).toMatch(/^Colaborador \d\d$/);
    expect(who.moderator).toBe(true);
  });

  it('a guest who already named themselves on this browser keeps that name', () => {
    const local = memory({ 'strukt:identity': JSON.stringify({ name: 'Ana Souza', color: '#319b77', cid: 'zzzzzzzzzzzz', named: true }) });
    const who = resolveWho({ session: { role: 'edit', member: 'i:9' }, tab: memory(), local, random: counter() });
    expect(who).toMatchObject({ name: 'Ana Souza', color: '#319b77' });
  });

  it('a view-only guest cannot write; a link without a role that is read-only cannot either', () => {
    expect(resolveWho({ session: { role: 'view', readOnly: true, member: 'i:1' }, tab: memory(), local: memory(), random: counter() }).canWrite).toBe(false);
    expect(resolveWho({ session: { readOnly: true, member: 'i:1' }, tab: memory(), local: memory(), random: counter() }).canWrite).toBe(false);
    expect(resolveWho({ session: { role: 'view', readOnly: true }, tab: memory(), local: memory(), random: counter() }).owner).toMatch(/^c:/);
  });

  it('without a session (the owner, or anyone working alone) it moderates, is owned by this browser and must be named first', () => {
    const local = memory();
    const first = resolveWho({ session: null, tab: memory(), local, random: counter() });
    expect(first).toMatchObject({ moderator: true, canWrite: true, named: false });
    expect(first.owner).toBe(`c:${first.cid}`);
    expect(resolveWho({ session: null, tab: memory(), local, random: counter() }).cid).toBe(first.cid);
  });

  it('renaming sticks: next time it is the same person, named', () => {
    const local = memory();
    const tab = memory();
    renameWho({ session: null, tab, local, random: counter() }, '  Ana   Souza ');
    const who = resolveWho({ session: null, tab, local, random: counter() });
    expect(who).toMatchObject({ name: 'Ana Souza', named: true });
  });

  it('renaming a guest updates the record the collaboration client reads (the others see the new name)', () => {
    const tab = memory({ 'strukt:collaborator': JSON.stringify({ name: 'Colaborador 12', color: '#3972dc', cid: 'abcdefghijkl' }) });
    const env = { session: { role: 'edit' as const, member: 'i:1' }, tab, local: memory(), random: counter() };
    renameWho(env, 'Bia');
    expect(JSON.parse(tab.data.get('strukt:collaborator')!)).toEqual({ name: 'Bia', color: '#3972dc', cid: 'abcdefghijkl' });
    expect(resolveWho(env).name).toBe('Bia');
  });

  it('refuses a name that is empty, too long or has control characters', () => {
    const env = { session: null, tab: memory(), local: memory(), random: counter() };
    expect(() => renameWho(env, '   ')).toThrow(/nome/i);
    expect(() => renameWho(env, 'x'.repeat(61))).toThrow(/60/);
    expect(() => renameWho(env, 'a\u0000b')).toThrow(/nome/i);
    expect(() => renameWho(env, '__proto__')).toThrow(/nome/i);
  });

  it('survives storage that is broken or blocked', () => {
    const broken: KeyValue = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(resolveWho({ session: null, tab: broken, local: broken, random: counter() }).name).toBeTruthy();
    const garbage = memory({ 'strukt:identity': '{nope', 'strukt:collaborator': '[1]' });
    expect(resolveWho({ session: null, tab: garbage, local: garbage, random: counter() }).cid).toMatch(/^[a-z0-9]{12}$/);
  });
});
