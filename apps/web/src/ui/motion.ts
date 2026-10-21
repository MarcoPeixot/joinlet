import type { Transition } from 'motion/react';

/** The app's motion vocabulary (spec: redesign § Motion). `MotionConfig reducedMotion="user"` wraps the app. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Panels and cards that slide in: quick, settles without bounce. */
export const SPRING: Transition = { type: 'spring', stiffness: 520, damping: 44, mass: 0.9 };

/** Pills that glide between options (segmented controls, active list items). */
export const GLIDE: Transition = { type: 'spring', stiffness: 640, damping: 48 };

export const FADE: Transition = { duration: 0.18, ease: EASE_OUT };

/** A floating panel docked to one side of the canvas: slides a few pixels in from that side. */
export function slideFrom(side: 'left' | 'right' | 'bottom' | 'top', distance = 16) {
  const offset = side === 'left' || side === 'top' ? -distance : distance;
  const at = (v: number) => (side === 'left' || side === 'right' ? { x: v } : { y: v });
  return {
    initial: { opacity: 0, ...at(offset) },
    animate: { opacity: 1, ...at(0), transition: SPRING },
    exit: { opacity: 0, ...at(offset / 2), transition: { duration: 0.12, ease: EASE_OUT } },
  };
}

/** Cards that grow out of their trigger (popovers, the AI composer). */
export const POP = {
  initial: { opacity: 0, scale: 0.96, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, y: 2, transition: { duration: 0.1, ease: EASE_OUT } },
};
