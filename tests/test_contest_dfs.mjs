import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ProducePlanType, ExamDepthFirstSearchVersionType, ContestExamPhase,
  ContestDFS, getExamDepthFirstSearchVersionType, getCalculateTurn,
  getCalculateCommand, leafTerm, applyResourceEvaluationScore,
} from "../web/contest_dfs.js";
import { XorShift32 } from "../web/engine.js";

const setting = (version, limits = [2, 3, 4]) => ({
  examAutoPlayEnableVersion: version,
  examAutoPlaySearchCommandPlanLimits: limits,
});

assert.equal(getExamDepthFirstSearchVersionType(setting(0)), ExamDepthFirstSearchVersionType.UNKNOWN);
assert.equal(getExamDepthFirstSearchVersionType(setting(1)), ExamDepthFirstSearchVersionType.V1);
assert.equal(getExamDepthFirstSearchVersionType(setting(2)), ExamDepthFirstSearchVersionType.V2);
assert.equal(getCalculateTurn(setting(1), ProducePlanType.PLAN1), 2);
assert.equal(getCalculateTurn(setting(1), ProducePlanType.PLAN2), 2);
assert.equal(getCalculateTurn(setting(1), ProducePlanType.PLAN3), 1);
assert.equal(getCalculateTurn(setting(2), ProducePlanType.PLAN3), 2);
assert.equal(getCalculateCommand(setting(2, [11, 22, 33]), ProducePlanType.PLAN1), 11);
assert.equal(getCalculateCommand(setting(2, [11, 22, 33]), ProducePlanType.PLAN2), 22);
assert.equal(getCalculateCommand(setting(2, [11, 22, 33]), ProducePlanType.PLAN3), 33);
assert.throws(() => getCalculateCommand(setting(2, [1]), ProducePlanType.PLAN1), RangeError);
assert.throws(() => getCalculateTurn(setting(2), ProducePlanType.UNKNOWN), RangeError);

assert.equal(leafTerm(10, 2), 6);
assert.equal(leafTerm(9, 2), 5);
assert.equal(leafTerm(0, 2), 1);
assert.throws(() => leafTerm(1, 0), RangeError);
assert.equal(applyResourceEvaluationScore(3, 10, { addition: 5, multiplication: 0 }), 45);
assert.equal(applyResourceEvaluationScore(3, 10, { addition: 100, multiplication: 1200 }), 36);
assert.equal(applyResourceEvaluationScore(3, 10, null), 30);
assert.equal(applyResourceEvaluationScore(0, 10, { addition: 100, multiplication: 1200 }), 0);

// The original Python test vectors are now validated against the *runtime* RNG.
const rng = new XorShift32(0x12345678);
assert.deepEqual([rng.nextU32(), rng.nextU32(), rng.nextU32()],
  [0x87985aa5, 0x155b24a3, 0x4820f4c4]);

class ToySequence {
  constructor({ depth = 0, points = 0, phase = ContestExamPhase.MAIN,
    noOptions = false, duplicateOptions = false, maxDepth = 3 } = {}) {
    Object.assign(this, { depth, points, phase, noOptions, duplicateOptions, maxDepth });
    this.currentTurn = 1;
    this.remainTurn = 10;
    this.mainEffectType = 9;
    this.judgeParameter = points;
    this.judgeParameterVocal = points;
    this.judgeParameterDance = 0;
    this.judgeParameterVisual = 0;
  }
  clone() {
    return new ToySequence({
      depth: this.depth, points: this.points, phase: this.phase,
      noOptions: this.noOptions, duplicateOptions: this.duplicateOptions,
      maxDepth: this.maxDepth,
    });
  }
  advanceUntilMainPhaseOrEnd() {
    if (this.phase !== ContestExamPhase.EXAM_END) this.phase = ContestExamPhase.MAIN;
  }
  selectableCommandIndices() {
    if (this.noOptions) return [];
    return this.duplicateOptions ? [0, 0] : [0, 1];
  }
  executeCommand(index) {
    this.depth++;
    this.points += index === 1 ? 10 : index === 0 ? 1 : 0;
    this.judgeParameter = this.points;
    this.judgeParameterVocal = this.points;
    if (this.depth >= this.maxDepth || index === -1) this.phase = ContestExamPhase.EXAM_END;
    return index < 0 ? null : "card-" + index;
  }
  branchIdentity() { return [this.depth, this.points, this.phase]; }
  saveData() { return { depth: this.depth, points: this.points }; }
  turnEndLogs() { return [{ depth: this.depth }]; }
}
const calculator = {
  evaluate(sequence, term, playType, effectType, ids, log) {
    assert.equal(term, leafTerm(10, 2));
    assert.equal(playType, 1);
    assert.equal(effectType, 9);
    assert.equal(log, null);
    assert.equal(ids.length, sequence.depth);
    return sequence.points;
  },
};

const twoCommands = new ContestDFS(setting(2, [2, 2, 2]), ProducePlanType.PLAN1, calculator);
const result = twoCommands.search(new ToySequence());
assert.deepEqual(result.selectIndexList, [1, 1]);
assert.equal(result.evaluateScore, 20);
assert.equal(result.parameter, 20);
assert.equal(result.examSaveData.points, 20);
assert.equal(result.isExamEnd, false);
assert.deepEqual(twoCommands.trace, { visitedNodes: 7, leafNodes: 4, duplicateNodes: 0 });
assert.equal(twoCommands.chooseFirstCommand(new ToySequence()), 1);

const ties = new ContestDFS(setting(2), ProducePlanType.PLAN1,
  { evaluate: () => 42 });
assert.deepEqual(ties.search(new ToySequence()).selectIndexList, [0, 0]);

const oneCommand = new ContestDFS(setting(2, [1, 1, 1]), ProducePlanType.PLAN1, calculator);
assert.deepEqual(oneCommand.search(new ToySequence()).selectIndexList, [1]);
assert.equal(oneCommand.trace.leafNodes, 2);

const duplicate = new ContestDFS(setting(2, [1, 1, 1]), ProducePlanType.PLAN1, calculator);
assert.deepEqual(duplicate.search(new ToySequence({ duplicateOptions: true })).selectIndexList, [0]);
assert.equal(duplicate.trace.duplicateNodes, 1);

const skip = new ContestDFS(setting(2), ProducePlanType.PLAN1,
  { evaluate: sequence => sequence.points });
assert.deepEqual(skip.search(new ToySequence({ noOptions: true })).selectIndexList, [-1]);
assert.equal(skip.chooseFirstCommand(new ToySequence({ noOptions: true })), -1);

const v1 = new ContestDFS(setting(1), ProducePlanType.PLAN1, calculator);
assert.deepEqual(v1.search(new ToySequence()).selectIndexList, [1, 1, 1]);
assert.equal(v1.trace.leafNodes, 8);

assert.throws(() => new ContestDFS(setting(2), ProducePlanType.PLAN1, calculator,
  { maxNodes: 2 }).search(new ToySequence()), /maxNodes/);
assert.throws(() => twoCommands.search({}), /requires clone/);

console.log("contest DFS JS port and Python primitive vectors: passed");

const searchPolicy = JSON.parse(readFileSync(new URL("../web/contest_dfs.json", import.meta.url), "utf8"));
assert.equal(searchPolicy.schemaVersion, 1);
assert.equal(searchPolicy.planType.plan1, ProducePlanType.PLAN1);
assert.equal(searchPolicy.searchVersion.v2, ExamDepthFirstSearchVersionType.V2);
assert.equal(searchPolicy.turnDepth.plan3.v2, getCalculateTurn(setting(2), ProducePlanType.PLAN3));
assert.equal(searchPolicy.commandLimitSource, "ExamSetting.examAutoPlaySearchCommandPlanLimits");
