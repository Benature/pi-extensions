/**
 * Cylon scanner for the composer working-status slot: the == eye sweeping its
 * bracketed track, out and back. Pure and deterministic: the tick alone picks
 * the frame.
 */

/** Natural width in columns; the composer may hand down a narrower budget. */
export const CYLON_COLUMNS = 12;

/** Ticks after which the animation repeats exactly at the natural width: out, back, and out again. */
export const CYLON_PERIOD = 16;

/**
 * One fixed-width cylon frame. Never throws; degenerate ticks render frame
 * zero and degenerate widths the narrowest scanner.
 */
export function cylonFrame(tick: number, columns = CYLON_COLUMNS): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const width = Math.max(4, Math.min(CYLON_COLUMNS, Math.floor(columns) || CYLON_COLUMNS));
  const inner = width - 2; // columns between the brackets; the eye is two of them
  const period = 2 * (inner - 2);
  const step = safe % period;
  const at = step <= inner - 2 ? step : period - step;
  return `[${" ".repeat(at)}==${" ".repeat(inner - 2 - at)}]`;
}
