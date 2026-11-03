/** True when the user asked the OS for less motion; animations then end at once. */
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A valid view-transition-name for a row key (names must be CSS identifiers). */
export const vtName = (prefix: string, key: string) => `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/**
 * Runs an edit inside a view transition so named rows and sections glide to their new places
 * instead of jumping. Edits patch the cached plan synchronously before their network write,
 * so the new layout is captured once that render lands; the write itself finishes outside the transition.
 */
export function withLayoutTransition<T>(edit: () => Promise<T>): Promise<T> {
  if (!document.startViewTransition || reducedMotion()) return edit();
  return new Promise<T>((resolve, reject) => {
    document.startViewTransition(async () => {
      const p = edit();
      p.then(resolve, reject);
      // Wait for the optimistic render, not the network.
      await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 50))]);
    });
  });
}
