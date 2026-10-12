/**
 * Snake for the composer working-status slot: an ornate diamondback flattened
 * into the same word-sized single row as the wave. The @> head leads, ornate
 * scales (_ , . - ~ * ') trail behind and shimmer toward the tail as it goes,
 * and the snake leaves the right edge and comes back on the left. Pure and
 * deterministic: the tick alone picks the frame.
 */

const COLUMNS = 7; // the wave's width: same slot, same size
const LEN = 5; // cells of snake: the snout, the @, and four scale cells
// Scale glyphs by distance behind the head, cycling: a chain of diamonds.
const SCALE = ["-", "~", "*", "'", "*", "~", "-", ".", ",", "_"];

/** Ticks after which the animation repeats exactly: a head lap (14) in step with the scale shimmer (10). */
export const SNAKE_PERIOD = 70;

/**
 * One fixed-width snake frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function snakeFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % SNAKE_PERIOD;
  const headCol = Math.floor(step / 2) % COLUMNS; // half a column a tick
  const shift = step % SCALE.length; // the scales shimmer toward the tail
  let frame = "";
  for (let col = 0; col < COLUMNS; col++) {
    const d = (((headCol - col) % COLUMNS) + COLUMNS) % COLUMNS; // cells behind the snout
    if (d > LEN) frame += " ";
    else if (d === 0) frame += ">";
    else if (d === 1) frame += "@";
    else frame += SCALE[(d - 2 + shift) % SCALE.length];
  }
  return frame;
}
