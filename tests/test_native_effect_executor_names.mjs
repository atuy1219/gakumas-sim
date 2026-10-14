import assert from "node:assert/strict";
import {
  NATIVE_EFFECT_EXECUTOR_CLASS_NAMES,
  PARSED_EFFECT_EXECUTOR_CLASS_NAMES,
  resolveNativeEffectExecutorClassName,
  assertNativeExecutorClassName,
} from "../web/native_effect_executor_registry.js";
import {
  createExamState,
  applyParsedExamEffect,
  LessonEffectExecutor,
  BlockEffectExecutor,
  ReviewEffectExecutor,
  AggressiveEffectExecutor,
  LessonBuffEffectExecutor,
  ParameterBuffEffectExecutor,
  DrawEffectExecutor,
  ExtraTurnEffectExecutor,
} from "../web/exam_effects.js";

assert.equal(NATIVE_EFFECT_EXECUTOR_CLASS_NAMES.length, 161);
assert.equal(new Set(NATIVE_EFFECT_EXECUTOR_CLASS_NAMES).size, 161);
for (const [kind, name] of Object.entries(PARSED_EFFECT_EXECUTOR_CLASS_NAMES)) {
  if (name !== null) assertNativeExecutorClassName(name);
  assert.equal(resolveNativeEffectExecutorClassName(kind), name);
}
assert.equal(resolveNativeEffectExecutorClassName("ProduceExamEffectType_ExamCardDraw"), "DrawEffectExecutor");
assert.equal(resolveNativeEffectExecutorClassName("ProduceExamEffectType_ExamStatusEnchantEncore"), "StatusEnchantEncoreEffectExecutor");
assert.equal(resolveNativeEffectExecutorClassName("ProduceExamEffectType_ExamMultipleConcentrationLesson"), "LessonMultipleConcentrationEffectExecutor");
assert.equal(resolveNativeEffectExecutorClassName("ProduceExamEffectType_ExamMultipleFullPowerLesson"), "LessonMultipleFullPowerEffectExecutor");
assert.equal(resolveNativeEffectExecutorClassName("not-an-effect"), null);
assert.throws(() => assertNativeExecutorClassName("UnknownExecutor"), RangeError);

const handlers = [
  ["lesson", LessonEffectExecutor, { value: 3, count: 2 }],
  ["block", BlockEffectExecutor, { value: 3 }],
  ["review", ReviewEffectExecutor, { value: 3 }],
  ["aggressive", AggressiveEffectExecutor, { value: 3 }],
  ["lesson_buff", LessonBuffEffectExecutor, { value: 3 }],
  ["parameter_buff", ParameterBuffEffectExecutor, { value: 3 }],
  ["card_draw", DrawEffectExecutor, { value: 1 }],
  ["extra_turn", ExtraTurnEffectExecutor, { value: 1 }],
];
for (const [kind, executor, fields] of handlers) {
  const parsed = { kind, ...fields };
  assert.equal(resolveNativeEffectExecutorClassName(kind), executorName(executor, kind));
  const fromSwitch = createExamState({ stamina: 35 });
  const fromExecutor = createExamState({ stamina: 35 });
  const actual = applyParsedExamEffect(fromSwitch, parsed);
  const direct = executor.ExecuteEffect(fromExecutor, parsed, {});
  assert.deepEqual(actual, direct, kind);
  assert.deepEqual(fromSwitch, fromExecutor, kind);
}
function executorName(_executor, kind) {
  const names = {
    lesson: "LessonEffectExecutor", block: "BlockEffectExecutor", review: "ReviewEffectExecutor",
    aggressive: "AggressiveEffectExecutor", lesson_buff: "LessonBuffEffectExecutor",
    parameter_buff: "ParameterBuffEffectExecutor", card_draw: "DrawEffectExecutor",
    extra_turn: "ExtraTurnEffectExecutor",
  };
  return names[kind];
}
console.log("native effect executor naming and dispatch: OK");
