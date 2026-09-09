import assert from "node:assert/strict";
import {
  ExamEffectType,
  StatusKind,
  UnsupportedRuntimePath,
  addReview,
  createExamRuntimeState,
  executeExamEffect,
  f32,
  getRatioEffectIntValue,
  spendTurnStrict,
} from "./web/exam_runtime_v8.js";

assert.equal(f32(0.1 + 0.2), Math.fround(0.1 + 0.2));
assert.equal(getRatioEffectIntValue(10, 1500, true), 16);
assert.equal(getRatioEffectIntValue(10, 1500, false), 14);

const reviewState = createExamRuntimeState({ stamina: 30 });
addReview(reviewState, 3);
assert.equal(reviewState.statuses.length, 1);
assert.equal(reviewState.statuses[0].kind, StatusKind.REVIEW);
assert.equal(reviewState.statuses[0].turn, 3);
spendTurnStrict(reviewState);
assert.equal(reviewState.statuses[0].turn, 2);
assert.equal(reviewState.reviewConsumptionSumCount, 1);

const blockState = createExamRuntimeState({ stamina: 20, block: 0 });
const blockResult = executeExamEffect(blockState, {
  i: "test-block",
  2: ExamEffectType.BLOCK,
  5: 4,
});
assert.equal(blockResult.blockAdded, 4);
assert.equal(blockState.block, 4);

const extraTurnState = createExamRuntimeState({ remainTurn: 4 });
executeExamEffect(extraTurnState, { i: "test-extra", 2: ExamEffectType.EXTRA_TURN });
assert.equal(extraTurnState.remainTurn, 5);
assert.equal(extraTurnState.extraTurn, 1);

assert.throws(
  () => executeExamEffect(createExamRuntimeState(), { i: "unknown", 2: 999 }),
  UnsupportedRuntimePath,
);

console.log("exam runtime v8 tests: ok");
