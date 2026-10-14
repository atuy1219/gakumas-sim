import assert from 'node:assert/strict';
import { calculateNativeStaminaDamage, createExamState } from '../web/exam_effects.js';
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from '../web/tower_runtime.js';

// Stamina consumption reduction cannot create negative costs; with Genki,
// the post-modifier cost must be clamped BEFORE distributing to Block/Stamina.
{
  const exam=createExamState();
  exam.block=4;
  exam.staminaConsumptionDown=2;
  exam.runtimeSettings={...exam.runtimeSettings,examStaminaConsumptionDownPermil:1400};
  const v=calculateNativeStaminaDamage(exam,3);
  assert.deepEqual([v.damage,v.blockDamage,v.staminaDamage],[0,0,0]);
}
const e={
  id:'signal-enchant',produceExamTriggerId:'e_trigger-exam_buff_consume',
  produceExamEffectIds:[],
  trigger:{id:'e_trigger-exam_buff_consume',phaseTypes:['ProduceExamPhaseType_ExamBuffConsume']},
  examEffects:[
    {id:'signal-heal',effectType:'ProduceExamEffectType_ExamStaminaRecoverMultiple',effectValue1:200},
    {id:'signal-bonus',effectType:'ProduceExamEffectType_ExamReviewMultiple',effectValue1:100,effectTurn:-1},
  ],
};
const pItem={id:'signal',name:'みちなるシグナル',effects:[{
  id:'effect',effectType:'ProduceItemEffectType_ExamStatusEnchant',
  effectTurn:-1,effectCount:1,examStatusEnchant:e,
}]};
const cards=[
  {id:'buff-cost',name:'ゆめみごこち',costType:'ExamCostType_ExamReview',costValue:2,stamina:0,
    playMovePositionType:'ProduceCardMovePositionType_Grave',playEffects:[]},
  {id:'normal',name:'目線の基本',stamina:0,playMovePositionType:'ProduceCardMovePositionType_Grave',playEffects:[]},
  {id:'normal2',name:'dummy',stamina:0,playMovePositionType:'ProduceCardMovePositionType_Grave',playEffects:[]},
];
const m=new Map(cards.map(x=>[x.id,x]));
const s=createTowerTurnState(cards,1234,m,{stamina:39,turnLimit:3,drawPerTurn:3,pItems:[pItem]});
s.exam.stamina=8;
s.exam.review=3;
s.captureActionTelemetry=true;
drawTowerTurn(s,3);
const i=s.hand.findIndex(c=>c.id==='buff-cost');
const evt=playTowerCard(s,i);
assert.equal(s.exam.review,1,'card spent 2 review points');
assert.equal(evt.actionTelemetry.find(p=>p.phase==='after-main-card-effects-before-after-card-play-triggers').stamina,8,
 'native completion must be prior to recovery');
assert.equal(s.exam.stamina,16,'20% max stamina recovery after completed card');
assert.ok(evt.actionTelemetry.find(p=>p.phase==='after-card-play-triggers').stamina===16);
const bonusBefore=s.exam.reviewMultiple;
finishTowerTurn(s);
// An ordinary Review SpendTurn is not native ExamBuffConsume: no recovery.
s.exam.stamina=8;
drawTowerTurn(s,3);
assert.equal(s.exam.stamina,8,'ordinary Review turn spend must not trigger signal');
assert.equal(s.exam.reviewMultiple,bonusBefore,'normal turn spend must not stack review multiple');
console.log('Buff cost triggers recovery only after main card; natural turn spend ignored; zero floor: OK');
