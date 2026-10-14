// Port of former Python DFS module's *search policy*, not another Exam engine.
// The sequence/calculator must be supplied by the caller. Gameplay and its
// effect calculations remain exclusively in web/tower_runtime.js.
export const ProducePlanType = Object.freeze({
  UNKNOWN: 0, COMMON: 1, PLAN1: 2, PLAN2: 3, PLAN3: 4,
});
export const ExamDepthFirstSearchVersionType = Object.freeze({
  UNKNOWN: 0, V1: 1, V2: 2,
});
export const ContestExamPhase = Object.freeze({
  NONE: 0, EXAM_STANDBY: 1, TURN_START: 2, TURN_START_AFTER: 3,
  TURN_START_DRAW: 4, MAIN_START: 5, MAIN: 6, TURN_END: 7, EXAM_END: 8,
});

export function getExamDepthFirstSearchVersionType(setting) {
  const version = Number(setting?.examAutoPlayEnableVersion ?? 0);
  return version <= 0 ? ExamDepthFirstSearchVersionType.UNKNOWN
    : version === 1 ? ExamDepthFirstSearchVersionType.V1
      : ExamDepthFirstSearchVersionType.V2;
}

export function getCalculateTurn(setting, planType) {
  if (planType === ProducePlanType.PLAN1 || planType === ProducePlanType.PLAN2) return 2;
  if (planType === ProducePlanType.PLAN3) {
    return getExamDepthFirstSearchVersionType(setting) === ExamDepthFirstSearchVersionType.V2 ? 2 : 1;
  }
  throw new RangeError("Unsupported contest plan type: " + String(planType));
}

export function getCalculateCommand(setting, planType) {
  if (![ProducePlanType.PLAN1, ProducePlanType.PLAN2, ProducePlanType.PLAN3].includes(planType)) {
    throw new RangeError("Unsupported contest plan type: " + String(planType));
  }
  const values = setting?.examAutoPlaySearchCommandPlanLimits;
  if (!Array.isArray(values) || values.length < 3) {
    throw new RangeError("Contest command limits require Plan1, Plan2 and Plan3");
  }
  const count = Number(values[planType - 2]);
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Invalid contest command limit");
  return count;
}

export function leafTerm(remainTurn, calculateTurn) {
  if (!Number.isInteger(calculateTurn) || calculateTurn === 0) {
    throw new RangeError("calculateTurn must be a non-zero integer");
  }
  return Math.floor(Number(remainTurn) / calculateTurn) + 1;
}

// ELF-inspired Float32 evaluation vector, migrated from Python tests.
// This is an evaluator primitive; it does not replace the live score engine.
export function applyResourceEvaluationScore(value, coefficient, resourceEvaluation = null) {
  if (value === 0) return 0;
  let c = Math.trunc(coefficient);
  const addition = Math.trunc(resourceEvaluation?.addition ?? 0);
  if (addition !== 0) {
    const multiplication = Math.trunc(resourceEvaluation?.multiplication ?? 0);
    if (multiplication !== 0) {
      const v = Math.fround(Math.fround(multiplication * c + addition) / Math.fround(1000));
      c = Math.trunc(Math.fround(v + Math.fround(0.0001)));
    } else {
      c += addition;
    }
  }
  return Math.trunc(value) * c;
}

function checkSequence(sequence) {
  for (const method of [
    "clone", "advanceUntilMainPhaseOrEnd", "selectableCommandIndices",
    "executeCommand", "branchIdentity", "saveData", "turnEndLogs",
  ]) {
    if (typeof sequence?.[method] !== "function") {
      throw new TypeError("Contest DFS sequence requires " + method + "()");
    }
  }
}

export class ContestDFS {
  constructor(setting, planType, calculator, { maxNodes = 100000 } = {}) {
    if (typeof calculator?.evaluate !== "function") {
      throw new TypeError("Contest DFS requires calculator.evaluate()");
    }
    if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError("maxNodes must be positive");
    this.setting = setting;
    this.planType = planType;
    this.calculator = calculator;
    this.maxNodes = maxNodes;
    this.trace = { visitedNodes: 0, leafNodes: 0, duplicateNodes: 0 };
  }

  search(originSequence) {
    checkSequence(originSequence);
    const version = getExamDepthFirstSearchVersionType(this.setting);
    const calculateTurn = getCalculateTurn(this.setting, this.planType);
    const calculateCommand = getCalculateCommand(this.setting, this.planType);
    const maxTurn = Number(originSequence.phase) === ContestExamPhase.EXAM_STANDBY
      ? calculateTurn : Number(originSequence.currentTurn) + calculateTurn - 1;
    this.trace = { visitedNodes: 0, leafNodes: 0, duplicateNodes: 0 };
    const results = new Map();
    const seenExecutions = new Set();

    const visit = (sequence, indices, playedCards) => {
      if (++this.trace.visitedNodes > this.maxNodes) {
        throw new RangeError("Contest DFS exceeded maxNodes; check sequence transitions");
      }
      sequence.advanceUntilMainPhaseOrEnd();
      const commandLimit = version === ExamDepthFirstSearchVersionType.V2
        && indices.length >= calculateCommand;
      if (Number(sequence.phase) === ContestExamPhase.EXAM_END
        || Number(sequence.currentTurn) > maxTurn || commandLimit) {
        const pathKey = JSON.stringify(indices);
        if (!results.has(pathKey)) {
          const score = Number(this.calculator.evaluate(
            sequence, leafTerm(Number(sequence.remainTurn), calculateTurn),
            1, Number(sequence.mainEffectType), playedCards, null,
          ));
          results.set(pathKey, {
            selectIndexList: [...indices],
            examSaveData: sequence.saveData(),
            evaluateScore: score,
            turnEndLogList: [...sequence.turnEndLogs()],
            parameter: Number(sequence.judgeParameter),
            vocal: Number(sequence.judgeParameterVocal),
            dance: Number(sequence.judgeParameterDance),
            visual: Number(sequence.judgeParameterVisual),
            isExamEnd: Number(sequence.phase) === ContestExamPhase.EXAM_END,
          });
          this.trace.leafNodes++;
        }
        return;
      }
      const selectable = [...sequence.selectableCommandIndices()];
      // ELF DFS treats "no selectable command" as a skip (-1).
      if (selectable.length === 0) selectable.push(-1);
      for (const rawIndex of selectable) {
        const index = Number(rawIndex);
        const child = sequence.clone();
        const playedCardId = child.executeCommand(index);
        const path = [...indices, index];
        const cards = playedCardId == null ? playedCards : [...playedCards, String(playedCardId)];
        const identity = child.branchIdentity();
        if (identity === undefined) {
          throw new TypeError("Contest DFS branchIdentity() must be JSON-serializable");
        }
        const key = JSON.stringify([identity, path]);
        if (seenExecutions.has(key)) {
          this.trace.duplicateNodes++;
          continue;
        }
        seenExecutions.add(key);
        visit(child, path, cards);
      }
    };

    visit(originSequence.clone(), [], []);
    if (results.size === 0) throw new Error("Contest DFS produced no leaf result");
    // Python/native MaxBy uses strict >: ties preserve first DFS insertion order.
    let best = null;
    for (const result of results.values()) {
      if (best === null || result.evaluateScore > best.evaluateScore) best = result;
    }
    return best;
  }

  chooseFirstCommand(originSequence) {
    return this.search(originSequence).selectIndexList[0] ?? -1;
  }
}
