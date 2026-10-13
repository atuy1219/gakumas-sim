import assert from 'node:assert/strict';
import { payCardCost, createExamState } from '../web/exam_effects.js';
import { EXAM_IDOL_STATUS_TYPE } from '../web/exam_score.js';

const card={id:'p_card-03-men-0_015', name:'イメージの基本',stamina:3};
const make=(stage,block=10,stamina=35)=>{
 const e=createExamState({stamina});
 e.block=block;
 e.idolStatusType=EXAM_IDOL_STATUS_TYPE.Concentration;
 e.idolStatusStep=stage;
 e.staminaConsumptionDown=1;
 return e;
};
// Contest #8, turn 6: cost 3 is absorbed by Block, but stage 2
// deducts 1 HP independently of the normal cost.
{
 const e=make(2);
 const effects=payCardCost(e,card);
 assert.equal(e.block,7);
 assert.equal(e.stamina,34);
 assert.ok(effects.some(x=>x.includes('元気貫通体力消費 1')));
}
// Stage 1 has no penetration surcharge; stages are not cumulative.
{
 const e=make(1);
 payCardCost(e,card);
 assert.equal(e.block,7);
 assert.equal(e.stamina,35);
}
// No stance => no surcharge; ordinary stamina damage still works.
{
 const e=make(2,0);
 e.idolStatusType=EXAM_IDOL_STATUS_TYPE.Preservation;
 payCardCost(e,card);
 assert.equal(e.stamina,34); // preservation costs ceil(3*0.25)=1
}
// Stage2 adds 1 even when normal card cost has no remaining stamina cost.
{
 const e=make(2,15,1);
 payCardCost(e,{id:'no-cost',stamina:0});
 assert.equal(e.stamina,0);
 assert.equal(e.block,15);
}
// Stamina cannot be negative, and per-exam settings override the default.
{
 const e=make(2,15,0);
 payCardCost(e,card);
 assert.equal(e.stamina,0);
 e.runtimeSettings={examConcentrationStaminaPenetrateReduce2:2};
 e.stamina=8; e.block=10;
 payCardCost(e,card);
 assert.equal(e.stamina,6);
}
console.log('Concentration stage2 independent stamina penetration: OK');
