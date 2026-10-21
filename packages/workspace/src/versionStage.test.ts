import { describe, expect, it } from 'vitest';
import { checkStageMeta, normalizeTarget, parseStage, stageMeta, STAGE_LABELS, VERSION_STAGES } from './versionStage';

describe('parseStage', () => {
  it('accepts the three stages, with or without accent and in any case', () => {
    expect(VERSION_STAGES).toEqual(['atual', 'transição', 'planejado']);
    expect(parseStage('atual')).toBe('atual');
    expect(parseStage('transição')).toBe('transição');
    expect(parseStage('transicao')).toBe('transição');
    expect(parseStage('  PLANEJADO ')).toBe('planejado');
  });

  it('is null for anything else, hostile values included', () => {
    for (const value of [undefined, null, 3, true, [], {}, '', 'futuro', '__proto__', 'constructor', 'planejado\u0000', 'x'.repeat(10_000)]) expect(parseStage(value)).toBeNull();
  });

  it('labels every stage in pt-BR', () => {
    expect(Object.keys(STAGE_LABELS).sort()).toEqual([...VERSION_STAGES].sort());
  });
});

describe('normalizeTarget', () => {
  it('keeps a plain date and cuts a date-time down to the day it was written for', () => {
    expect(normalizeTarget('2027-03-15')).toBe('2027-03-15');
    expect(normalizeTarget('2027-03-15T10:30:00Z')).toBe('2027-03-15');
    expect(normalizeTarget('2027-03-15T23:59:59.999-03:00')).toBe('2027-03-15');
    expect(normalizeTarget(' 2027-03-15 ')).toBe('2027-03-15');
  });

  it('knows calendars: leap years, month lengths and the supported years', () => {
    expect(normalizeTarget('2028-02-29')).toBe('2028-02-29');
    expect(normalizeTarget('2027-02-29')).toBeNull();
    expect(normalizeTarget('2100-02-29')).toBeNull();
    expect(normalizeTarget('2027-04-31')).toBeNull();
    expect(normalizeTarget('2027-13-01')).toBeNull();
    expect(normalizeTarget('2027-00-10')).toBeNull();
    expect(normalizeTarget('2027-01-00')).toBeNull();
    expect(normalizeTarget('1899-12-31')).toBeNull();
    expect(normalizeTarget('3000-01-01')).toBeNull();
    expect(normalizeTarget('2027-03-15T25:00:00Z')).toBeNull();
    expect(normalizeTarget('2027-03-15T10:61:00Z')).toBeNull();
  });

  it('refuses everything that is not a date, without throwing', () => {
    for (const value of [undefined, null, 20270315, true, [], {}, '', 'amanhã', '15/03/2027', '2027-3-15', '2027-03-15 and more', '+275760-09-13', '2027-03-15\u0000', '__proto__', `2027-03-15${'0'.repeat(10_000)}`]) {
      expect(normalizeTarget(value)).toBeNull();
    }
  });
});

describe('stageMeta (lenient: what a file read keeps)', () => {
  it('keeps stage and target only when they mean something', () => {
    expect(stageMeta({})).toEqual({});
    expect(stageMeta({ stage: 'atual' })).toEqual({});
    expect(stageMeta({ stage: 'planejado' })).toEqual({ stage: 'planejado' });
    expect(stageMeta({ stage: 'planejado', target: '2027-03-15' })).toEqual({ stage: 'planejado', target: '2027-03-15' });
    expect(stageMeta({ stage: 'transicao', target: '2027-03-15T10:00:00Z' })).toEqual({ stage: 'transição', target: '2027-03-15' });
  });

  it('drops an invalid target and a target on a current version, and never throws on hostile input', () => {
    expect(stageMeta({ stage: 'planejado', target: 'ontem' })).toEqual({ stage: 'planejado' });
    expect(stageMeta({ target: '2027-03-15' })).toEqual({});
    expect(stageMeta({ stage: 'atual', target: '2027-03-15' })).toEqual({});
    expect(stageMeta({ stage: 'futuro', target: '2027-03-15' })).toEqual({});
    expect(stageMeta({ stage: { toString: () => 'planejado' }, target: ['2027-03-15'] })).toEqual({});
    const hostile = stageMeta(JSON.parse('{"stage":"planejado","target":"2027-03-15","__proto__":{"stage":"atual"}}'));
    expect(Object.getPrototypeOf(hostile)).toBe(Object.prototype);
  });
});

describe('checkStageMeta (strict: what a writer sends)', () => {
  it('defaults to a current version with nothing else', () => {
    expect(checkStageMeta(undefined, undefined)).toEqual({ ok: true, meta: {} });
    expect(checkStageMeta('atual', undefined)).toEqual({ ok: true, meta: {} });
  });

  it('accepts a planned or transition version with or without a goal', () => {
    expect(checkStageMeta('planejado', '2027-03-15')).toEqual({ ok: true, meta: { stage: 'planejado', target: '2027-03-15' } });
    expect(checkStageMeta('transição', undefined)).toEqual({ ok: true, meta: { stage: 'transição' } });
    expect(checkStageMeta('transicao', '')).toEqual({ ok: true, meta: { stage: 'transição' } });
  });

  it('explains in pt-BR what is wrong', () => {
    expect(checkStageMeta('futuro', undefined)).toEqual({ ok: false, error: 'Estágio inválido: "futuro". Use atual, transição ou planejado.' });
    expect(checkStageMeta('planejado', '2027-02-30')).toEqual({ ok: false, error: 'Meta inválida: "2027-02-30". Use uma data real no formato AAAA-MM-DD.' });
    expect(checkStageMeta(undefined, '2027-03-15')).toEqual({ ok: false, error: 'Só versões de transição ou planejadas têm meta.' });
    expect(checkStageMeta('atual', '2027-03-15')).toEqual({ ok: false, error: 'Só versões de transição ou planejadas têm meta.' });
  });

  it('shows a hostile value truncated and without control characters', () => {
    const result = checkStageMeta('planejado', `x\u0000${'y'.repeat(500)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThan(160);
      expect(result.error).not.toContain('\u0000');
    }
  });
});
