/**
 * Snake for the composer working-status slot: a diamondback flattened into
 * the same word-sized single row as the wave. It slides along its own S-shaped
 * track — body cells lean with the slope (/ ~ \) — flicking its tongue, and
 * leaves the right edge and comes back on the left. Pure and deterministic:
 * the tick alone picks the frame.
 */

const COLUMNS = 7; // the wave's width: same slot, same size
const LEN = 4; // body cells behind the snout

/** Ticks after which the animation repeats exactly: half a column a tick. */
export const SNAKE_PERIOD = 14;

/**
 * One fixed-width snake frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function snakeFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % SNAKE_PERIOD;
  const scroll = step * 0.5; // columns the snake has advanced
  const headCol = Math.floor(scroll) % COLUMNS; // the snout's cell
  let frame = "";
  for (let col = 0; col < COLUMNS; col++) {
    const d = (((headCol - col) % COLUMNS) + COLUMNS) % COLUMNS; // cells behind the snout
    if (d > LEN) {
      frame += " ";
      continue;
    }
    if (d === 0) {
      frame += ">";
      continue;
    }
    const slope = Math.cos((2 * Math.PI * (col - scroll)) / COLUMNS); // the track, fixed to the world
    frame += slope > 0.45 ? "/" : slope < -0.45 ? "\\" : "~";
  }
  // The forked tongue flicks out of the snout twice a lap.
  if (step % 7 === 3 || step % 7 === 4) {
    const col = (headCol + 1) % COLUMNS;
    frame = `${frame.slice(0, col)}<${frame.slice(col + 1)}`;
  }
  return frame;
}
