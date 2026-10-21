import { describe, expect, it } from 'vitest';
import { fingerprint, syntheticModels } from '@strukt/core/testing';
import { printDiagramJson } from './print';

describe.each(Object.entries(syntheticModels()))('printDiagramJson on %s', (_name, { model }) => {
  it('is byte-identical to the captured output', () => {
    const text = printDiagramJson(model);
    expect(fingerprint(text)).toMatchSnapshot();
  });
});
