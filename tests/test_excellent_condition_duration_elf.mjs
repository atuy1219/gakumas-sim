import assert from "node:assert/strict";
import {createExamState, applyParsedExamEffect} from "../web/exam_effects.js";

// IL2CPP ExamStatusEffectCollection.TryAddParameterBuffMultiplePerTurnStatus:
// an active finite duration is incremented, not max-replaced.
// Native capture (16), session 2 turn 7: 3 + 2 + 2 = 7 turns.
{
  const exam=createExamState();
  exam.parameterBuffMultiplePerTurn=3;
  const effect={kind:"parameter_buff_multiple_per_turn",turn:2};
  applyParsedExamEffect(exam,effect);
  assert.equal(exam.parameterBuffMultiplePerTurn,5);
  applyParsedExamEffect(exam,effect);
  assert.equal(exam.parameterBuffMultiplePerTurn,7);
}
{
  const exam=createExamState();
  assert.equal(exam.parameterBuffMultiplePerTurn,0);
  applyParsedExamEffect(exam,{kind:"parameter_buff_multiple_per_turn",turn:3});
  assert.equal(exam.parameterBuffMultiplePerTurn,3);
}
{
  const exam=createExamState();
  exam.parameterBuffMultiplePerTurn=-1;
  applyParsedExamEffect(exam,{kind:"parameter_buff_multiple_per_turn",turn:2});
  assert.equal(exam.parameterBuffMultiplePerTurn,-1);
}
console.log("Native excellent-condition remaining-turn accumulation: OK");
