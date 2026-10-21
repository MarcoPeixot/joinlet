import { describe, expect, it } from 'vitest';
import { goalDate, goalLabel, pastLabel } from './labels';

describe('goalDate', () => {
  it('writes a day as dd/mm/aaaa without any time-zone shift', () => {
    expect(goalDate('2027-03-15')).toBe('15/03/2027');
    expect(goalDate('2026-12-31')).toBe('31/12/2026');
  });
});

describe('goalLabel', () => {
  it('counts the days until the goal', () => {
    expect(goalLabel(0)).toBe('é hoje');
    expect(goalLabel(1)).toBe('é amanhã');
    expect(goalLabel(12)).toBe('faltam 12 dias');
    expect(goalLabel(241)).toBe('faltam 241 dias');
  });

  it('says so when the goal has passed or has no date', () => {
    expect(goalLabel(-1)).toBe('venceu ontem');
    expect(goalLabel(-3)).toBe('venceu há 3 dias');
    expect(goalLabel(null)).toBe('sem meta');
  });
});

describe('pastLabel', () => {
  it('says how long ago a state was saved', () => {
    expect(pastLabel(0)).toBe('hoje');
    expect(pastLabel(-1)).toBe('ontem');
    expect(pastLabel(-13)).toBe('há 13 dias');
  });
});
