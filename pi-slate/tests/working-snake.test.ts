import assert from "node:assert/strict";
import test from "node:test";
import { SNAKE_PERIOD, snakeFrame } from "../extensions/pi-slate/working-snake.ts";

const SNAKE_ONLY = /^[>@\-~*'.,_ ]{24}$/;

test("snake frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 13, 69, 70, 42, 1000]) {
    assert.equal(snakeFrame(tick), snakeFrame(tick));
  }
});

test("snake frame is always its natural width with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = snakeFrame(tick);
    assert.match(frame, SNAKE_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 24);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("snake shrinks to a narrower budget and never exceeds its natural width", () => {
  assert.equal([...snakeFrame(3, 12)].length, 12);
  assert.equal([...snakeFrame(3, 100)].length, 24);
  assert.equal([...snakeFrame(3, 2)].length, 3);
  assert.match(snakeFrame(3, 12), /^[>@\-~*'.,_ ]{12}$/);
});

test("snake loops exactly after SNAKE_PERIOD ticks", () => {
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    assert.equal(snakeFrame(tick), snakeFrame(tick + SNAKE_PERIOD));
    assert.equal(snakeFrame(tick), snakeFrame(tick + SNAKE_PERIOD * 25));
  }
});

test("the snake glides: frames hold for two ticks, then move", () => {
  for (let tick = 0; tick < SNAKE_PERIOD; tick += 2) {
    assert.equal(snakeFrame(tick), snakeFrame(tick + 1), `ticks ${tick}/${tick + 1}: the frame holds`);
    assert.notEqual(snakeFrame(tick), snakeFrame(tick + 2), `ticks ${tick}/${tick + 2}: then it moves`);
  }
});

test("the ornate snake keeps its @> head on screen and trails shimmering scales", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) for (const ch of snakeFrame(tick)) seen.add(ch);
  for (const ch of [">", "@", "~", "*", "'", "_", ",", ".", "-"]) assert.ok(seen.has(ch), `expected ${ch} somewhere in a lap`);
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    const frame = snakeFrame(tick);
    assert.ok(frame.includes(">") && frame.includes("@"), `tick ${tick}: the head is always on screen (split at the wrap)`);
  }
});

test("the tail never chases the head: a clear gap every frame", () => {
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    const gap = snakeFrame(tick).match(/ /g) ?? [];
    assert.equal(gap.length, 4, `tick ${tick}: four clear columns behind the tail (the gap may wrap the edge)`);
  }
});

test("degenerate ticks render frame zero", () => {
  assert.equal(snakeFrame(Number.NaN), snakeFrame(0));
  assert.equal(snakeFrame(-3), snakeFrame(0));
  assert.equal(snakeFrame(2.9), snakeFrame(2));
});
