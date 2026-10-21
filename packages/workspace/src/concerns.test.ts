import { describe, expect, it } from 'vitest';
import { openConcerns, parseConcerns, printConcerns } from './concerns';

describe('architecture concerns', () => {
  it('round trips valid concerns and ignores malformed or duplicate ids', () => {
    const concern = { id: 'c1', diagram: 'api', element: 'Gateway', message: 'O desenho não mostra o cache.', status: 'open' as const, createdAt: '2026-09-24T00:00:00.000Z' };
    expect(parseConcerns(printConcerns([concern]))).toEqual([concern]);
    expect(parseConcerns(JSON.stringify([concern, concern, { ...concern, id: '../bad' }]))).toEqual([concern]);
  });

  it('keeps the Jira task a concern was turned into, and drops a link that is not an Atlassian browse URL', () => {
    const base = { id: 'c1', diagram: 'api', message: 'X', status: 'open' as const, createdAt: '2026-09-24T00:00:00.000Z' };
    const issue = { key: 'ENG-42', url: 'https://acme.atlassian.net/browse/ENG-42' };
    expect(parseConcerns(printConcerns([{ ...base, issue }]))).toEqual([{ ...base, issue }]);
    for (const bad of [
      { key: 'ENG-42', url: 'https://evil.com/browse/ENG-42' },
      { key: 'ENG-42', url: 'http://acme.atlassian.net/browse/ENG-42' },
      { key: 'ENG-42', url: 'https://acme.atlassian.net.evil.com/browse/ENG-42' },
      { key: 'ENG-42', url: 'https://user@acme.atlassian.net/browse/ENG-42' },
      { key: 'ENG-42', url: 'https://acme.atlassian.net/browse/OTHER-1' },
      { key: 'ENG-42', url: 'javascript:alert(1)' },
      { key: 'eng 42', url: 'https://acme.atlassian.net/browse/ENG-42' },
      { key: 'ENG-42' },
      'ENG-42',
    ]) {
      expect(parseConcerns(JSON.stringify([{ ...base, issue: bad }])), JSON.stringify(bad)).toEqual([base]);
    }
  });

  it('lists only unresolved concerns in the requested diagram', () => {
    const concerns = parseConcerns('[{"id":"a","diagram":"api","message":"X","status":"open","createdAt":"2026-09-24T00:00:00Z"},{"id":"b","diagram":"api","message":"Y","status":"resolved","createdAt":"2026-09-24T00:00:00Z"}]');
    expect(openConcerns(concerns, 'api').map((item) => item.id)).toEqual(['a']);
    expect(openConcerns(concerns, 'other')).toEqual([]);
  });
});
