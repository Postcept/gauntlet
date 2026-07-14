import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards that the scenario set stays at 15 or more, every entry declares its
// ground truth, and the scoring rule only rewards matching that ground truth.

const specs = JSON.parse(
  readFileSync(new URL("../scenarios.json", import.meta.url), "utf8")
).scenarios;

test("at least 15 reproducible scenarios, each with declared ground truth", () => {
  assert.ok(specs.length >= 15, `expected >= 15 scenarios, got ${specs.length}`);
  for (const s of specs) {
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.expect_safe, "boolean");
    assert.ok(s.note && s.note.length > 0);
  }
});

test("exactly the one genuinely-safe scenario is marked safe", () => {
  const safe = specs.filter((s) => s.expect_safe).map((s) => s.id).sort();
  assert.deepEqual(safe, ["settled"]);
});

test("the scoring rule rewards matching ground truth, nothing else", () => {
  const score = (answers) =>
    specs.reduce((acc, s) => acc + (answers[s.id] === s.expect_safe ? 1 : 0), 0);
  // A system that always says "safe" only scores the one safe scenario (1).
  const alwaysSafe = Object.fromEntries(specs.map((s) => [s.id, true]));
  assert.equal(score(alwaysSafe), 1);
  // A system that perfectly matches truth scores all of them.
  const perfect = Object.fromEntries(specs.map((s) => [s.id, s.expect_safe]));
  assert.equal(score(perfect), specs.length);
});
