import assert from "node:assert/strict";
import test from "node:test";
import { HELIX_PERIOD, helixFrame } from "../extensions/pi-slate/working-helix.ts";

const HELIX_ONLY = /^[▔▁\\╳]{7}$/;

test("helix frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 7, 8, 42, 1000]) {
    assert.equal(helixFrame(tick), helixFrame(tick));
  }
});

test("helix frame is always seven columns with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = helixFrame(tick);
    assert.match(frame, HELIX_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 7);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("helix loops exactly after HELIX_PERIOD ticks", () => {
  for (let tick = 0; tick < HELIX_PERIOD; tick++) {
    assert.equal(helixFrame(tick), helixFrame(tick + HELIX_PERIOD));
    assert.equal(helixFrame(tick), helixFrame(tick + HELIX_PERIOD * 25));
  }
});

test("every tick animates: consecutive frames differ", () => {
  for (let tick = 0; tick < HELIX_PERIOD; tick++) {
    assert.notEqual(helixFrame(tick), helixFrame(tick + 1), `ticks ${tick}/${tick + 1}`);
  }
});

test("helix shows crests, slopes, and crossings (it actually turns)", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < HELIX_PERIOD; tick++) for (const ch of helixFrame(tick)) seen.add(ch);
  for (const ch of ["▔", "▁", "\\", "╳"]) assert.ok(seen.has(ch), `expected ${ch} somewhere in a turn`);
});

test("the near face of a one-way turn always leans the same way", () => {
  for (let tick = 0; tick < HELIX_PERIOD * 4; tick++) assert.ok(!helixFrame(tick).includes("/"));
});

test("degenerate ticks render frame zero", () => {
  assert.equal(helixFrame(Number.NaN), helixFrame(0));
  assert.equal(helixFrame(-3), helixFrame(0));
  assert.equal(helixFrame(2.9), helixFrame(2));
});
