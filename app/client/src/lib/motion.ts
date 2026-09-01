/**
 * The one place the stylesheet's exit timings are known to JavaScript.
 *
 * A surface that animates out has to stay mounted until the animation has
 * finished, so React needs to know how long the CSS is going to take. Keeping
 * the number here rather than inline in each component means the stylesheet and
 * the components cannot drift apart silently — if `--dur-base` changes, this is
 * the single line that changes with it.
 */

/** Matches `--dur-base` in global.css. */
export const DUR_BASE_MS = 220;

/** Matches `--dur-fast` in global.css. */
export const DUR_FAST_MS = 140;

/**
 * How long to keep an exiting surface mounted.
 *
 * Returns ~0 when the reader has asked for reduced motion, so the element is
 * removed as soon as the cross-fade is done rather than sitting invisible for
 * the length of an animation that was never played.
 */
export function exitDuration(ms: number = DUR_BASE_MS): number {
  if (typeof window === 'undefined' || !window.matchMedia) return ms;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : ms;
}
