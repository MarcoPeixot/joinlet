import { describe, expect, it } from 'vitest';
import { onboardingSurface } from './surface';

const shown = { hidden: false };

describe('onboardingSurface', () => {
  it('shows the first-run note alone, even while the checklist is not hidden', () => {
    expect(onboardingSurface({ firstRun: true, emptyDiagram: false, checklist: shown })).toBe('first-run');
    expect(onboardingSurface({ firstRun: true, emptyDiagram: false, checklist: { hidden: true } })).toBe('first-run');
  });

  it('lets the start card of an empty diagram speak alone', () => {
    expect(onboardingSurface({ firstRun: false, emptyDiagram: true, checklist: shown })).toBe('start');
  });

  it('hands over to the checklist once neither is up', () => {
    expect(onboardingSurface({ firstRun: false, emptyDiagram: false, checklist: shown })).toBe('checklist');
  });

  it('shows nothing once the checklist is hidden', () => {
    expect(onboardingSurface({ firstRun: false, emptyDiagram: false, checklist: { hidden: true } })).toBeNull();
  });
});
