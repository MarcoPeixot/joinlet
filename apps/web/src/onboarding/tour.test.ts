import { beforeEach, describe, expect, it } from 'vitest';
import { TOUR_STEPS, nextTourStep, startTour, stopTour, tourStore } from './tour';

beforeEach(stopTour);

describe('tour', () => {
  it('walks the four steps and ends by itself', () => {
    expect(TOUR_STEPS).toHaveLength(4);
    startTour();
    for (let i = 1; i < TOUR_STEPS.length; i++) {
      nextTourStep();
      expect(tourStore.getState().step).toBe(i);
    }
    nextTourStep();
    expect(tourStore.getState().step).toBeNull();
  });

  it('ignores next when it is not running and can be replayed', () => {
    nextTourStep();
    expect(tourStore.getState().step).toBeNull();
    startTour();
    stopTour();
    startTour();
    expect(tourStore.getState().step).toBe(0);
  });
});
