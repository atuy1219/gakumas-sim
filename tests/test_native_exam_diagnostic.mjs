import assert from "node:assert/strict";
import {
  createDiagnosticReport, parseNativeTrace, replayNativeActions,
  stepXorShift32, verifyNativeRandom,
} from "../tools/native_exam_diagnostic.mjs";

assert.equal(stepXorShift32(1), 270369);
assert.equal(stepXorShift32(0xffffffff), 253983);
const events = [
  { seq: 1, event: "trace-start", hooksInstalled: true, capturedAtUnixMs: 1000, libil2cppBuildId: "test" },
  { seq: 2, event: "GetRandomInt", overload: "range", before: 1, after: 270369,
    minimum: 0, maximum: 10, result: 0, turn: 1 },
  { seq: 3, event: "DrawCard.after", turn: 1, randomState: 270369,
    hand: [{ id: "a", upgradeCount: 0 }], deck: [], grave: [], lost: [], hold: [] },
];
const traceText = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const parsed = parseNativeTrace(traceText + "malformed trailing write");
assert.equal(parsed.events.length, 3);
assert.equal(parsed.warnings[0].reason, "invalid-json");
assert.equal(verifyNativeRandom(events).differences.length, 0);
const report = createDiagnosticReport({ traceText, cardsText: JSON.stringify({
  produceCards: [{ produceCardId: "a", upgradeCount: 0 }],
}) });
assert.equal(report.comparison.status, "unverified", "RNG-only agreement is not game parity");
assert.equal(report.simulation.mode, "rng-only");
assert.equal(report.comparison.comparedRandomCalls, 1);
assert.ok(report.comparison.warnings.includes("missing-verified-card-masters"));
assert.equal(report.realDevice.events.length, 3);
assert.ok(report.input.capturedCards.produceCards.length === 1);
assert.deepEqual(report.comparison.differences, []);
const wrong = events.map((event) => ({ ...event }));
wrong[1].after = 9;
const mismatch = createDiagnosticReport({
  traceText: wrong.map((event) => JSON.stringify(event)).join("\n"),
});
assert.equal(mismatch.comparison.status, "mismatch");
assert.equal(mismatch.comparison.firstDivergence.seq, 2);
assert.equal(mismatch.comparison.firstDivergence.field, "randomState");

const rawBad = createDiagnosticReport({ traceText: "invalid-json\n" });
assert.equal(rawBad.comparison.status, "unverified");
assert.ok(rawBad.comparison.warnings.some((w) => w.reason === "invalid-json"));

const incomplete = replayNativeActions(events, null, {
  seed: 1, stamina: 100,
  cardMasters: [{ id: "a", playEffects: [] }],
  initialDeck: [{ id: "a" }],
});
assert.ok(["partial", "unavailable"].includes(incomplete.status));
assert.equal(incomplete.differences.length, 0);
console.log("native exam diagnostic tests: ok");
