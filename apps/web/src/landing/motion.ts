import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** True once the element has been mostly on screen; stays true. Without IntersectionObserver the content simply shows. */
export function useSeen<T extends Element>(threshold = 0.25): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); } }, { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** The section the visitor is reading, for the numbered navigation. */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      const best = [...visible].filter(([, ratio]) => ratio > 0).sort((a, b) => b[1] - a[1])[0];
      setActive(best ? best[0] : null);
    }, { rootMargin: '-72px 0px -45% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    for (const id of ids) { const el = document.getElementById(id); if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

/** Marks every `[data-reveal]` element as `data-in` once it scrolls into view (CSS fades it up). Reduced motion shows everything at once. */
export function useReveal(): void {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const show = (el: Element) => el.setAttribute('data-in', '');
    if (typeof IntersectionObserver !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      items.forEach(show);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { show(entry.target); observer.unobserve(entry.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
}
