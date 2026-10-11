import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWave,
  isWaveActive,
  setWaveActive,
  WAVE_PERIOD,
  waveFrame,
  waveTick,
} from "../extensions/pi-slate/working-wave.ts";

const BLOCK_ONLY = /^[▁▂▃▄▅▆▇█]{7}$/;

test("wave frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 7, 8, 42, 1000]) {
    assert.equal(waveFrame(tick), waveFrame(tick));
  }
});

test("wave frame is always seven block columns with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = waveFrame(tick);
    assert.match(frame, BLOCK_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 7);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("wave loops exactly after WAVE_PERIOD ticks", () => {
  for (let tick = 0; tick < WAVE_PERIOD; tick++) {
    assert.equal(waveFrame(tick), waveFrame(tick + WAVE_PERIOD));
    assert.equal(waveFrame(tick), waveFrame(tick + WAVE_PERIOD * 25));
  }
});

test("every tick animates: consecutive frames differ", () => {
  for (let tick = 0; tick < WAVE_PERIOD; tick++) {
    assert.notEqual(waveFrame(tick), waveFrame(tick + 1), `ticks ${tick}/${tick + 1}`);
  }
});

test("wave uses a range of block heights (it actually rolls)", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < WAVE_PERIOD; tick++) for (const ch of waveFrame(tick)) seen.add(ch);
  assert.ok(seen.size >= 5, `expected a rolling range of heights, saw ${[...seen].join("")}`);
});

test("degenerate ticks render frame zero", () => {
  assert.equal(waveFrame(Number.NaN), waveFrame(0));
  assert.equal(waveFrame(-3), waveFrame(0));
  assert.equal(waveFrame(2.9), waveFrame(2));
});

test("wave state resets on activation and advances monotonically", () => {
  setWaveActive(false);
  assert.equal(isWaveActive(), false);
  setWaveActive(true);
  assert.equal(isWaveActive(), true);
  assert.equal(waveTick(), 0);
  advanceWave();
  advanceWave();
  assert.equal(waveTick(), 2);
  setWaveActive(true); // re-activation while active keeps the tick
  assert.equal(waveTick(), 2);
  setWaveActive(false);
  setWaveActive(true);
  assert.equal(waveTick(), 0);
  setWaveActive(false);
});
