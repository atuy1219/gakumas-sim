import assert from 'node:assert/strict';
import {
  createExamState, applyParsedExamEffect, markNativeStatusTurnStart,
  tickNativeScoreTimedStatuses
} from '../web/exam_effects.js';
import {
  NATIVE_EFFECT_EXECUTOR_CLASSES as classes,
  NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as masters,
} from '../web/tower_runtime.js';

{
  const C = classes.BlockAddDownRestrictionEffectExecutor;
  assert.equal(masters.ExamBlockAddDownRestriction, C);
  const exam = createExamState();
  const event = {effects: []};
  C.ExecuteEffect({exam,v1:2,event});
  assert.equal(exam.blockAddDownRestriction,true);
  assert.equal(event.effects.length,1);
  let calls = 0;
  masters.ExamBlockAddDown.ExecuteEffect({exam,event,timedAdd: () => {calls++;}});
  assert.equal(calls,0,'restriction blocks further BlockAddDown');
  markNativeStatusTurnStart(exam);
  tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.blockAddDownRestriction,true);
  tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.blockAddDownRestriction,false);
  masters.ExamBlockAddDown.ExecuteEffect({exam,event,timedAdd: () => {calls++;}});
  assert.equal(calls,1,'after expiry BlockAddDown can be applied');
}
{
  const C = classes.StaminaRecoverAddEffectExecutor;
  assert.equal(masters.ExamStaminaRecoverAdd, C);
  const exam = createExamState({stamina:10}); exam.maxStamina=30;
  const event = {effects: []};
  C.ExecuteEffect({exam,v1:3,event});
  C.ExecuteEffect({exam,v1:2,event});
  assert.equal(exam.staminaRecoverAdd,5);
  const recovered = applyParsedExamEffect(exam, {kind:'stamina_recover',value:4});
  assert.equal(recovered.applied,true);
  assert.equal(exam.stamina,19,'4 base + 5 additive recovery');
  markNativeStatusTurnStart(exam);
  for (let i=0;i<4;i++) tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.staminaRecoverAdd,5,'indefinite status does not expire');
}
console.log('ELF block-add-down restriction and stamina recovery additive: OK');
