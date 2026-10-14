import assert from "node:assert/strict";
import { NATIVE_EFFECT_EXECUTOR_CLASS_NAMES } from "../web/native_effect_executor_registry.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EXECUTOR_COVERAGE } from "../web/tower_runtime.js";
import { PARSED_EXAM_EFFECT_EXECUTOR_CLASSES } from "../web/exam_effects.js";

const allNames = NATIVE_EFFECT_EXECUTOR_CLASS_NAMES;
const constructors = Object.values(NATIVE_EFFECT_EXECUTOR_CLASSES);
assert.equal(allNames.length, 161);
assert.equal(Object.keys(NATIVE_EFFECT_EXECUTOR_CLASSES).length, 161);
assert.equal(new Set(constructors).size, 161, "each native executor has a distinct concrete class");
for (const name of allNames) {
  const ctor = NATIVE_EFFECT_EXECUTOR_CLASSES[name];
  assert.equal(ctor.name, name, name);
  assert.equal(typeof ctor.ExecuteEffect, "function", name);
  assert.equal(Object.hasOwn(ctor, "ExecuteEffect"), true, name);
}

assert.equal(NATIVE_MASTER_EXECUTOR_COVERAGE.registered, 161);
assert.equal(Object.keys(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES).length, 82);
assert.equal(Object.keys(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES).length, 41);
const supported = new Set([
  ...Object.values(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES).map(ctor => ctor.name),
  ...Object.values(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES).map(ctor => ctor.name),
]);
const nativeSupported = [...supported].filter(name => allNames.includes(name));
assert.equal(nativeSupported.length, 115, "explicit master + parsed native implementations");
assert.equal(allNames.filter(name => !supported.has(name)).length, 46);
assert.equal(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES.lesson.name, "LessonEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStaminaReduce.name, "StaminaReduceEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStaminaDamage.name, "StaminaDamageEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStatusEnchantEncore.name, "StatusEnchantEncoreEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamMultipleConcentrationLesson.name, "LessonMultipleConcentrationEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamMultipleFullPowerLesson.name, "LessonMultipleFullPowerEffectExecutor");
console.log("161 native executor classes; 82 master paths; 41 parsed paths; 115 native names implemented: OK");
