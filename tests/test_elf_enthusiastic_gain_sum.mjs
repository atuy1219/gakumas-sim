import assert from "node:assert/strict";
import {
 createExamState, addNativeScalarTimedStatus, markNativeStatusTurnStart,
 tickNativeScoreTimedStatuses
} from "../web/exam_effects.js";
import {
 NATIVE_EFFECT_EXECUTOR_CLASSES as all,
 NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as master
} from "../web/tower_runtime.js";
const C=all.LessonDependEnthusiasticGetSumEffectExecutor;
assert.equal(C,master.ExamLessonDependEnthusiasticGetSum);
const exam=createExamState();
assert.equal(exam.enthusiasticGetSumCount,0);
assert.equal(addNativeScalarTimedStatus(exam,"enthusiastic",4,1),true);
assert.equal(addNativeScalarTimedStatus(exam,"enthusiastic",5,1),true);
assert.equal(exam.enthusiastic,9);
assert.equal(exam.enthusiasticGetSumCount,9);
markNativeStatusTurnStart(exam);tickNativeScoreTimedStatuses(exam);
assert.equal(exam.enthusiastic,0,"timed enthusiastic expires");
assert.equal(exam.enthusiasticGetSumCount,9,"cumulative gain stays");
const event={effects:[]};
const state={exam,turn:1,turnParameterTypes:[],parameterBonus:{}};
C.ExecuteEffect({state,exam,parsed:{count:2},v1:4,v2:500,event});
assert.equal(exam.parameter,18,"(4+ceil(0.5*9))*2");
assert.equal(event.effects.length,1);
C.ExecuteEffect({state,exam,parsed:{count:0},v1:100,v2:500,event});
assert.equal(exam.parameter,18,"count zero does not trigger score");
const exam2=createExamState();const state2={exam:exam2,turn:1,turnParameterTypes:[],parameterBonus:{}};
C.ExecuteEffect({state:state2,exam:exam2,parsed:{count:1},v1:4,v2:500,event:{effects:[]}});
assert.equal(exam2.parameter,4,"no gains leaves only Value1");
console.log("ELF cumulative EnthusiasticGetSum lesson: OK");
