import assert from "node:assert/strict";
import { NATIVE_EFFECT_EXECUTOR_CLASS_NAMES } from "../web/native_effect_executor_registry.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EXECUTOR_COVERAGE } from "../web/tower_runtime.js";
import { createExamState, PARSED_EXAM_EFFECT_EXECUTOR_CLASSES } from "../web/exam_effects.js";

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
assert.equal(Object.keys(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES).length, 128);
assert.equal(Object.keys(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES).length, 41);
const supported = new Set([
  ...Object.values(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES).map(ctor => ctor.name),
  ...Object.values(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES).map(ctor => ctor.name),
]);
const nativeSupported = [...supported].filter(name => allNames.includes(name));
assert.equal(nativeSupported.length, 161, "explicit master + parsed native implementations");
assert.equal(allNames.filter(name => !supported.has(name)).length, 0);
assert.deepEqual([...NATIVE_MASTER_EXECUTOR_COVERAGE.unsupportedClassNames].sort(),
  allNames.filter(name => !supported.has(name)).sort(), "coverage must not count parsed implementations as unsupported");
assert.equal(PARSED_EXAM_EFFECT_EXECUTOR_CLASSES.lesson.name, "LessonEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStaminaReduce.name, "StaminaReduceEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStaminaDamage.name, "StaminaDamageEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamStatusEnchantEncore.name, "StatusEnchantEncoreEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamMultipleConcentrationLesson.name, "LessonMultipleConcentrationEffectExecutor");
assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamMultipleFullPowerLesson.name, "LessonMultipleFullPowerEffectExecutor");
console.log("161 native executor classes; 128 master paths; 41 parsed paths; 161 native names implemented: OK");

// ELF TryReduce* checks IsBlockAddStatus(effectType) before consuming the
// corresponding status: anti-debuff protection is spent before reduction.
for (const [name, type, field] of [
 ["AggressiveReduceCancellableEffectExecutor","ExamAggressiveReduceCancellable","aggressive"],
 ["LessonBuffReduceCancellableEffectExecutor","ExamLessonBuffReduceCancellable","lessonBuff"],
 ["ParameterBuffReduceCancellableEffectExecutor","ExamParameterBuffReduceCancellable","parameterBuff"],
 ["ReviewReduceCancellableEffectExecutor","ExamReviewReduceCancellable","review"],
]) {
 const ctor=NATIVE_EFFECT_EXECUTOR_CLASSES[name];
 assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[type],ctor);
 const exam=createExamState(),event={effects:[]};
 exam[field]=8;exam.antiDebuffCount=1;
 ctor.ExecuteEffect({exam,v1:3,event});
 assert.equal(exam[field],8,name+" shielded");
 assert.equal(exam.antiDebuffCount,0,name+" spent anti-debuff");
 ctor.ExecuteEffect({exam,v1:3,event});
 assert.equal(exam[field],5,name+" reduced");
 ctor.ExecuteEffect({exam,v1:99,event});
 assert.equal(exam[field],0,name+" saturating reduction");
 if(field==="review")assert.equal(exam.reviewConsumptionSum,8);
}
console.log("four cancellable native status reductions: OK");

{
 const exam=createExamState({stamina:20,maxStamina:20}),event={effects:[]};
 const grant=NATIVE_EFFECT_EXECUTOR_CLASSES.UpliftingEffectExecutor;
 const damage=NATIVE_EFFECT_EXECUTOR_CLASSES.StaminaReduceFixEffectExecutor;
 assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamUplifting,grant);
 grant.ExecuteEffect({exam,v1:2,event});
 assert.equal(exam.uplifting,2);
 for(let i=0;i<2;i++) {
   damage.ExecuteEffect({exam,type:"ExamStaminaReduceFix",v1:5,event});
   assert.equal(exam.stamina,20);
 }
 assert.equal(exam.uplifting,0);
 damage.ExecuteEffect({exam,type:"ExamStaminaReduceFix",v1:5,event});
 assert.equal(exam.stamina,15);
}
console.log("native Uplifting absorbs two damage events: OK");
