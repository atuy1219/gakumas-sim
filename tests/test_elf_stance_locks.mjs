import assert from "node:assert/strict";
import { createExamState, trySetExamStance } from "../web/exam_effects.js";
import { EXAM_IDOL_STATUS_TYPE } from "../web/exam_score.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES } from "../web/tower_runtime.js";
const cases = [
  ["StanceLockConcentrationEffectExecutor","ExamStanceLockConcentration","stanceLockConcentration",EXAM_IDOL_STATUS_TYPE.Concentration],
  ["StanceLockFullPowerEffectExecutor","ExamStanceLockFullPower","stanceLockFullPower",EXAM_IDOL_STATUS_TYPE.FullPower],
  ["StanceLockPreservationEffectExecutor","ExamStanceLockPreservation","stanceLockPreservation",EXAM_IDOL_STATUS_TYPE.Preservation],
];
for (const [name,type,field,stance] of cases) {
  const exam=createExamState(),event={effects:[]};
  const ctor=NATIVE_EFFECT_EXECUTOR_CLASSES[name];
  assert.equal(ctor,NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[type]);
  ctor.ExecuteEffect({exam,v1:2,event});
  assert.equal(exam[field],2,name);
  assert.equal(trySetExamStance(exam,stance,1).blocked,true,name);
  ctor.ExecuteEffect({exam,v1:1,event});
  assert.equal(exam[field],3,name+" cumulative duration");
  assert.equal(event.effects.length,2);
  const prev=exam[field];ctor.ExecuteEffect({exam,v1:0,event});
  assert.equal(exam[field],prev,name+" zero duration");
  assert.equal(event.effects.length,2);
}
console.log("ELF stance-lock additive turn lifetimes: OK");
