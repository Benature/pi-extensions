/**
 * Cylon scanner for the composer working-status slot: the == eye sweeping its
 * bracketed track, in the same word-sized single row as the wave. Pure and
 * deterministic: the tick alone picks the frame.
 */

/** Ticks after which the animation repeats exactly: out, back, and out again. */
export const CYLON_PERIOD = 6;

const INNER = 5; // columns between the brackets; the eye is two of them

/**
 * One fixed-width cylon frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function cylonFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % CYLON_PERIOD;
  const at = step <= 3 ? step : CYLON_PERIOD - step; // 0 1 2 3 2 1
  return `[${" ".repeat(at)}==${" ".repeat(INNER - 2 - at)}]`;
}
