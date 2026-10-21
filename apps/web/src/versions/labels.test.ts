import { describe, expect, it } from 'vitest';
import { formatVersionDate, restoredMessage, versionTitle } from './labels';

describe('version labels', () => {
  it('formats dates the pt-BR way, in the given time zone', () => {
    expect(formatVersionDate('2026-09-23T14:05:09.123Z', 'UTC')).toBe('23/09/2026 14:05');
    expect(formatVersionDate('2026-09-23T02:05:00.000Z', 'America/Sao_Paulo')).toBe('22/09/2026 23:05');
    expect(formatVersionDate('2026-01-02T00:04:00.000Z', 'UTC')).toBe('02/01/2026 00:04');
  });

  it('names versions without a message and restores', () => {
    expect(versionTitle({ message: 'Antes do Redis' })).toBe('Antes do Redis');
    expect(versionTitle({ message: '   ' })).toBe('Versão sem descrição');
    expect(restoredMessage({ createdAt: '2026-09-23T14:05:09.123Z' }, 'UTC')).toBe('Restaurado de 23/09/2026 14:05');
  });
});
