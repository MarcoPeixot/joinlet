import { describe, expect, it } from 'vitest';
import { describeEntry, expiryLabel, remainingLabel, roleLabel } from './format';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('role labels', () => {
  it('names each role', () => {
    expect(roleLabel('edit')).toBe('Editar');
    expect(roleLabel('view')).toBe('Só ver');
    expect(roleLabel('comment')).toBe('Comentar');
  });
});

describe('expiry', () => {
  it('says when an invite ends', () => {
    expect(expiryLabel(null, NOW)).toBe('Sem prazo');
    expect(expiryLabel(NOW + 30_000, NOW)).toBe('Expira em menos de 1 min');
    expect(expiryLabel(NOW + 5 * 60_000, NOW)).toBe('Expira em 5 min');
    expect(expiryLabel(NOW + 59 * 60_000 + 30_000, NOW)).toBe('Expira em 60 min');
    expect(expiryLabel(NOW + 3 * 3_600_000, NOW)).toBe('Expira em 3 h');
    expect(expiryLabel(NOW + 47 * 3_600_000, NOW)).toBe('Expira em 47 h');
    expect(expiryLabel(NOW + 3 * 86_400_000, NOW)).toBe('Expira em 3 dias');
    expect(expiryLabel(NOW + 86_400_000 * 2 - 1, NOW)).toBe('Expira em 47 h');
    expect(expiryLabel(NOW - 1, NOW)).toBe('Expirado');
  });

  it('counts what is left of the public access', () => {
    expect(remainingLabel(NOW + 45 * 60_000, NOW)).toBe('45 min');
    expect(remainingLabel(NOW + 90 * 60_000, NOW)).toBe('1 h 30 min');
    expect(remainingLabel(NOW + 2 * 3_600_000, NOW)).toBe('2 h');
    expect(remainingLabel(NOW + 10_000, NOW)).toBe('menos de 1 min');
    expect(remainingLabel(NOW - 10, NOW)).toBe('encerrando');
  });
});

describe('describing the audit', () => {
  const at = '2026-10-03T12:00:00.000Z';
  const text = (entry: Parameters<typeof describeEntry>[0]) => describeEntry(entry).text;

  it('words each event in pt-BR with who and what', () => {
    expect(text({ t: at, type: 'share.start' })).toBe('Compartilhamento iniciado');
    expect(text({ t: at, type: 'share.stop' })).toBe('Compartilhamento encerrado');
    expect(text({ t: at, type: 'invite.create', invite: 'Ana', role: 'edit' })).toBe('Convite "Ana" criado (Editar)');
    expect(text({ t: at, type: 'invite.revoke', invite: 'Ana' })).toBe('Convite "Ana" revogado');
    expect(text({ t: at, type: 'invite.expire', invite: 'Ana' })).toBe('Convite "Ana" expirou');
    expect(text({ t: at, type: 'join', invite: 'Ana', role: 'view' })).toBe('"Ana" entrou (Só ver)');
    expect(text({ t: at, type: 'write', invite: 'Ana', path: 'docs/notas.md', op: 'write' })).toBe('"Ana" alterou docs/notas.md');
    expect(text({ t: at, type: 'write', invite: 'Ana', path: 'docs/notas.md', op: 'remove' })).toBe('"Ana" removeu docs/notas.md');
    expect(text({ t: at, type: 'tunnel.start' })).toBe('Acesso público ligado');
    expect(text({ t: at, type: 'tunnel.stop', reason: 'expired' })).toBe('Acesso público encerrado: o tempo acabou');
    expect(text({ t: at, type: 'tunnel.stop', reason: 'manual' })).toBe('Acesso público desligado');
    expect(text({ t: at, type: 'tunnel.stop', reason: 'exited' })).toBe('Acesso público caiu (o cloudflared parou)');
    expect(text({ t: at, type: 'tunnel.stop', reason: 'share_stopped' })).toBe('Acesso público encerrado com o compartilhamento');
  });

  it('words each refusal and marks it as one', () => {
    expect(describeEntry({ t: at, type: 'denied', reason: 'invalid_token' })).toMatchObject({ text: 'Convite inválido recusado', tone: 'warn' });
    expect(text({ t: at, type: 'denied', reason: 'ended_invite' })).toBe('Acesso com convite revogado ou expirado recusado');
    expect(text({ t: at, type: 'denied', reason: 'read_only', invite: 'Bia' })).toBe('"Bia" tentou alterar com acesso só de leitura');
    expect(text({ t: at, type: 'denied', reason: 'path_not_allowed', invite: 'Bia', path: 'context/x.md' })).toBe('"Bia" tentou gravar em arquivo não permitido (context/x.md)');
    expect(text({ t: at, type: 'denied', reason: 'rate_limited' })).toBe('Endereço bloqueado por tentativas demais');
    expect(text({ t: at, type: 'denied', reason: 'bad_origin', invite: 'Bia' })).toBe('"Bia" tentou conectar de uma origem não permitida');
    expect(describeEntry({ t: at, type: 'join', invite: 'Ana' }).tone).toBe('normal');
  });

  it('shows the time of day, and tolerates what it does not know', () => {
    expect(describeEntry({ t: at, type: 'join', invite: 'Ana' }).when).toMatch(/\d{2}:\d{2}/);
    expect(describeEntry({ t: 'lixo', type: 'join' }).when).toBe('');
    expect(text({ t: at, type: 'algo-novo' })).toBe('algo-novo');
    expect(text({ t: at, type: 'join' })).toBe('Alguém entrou');
    expect(text({ t: at, type: 'denied', reason: 'novo-motivo' })).toBe('Acesso recusado');
  });
});
