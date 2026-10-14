import assert from "node:assert/strict";
import { createExamState } from "../web/exam_effects.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES as all, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as master } from "../web/tower_runtime.js";
const C=all.ParameterBuffPerSearchCountEffectExecutor;
assert.equal(master.ExamParameterBuffPerSearchCount,C);
for(const [v1,v2,count,expected] of [
 [2,500,3,4], [2,500,0,2], [2,1000,2,4], [0,0,0,0],
]){
 const exam=createExamState(),event={effects:[]};
 const status=(field,value,label,additive,fixed)=>{
   assert.equal(field,"parameterBuff"); assert.equal(label,"好調");
   assert.equal(additive,"parameterBuffAdditivePermil");
   assert.equal(fixed,"parameterBuffAdditiveFix");
   exam[field]+=value;event.effects.push(label+" +"+value);
 };
 C.ExecuteEffect({exam,v1,v2,searchCount:()=>count,status,event});
 assert.equal(exam.parameterBuff,expected);
 assert.equal(event.effects.length,1);
}
console.log("native ParameterBuffPerSearchCount: OK");
