/**
 * Snake for the composer working-status slot: an ornate diamondback flattened
 * into a single row. The @> head leads, ornate scales (_ , . - ~ * ') trail
 * behind and shimmer toward the tail as it goes, and the snake leaves the
 * right edge and comes back on the left. Pure and deterministic: the tick
 * alone picks the frame.
 */

const SCALE = ["-", "~", "*", "'", "*", "~", "-", ".", ",", "_", ","]; // backwards from the head

/** Natural width in columns; the composer may hand down a narrower budget. */
export const SNAKE_COLUMNS = 24;

/** Ticks after which the animation repeats exactly: a head lap (2 × 24) in step with the scale shimmer (11). */
export const SNAKE_PERIOD = 528;

/**
 * One fixed-width snake frame. Never throws; degenerate ticks render frame
 * zero and degenerate widths the narrowest snake.
 */
export function snakeFrame(tick: number, columns = SNAKE_COLUMNS): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const width = Math.max(3, Math.min(SNAKE_COLUMNS, Math.floor(columns) || SNAKE_COLUMNS));
  const step = safe % SNAKE_PERIOD;
  const headCol = Math.floor(step / 2) % width; // half a column a tick
  const shift = step % SCALE.length; // the scales shimmer toward the tail
  const len = width - 2; // cells of snake, one column clear behind the tail
  let frame = "";
  for (let col = 0; col < width; col++) {
    const d = (((headCol - col) % width) + width) % width; // cells behind the snout
    if (d > len) frame += " ";
    else if (d === 0) frame += ">";
    else if (d === 1) frame += "@";
    else frame += SCALE[(d - 2 + shift) % SCALE.length];
  }
  return frame;
}
