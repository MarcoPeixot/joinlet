import { createElement, lazy } from 'react';
import type { ComponentProps, ComponentType, LazyExoticComponent } from 'react';

type AnyComponent = ComponentType<any>;
type Loader<C extends AnyComponent> = () => Promise<{ default: C }>;

/** `React.lazy` caches a rejected import forever; a slot swaps in a fresh lazy component after each failure so the next mount imports again. */
export function createLazySlot<C extends AnyComponent>(factory: Loader<C>) {
  const slot: { current: LazyExoticComponent<C>; load: Loader<C> } = {
    current: undefined as never,
    load: () =>
      factory().catch((error: unknown) => {
        slot.current = lazy(slot.load);
        throw error;
      }),
  };
  slot.current = lazy(slot.load);
  return slot;
}

/** A `lazy()` that can be retried: after a failed chunk load (offline, 404), remounting it imports the chunk again. */
export function lazyWithRetry<C extends AnyComponent>(factory: Loader<C>): (props: ComponentProps<C>) => ReturnType<typeof createElement> {
  const slot = createLazySlot(factory);
  return function LazyWithRetry(props) {
    return createElement(slot.current as AnyComponent, props);
  };
}
