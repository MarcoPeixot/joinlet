import { beforeEach, describe, expect, it } from 'vitest';
import { dockStore, enterDock, setDockTarget } from './dock';

beforeEach(() => dockStore.setState({ target: null, count: 0 }));

describe('right dock', () => {
  it('is open while any panel is in it, and a swap keeps it open', () => {
    const leaveFirst = enterDock();
    expect(dockStore.getState().count).toBe(1);
    const leaveSecond = enterDock();
    leaveFirst();
    expect(dockStore.getState().count).toBe(1);
    leaveSecond();
    expect(dockStore.getState().count).toBe(0);
  });
  it('never goes below zero', () => {
    const leave = enterDock();
    leave();
    leave();
    expect(dockStore.getState().count).toBe(0);
  });
  it('remembers its mount point', () => {
    const el = {} as HTMLElement;
    setDockTarget(el);
    expect(dockStore.getState().target).toBe(el);
  });
});
