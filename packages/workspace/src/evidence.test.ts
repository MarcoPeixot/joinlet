import { describe, expect, it } from 'vitest';
import { measured } from '../../../scripts/performance';
import { MAX_DRIFT_BYTES, checkEvidenceDrift, exceedsDriftBytes, fingerprintLines, parseEvidence, printEvidence, validEvidencePath } from './evidence';
import type { EvidenceIndex } from './evidence';

describe('evidence', () => {
  it('accepts repository-relative files and rejects paths outside the repository', () => {
    expect(validEvidencePath('src/api.ts')).toBe(true);
    expect(validEvidencePath('../secret')).toBe(false);
    expect(validEvidencePath('/tmp/x')).toBe(false);
    expect(parseEvidence('{"api":{"API":[{"path":"src/api.ts","line":3},{"path":"../secret"}]}}')).toEqual({ api: { API: [{ path: 'src/api.ts', line: 3 }] } });
  });

  it('round trips valid evidence', () => {
    const index = { api: { API: [{ path: 'src/api.ts', line: 3, contains: 'route' }] } };
    expect(parseEvidence(printEvidence(index))).toEqual(index);
  });

  it('round trips a snippet fingerprint and drops malformed ones', () => {
    const index = { api: { API: [{ path: 'src/api.ts', line: 3, snippet: 'deadbeef' }, { path: 'a.ts' }] } };
    expect(parseEvidence(printEvidence(index))).toEqual(index);
    expect(printEvidence(index)).toContain('"snippet": "deadbeef"');
    expect(parseEvidence('{"api":{"API":[{"path":"a.ts","line":1,"snippet":"nothex!!"}]}}')).toEqual({ api: { API: [{ path: 'a.ts', line: 1 }] } });
  });

  it('rejects drive-letter paths', () => {
    expect(validEvidencePath('C:/Windows/x')).toBe(false);
    expect(validEvidencePath('src/a:b.ts')).toBe(true);
  });
});

describe('fingerprintLines', () => {
  const lines = ['const a = 1;', '  route();  ', 'export {};'];
  it('is deterministic 8-char hex, ignoring surrounding whitespace and CR', () => {
    const f = fingerprintLines(lines, 2);
    expect(f).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintLines(['const a = 1;\r', 'route();', 'export {};\r'], 2)).toBe(f);
  });
  it('changes when the line or a neighbour changes, and copes with the edges', () => {
    const f = fingerprintLines(lines, 2);
    expect(fingerprintLines(['const a = 2;', lines[1]!, lines[2]!], 2)).not.toBe(f);
    expect(fingerprintLines(lines, 1)).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintLines(lines, 3)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('checkEvidenceDrift', () => {
  const files: Record<string, string> = {
    'src/api.ts': 'import x;\nexport function route() {}\nexport const z = 1;\n',
  };
  const read = (path: string) => (Object.hasOwn(files, path) ? files[path]! : null);
  const snip = fingerprintLines(files['src/api.ts']!.split('\n'), 2);
  const index = (refs: EvidenceIndex[string][string]): EvidenceIndex => ({ d: { API: refs } });

  it('is clean when file, line and snippet match', () => {
    expect(checkEvidenceDrift(index([{ path: 'src/api.ts', line: 2, snippet: snip }]), read)).toEqual([]);
    expect(checkEvidenceDrift(index([{ path: 'src/api.ts' }]), read)).toEqual([]);
  });
  it('reports a missing file', () => {
    const [f] = checkEvidenceDrift(index([{ path: 'src/gone.ts', line: 1 }]), read);
    expect(f).toMatchObject({ evidenceId: 'd/API', path: 'src/gone.ts', kind: 'missing-file' });
    expect(f!.message).toMatch(/[Aa]rquivo/);
  });
  it('reports a line past the end of the file, ignoring the trailing newline', () => {
    expect(checkEvidenceDrift(index([{ path: 'src/api.ts', line: 3 }]), read)).toEqual([]);
    expect(checkEvidenceDrift(index([{ path: 'src/api.ts', line: 4 }]), read)[0]).toMatchObject({ kind: 'line-out-of-range' });
  });
  it('suggests the new line when the snippet moved', () => {
    const moved = { 'src/api.ts': 'a\nb\nc\nimport x;\nexport function route() {}\nexport const z = 1;\n' };
    const [f] = checkEvidenceDrift(index([{ path: 'src/api.ts', line: 2, snippet: snip }]), (p) => moved[p as 'src/api.ts'] ?? null);
    expect(f).toMatchObject({ kind: 'snippet-moved', suggestedLine: 5 });
  });
  it('reports snippet-changed when the snippet is nowhere', () => {
    const [f] = checkEvidenceDrift(index([{ path: 'src/api.ts', line: 2, snippet: 'ffffffff' }]), read);
    expect(f).toMatchObject({ kind: 'snippet-changed' });
    expect(f!.suggestedLine).toBeUndefined();
  });
  it('fingerprints CRLF and LF files identically', () => {
    const crlf = (p: string) => (p === 'src/api.ts' ? files['src/api.ts']!.replace(/\n/g, '\r\n') : null);
    expect(checkEvidenceDrift(index([{ path: 'src/api.ts', line: 2, snippet: snip }]), crlf)).toEqual([]);
  });
  it('tolerates non-UTF8 replacement characters', () => {
    const bin = () => '\ufffd\ufffd\nabc\n';
    expect(checkEvidenceDrift(index([{ path: 'x.bin', line: 2 }]), bin)).toEqual([]);
  });
  it('refuses hostile paths without reading them', () => {
    const spy: string[] = [];
    const bad = ['../../etc/passwd', '/etc/passwd', 'C:\\Windows\\x', 'C:/x', 'a\0b', 'a/../../b', ''];
    // Bypass parseEvidence: index is built directly.
    const found = checkEvidenceDrift(index(bad.map((path) => ({ path, line: 1 }))), (p) => { spy.push(p); return 'x'; });
    expect(spy).toEqual([]);
    expect(found).toHaveLength(bad.length);
    expect(found.every((f) => f.kind === 'missing-file' && f.message === 'Caminho inválido.')).toBe(true);
  });
  it('handles hostile element ids', () => {
    const idx = { d: Object.assign(Object.create(null), { constructor: [{ path: 'src/gone.ts' }] }) } as EvidenceIndex;
    expect(checkEvidenceDrift(idx, read)[0]).toMatchObject({ evidenceId: 'd/constructor' });
  });
  it('caps the number of findings with a summary', () => {
    const many = index(Array.from({ length: 800 }, (_, i) => ({ path: `f${i}.ts`, line: 1 })));
    const found = checkEvidenceDrift(many, () => null);
    expect(found).toHaveLength(501);
    expect(found[500]!.message).toMatch(/300/);
  });
  it('does not judge lines beyond the 2 MB read window', () => {
    const big = 'x\n'.repeat(2_000_000);
    expect(checkEvidenceDrift(index([{ path: 'big.ts', line: 1_900_000, snippet: 'ffffffff' }]), () => big)).toEqual([]);
    expect(checkEvidenceDrift(index([{ path: 'big.ts', line: 5 }]), () => big)).toEqual([]);
  });
  describe('drift: contains, cap and speed', () => {
    const one = (ref: object): EvidenceIndex => ({ a: { API: [{ path: 'f.ts', ...ref }] } });

    it('reports snippet-moved from `contains` when there is no snippet', () => {
      const text = 'x\ny\nexport function route() {}\n';
      const findings = checkEvidenceDrift(one({ line: 1, contains: 'function route' }), () => text);
      expect(findings).toMatchObject([{ kind: 'snippet-moved', suggestedLine: 3 }]);
      expect(checkEvidenceDrift(one({ line: 3, contains: 'function route' }), () => text)).toEqual([]);
      expect(checkEvidenceDrift(one({ line: 1, contains: 'gone' }), () => text)).toEqual([]);
    });

    it('can skip missing-file findings so the cap only counts real drift', () => {
      const evidence: EvidenceIndex = { a: {} };
      for (let i = 0; i < 600; i++) evidence.a![`m${i}`] = [{ path: `gone${i}.ts`, line: 1 }];
      evidence.a!.real = [{ path: 'f.ts', line: 1, snippet: 'ffffffff' }];
      const findings = checkEvidenceDrift(evidence, (path) => (path === 'f.ts' ? 'q\n' : null), { skipMissingFile: true });
      expect(findings).toMatchObject([{ kind: 'snippet-changed', element: 'real' }]);
    });

    it('uses a neutral kind for the cap summary', () => {
      const evidence: EvidenceIndex = { a: {} };
      for (let i = 0; i < 600; i++) evidence.a![`m${i}`] = [{ path: 'f.ts', line: 1, snippet: 'ffffffff' }];
      const findings = checkEvidenceDrift(evidence, () => 'q\n');
      expect(findings).toHaveLength(501);
      expect(findings[500]!.kind).toBe('truncated');
    });

    it('measures the size cap in UTF-8 bytes, not UTF-16 units', () => {
      const wide = 'é'.repeat(MAX_DRIFT_BYTES / 2 + 1); // 1 048 577 units, 2 097 154 bytes
      expect(wide.length).toBeLessThan(MAX_DRIFT_BYTES);
      expect(exceedsDriftBytes(wide)).toBe(true);
      expect(exceedsDriftBytes('é'.repeat(MAX_DRIFT_BYTES / 2))).toBe(false);
      expect(exceedsDriftBytes('a'.repeat(MAX_DRIFT_BYTES))).toBe(false);
      const evidence: EvidenceIndex = { a: { e: [{ path: 'f.ts', line: 5000000, snippet: 'ffffffff' }] } };
      // a too-big file is skipped (no line-out-of-range noise), exactly like the ASCII case
      expect(checkEvidenceDrift(evidence, () => `${wide}\n`)).toEqual([]);
    });

    it('handles 500 mismatching evidences over a 200k-line file quickly', () => {
      const text = Array.from({ length: 200_000 }, (_, i) => `line ${i}`).join('\n');
      const evidence: EvidenceIndex = { a: {} };
      for (let i = 0; i < 500; i++) evidence.a![`e${i}`] = [{ path: 'f.ts', line: 10 + i, snippet: 'ffffffff' }];
      const findings = measured(() => checkEvidenceDrift(evidence, () => text.slice(0, MAX_DRIFT_BYTES)), 500);
      expect(findings).toHaveLength(500);
    });
    describe('contains fallback cost', () => {
      const big = Array.from({ length: 300_000 }, (_, i) => i.toString(36)).join('\n');
      const last = (299_999).toString(36);
      const refs = (n: number, contains: (i: number) => string): EvidenceIndex => {
        const evidence: EvidenceIndex = { a: {} };
        for (let i = 0; i < n; i++) evidence.a![`e${i}`] = [{ path: 'f.ts', line: 10 + i, contains: contains(i) }];
        return evidence;
      };

      it('handles 500 distinct missing contains texts over a 300k-line file quickly', () => {
        const findings = measured(() => checkEvidenceDrift(refs(500, (i) => `nowhere-${i}`), () => big), 800);
        expect(findings.filter((f) => f.kind !== 'truncated')).toEqual([]);
      });

      it('scans a file once for a contains text shared by 400 refs', () => {
        const original = String.prototype.includes;
        let calls = 0;
        String.prototype.includes = function (this: string, ...args: Parameters<typeof original>) { calls++; return original.apply(this, args); };
        try {
          const findings = checkEvidenceDrift(refs(400, () => last), () => big);
          expect(findings).toHaveLength(400);
          expect(findings[0]).toMatchObject({ kind: 'snippet-moved', suggestedLine: 300_000 });
          expect(calls).toBeLessThan(320_000 + 2_000);
        } finally { String.prototype.includes = original; }
      });

      it('stops scanning past the budget and reports one neutral summary, deterministically', () => {
        const text = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n');
        const evidence = refs(10, (i) => `row ${50 + i}x`);
        evidence.a!.moved = [{ path: 'f.ts', line: 1, contains: 'row 7' }];
        const run = () => checkEvidenceDrift(evidence, () => text, { scanBudget: 250 });
        const found = run();
        expect(found.filter((f) => f.kind === 'truncated')).toHaveLength(1);
        expect(found.at(-1)).toMatchObject({ kind: 'truncated', message: 'busca por trecho interrompida por limite' });
        expect(found.filter((f) => f.kind !== 'truncated')).toEqual([]);
        expect(run()).toEqual(found);
      });

      it('still finds where moved contains text went, nearest line first', () => {
        const text = 'a\nb\nneedle\nc\nd\ne\nneedle\n';
        const found = checkEvidenceDrift({ a: { X: [{ path: 'f.ts', line: 6, contains: 'needle' }, { path: 'f.ts', line: 1, contains: 'needle' }] } }, () => text);
        expect(found.map((f) => f.suggestedLine)).toEqual([7, 3]);
      });
    });
  });
});
