/**
 * Reduced-motion helpers. Pure logic only (no `react-native` imports) so
 * the mapping stays unit testable under plain `node --test`; call sites
 * pair these with `useReducedMotion()`.
 */

/** Duration used when motion is reduced: state applies instantly. */
export const INSTANT_ANIMATION_MS = 0

export function resolveAnimationDuration(
  durationMs: number,
  reduceMotion: boolean,
): number {
  return reduceMotion ? INSTANT_ANIMATION_MS : durationMs
}
