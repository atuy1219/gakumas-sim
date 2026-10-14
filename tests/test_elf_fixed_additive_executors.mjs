import assert from "node:assert/strict";
import {
 createExamState, applyParsedExamEffect, tickNativeScoreTimedStatuses,
 markNativeStatusTurnStart
} from "../web/exam_effects.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES as all, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as master } from "../web/tower_runtime.js";

for(const [name,type,field,kind,baseline,after] of [
 ["ReviewAdditiveFixEffectExecutor","ExamReviewAdditiveFix","reviewAdditiveFix","review",3,7],
 ["ParameterBuffAdditiveFixEffectExecutor","ExamParameterBuffAdditiveFix","parameterBuffAdditiveFix","parameter_buff",3,7],
 ["FullPowerPointAdditiveFixEffectExecutor","ExamFullPowerPointAdditiveFix","fullPowerPointAdditiveFix",null,3,7],
]){
 const exam=createExamState();
 const event={effects:[]};
 const ctor=all[name];
 assert.equal(ctor,master[type],name);
 ctor.ExecuteEffect({exam,v1:4,v2:2,event});
 assert.equal(exam[field],4,name);
 ctor.ExecuteEffect({exam,v1:2,v2:2,event});
 assert.equal(exam[field],6,name+" stacking");
 assert.equal(exam.genericTimedStatuses.length,1,name+" merged duration");
 assert.equal(exam.genericTimedStatuses[0].value,6,name+" stacked");
 assert.equal(event.effects.length,2);
 if(kind){
   const other=createExamState();
   assert.equal(applyParsedExamEffect(other,{kind,value:3}).applied,true);
   const before=other[kind==="review"?"review":"parameterBuff"];
   const res=applyParsedExamEffect(exam,{kind,value:3});
   assert.equal(res.applied,true,name);
   assert.equal(exam[kind==="review"?"review":"parameterBuff"],before+6,name+" calculated");
 }
 markNativeStatusTurnStart(exam);
 tickNativeScoreTimedStatuses(exam);
 assert.equal(exam[field],6,name+" first turn");
 tickNativeScoreTimedStatuses(exam);
 assert.equal(exam[field],0,name+" expires");
}
console.log("three ELF fixed additive status executors: OK");
