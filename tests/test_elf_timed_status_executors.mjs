import assert from "node:assert/strict";
import { createExamState, markNativeStatusTurnStart, tickNativeScoreTimedStatuses } from "../web/exam_effects.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES } from "../web/tower_runtime.js";

for (const [name,type,field] of [
  ["BuffConsumptionDownEffectExecutor","ExamBuffConsumptionDown","buffConsumptionDown"],
  ["StaminaConsumptionAddDownEffectExecutor","ExamStaminaConsumptionAddDown","staminaConsumptionAddDown"],
  ["StaminaConsumptionDownAddEffectExecutor","ExamStaminaConsumptionDownAdd","staminaConsumptionDownAdd"],
]) {
  const exam=createExamState(),event={effects:[]};
  const ctor=NATIVE_EFFECT_EXECUTOR_CLASSES[name];
  assert.equal(ctor,NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[type]);
  ctor.ExecuteEffect({exam,v1:2,event});
  assert.equal(Boolean(exam[field]),true,name);
  assert.equal(event.effects.length,1);
  assert.equal(exam.genericTimedStatuses.length,1);
  ctor.ExecuteEffect({exam,v1:2,event});
  assert.equal(exam.genericTimedStatuses.length,1,"duration must merge");
  assert.equal(exam.genericTimedStatuses[0].turn,4);
  markNativeStatusTurnStart(exam);
  for(let i=0;i<3;i++) {
    tickNativeScoreTimedStatuses(exam);
    assert.equal(Boolean(exam[field]),true,name+" turn "+i);
  }
  tickNativeScoreTimedStatuses(exam);
  assert.equal(Boolean(exam[field]),false,name+" expired");
}
{
  const exam=createExamState(),event={effects:[]};
  const ctor=NATIVE_EFFECT_EXECUTOR_CLASSES.GimmickEnthusiasticEffectExecutor;
  assert.equal(ctor,NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES.ExamGimmickEnthusiastic);
  ctor.ExecuteEffect({exam,v1:3,v2:2,event});
  assert.equal(exam.enthusiastic,3);
  ctor.ExecuteEffect({exam,v1:2,v2:2,event});
  assert.equal(exam.enthusiastic,5);
  markNativeStatusTurnStart(exam);
  tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.enthusiastic,5);
  tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.enthusiastic,0);
}
console.log("four ELF timed status executors and expiry: OK");
