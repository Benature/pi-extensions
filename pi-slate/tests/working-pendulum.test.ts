import assert from "node:assert/strict";
import test from "node:test";
import { PENDULUM_PERIOD, pendulumFrame } from "../extensions/pi-slate/working-pendulum.ts";
import { progressFrame, setProgressStyle } from "../extensions/pi-slate/working-wave.ts";

const BLOCK_ONLY = /^[▁▂▃▄▅▆▇█]{7}$/;

test("pendulum frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 7, 39, 40, 42, 1000]) {
    assert.equal(pendulumFrame(tick), pendulumFrame(tick));
  }
});

test("pendulum frame is always seven block columns with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = pendulumFrame(tick);
    assert.match(frame, BLOCK_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 7);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("pendulum loops exactly after PENDULUM_PERIOD ticks", () => {
  for (let tick = 0; tick < PENDULUM_PERIOD; tick++) {
    assert.equal(pendulumFrame(tick), pendulumFrame(tick + PENDULUM_PERIOD));
    assert.equal(pendulumFrame(tick), pendulumFrame(tick + PENDULUM_PERIOD * 25));
  }
});

test("every tick animates: consecutive frames differ", () => {
  for (let tick = 0; tick < PENDULUM_PERIOD; tick++) {
    assert.notEqual(pendulumFrame(tick), pendulumFrame(tick + 1), `ticks ${tick}/${tick + 1}`);
  }
});

test("pendulum lines up flat once a cycle and drifts out of step between", () => {
  assert.equal(pendulumFrame(0), "▁▁▁▁▁▁▁");
  const seen = new Set<string>();
  for (let tick = 0; tick < PENDULUM_PERIOD; tick++) seen.add(pendulumFrame(tick));
  assert.ok(seen.size >= PENDULUM_PERIOD * 0.75, `expected the row to drift through many patterns, saw ${seen.size}`);
});

test("pendulum wave is not the rolling wave", () => {
  const pendulum = new Set<string>();
  for (let tick = 0; tick < PENDULUM_PERIOD; tick++) pendulum.add(pendulumFrame(tick));
  assert.ok(pendulum.size > 8, "the drift visits far more frames than a fixed rolling shape");
});

test("degenerate ticks render frame zero", () => {
  assert.equal(pendulumFrame(Number.NaN), pendulumFrame(0));
  assert.equal(pendulumFrame(-3), pendulumFrame(0));
  assert.equal(pendulumFrame(2.9), pendulumFrame(2));
});

test("progress frame dispatches pendulum-wave when selected", () => {
  setProgressStyle("pendulum-wave");
  assert.equal(progressFrame(3), pendulumFrame(3));
  setProgressStyle("waves");
});
