import assert from "node:assert/strict";
import {createTowerTurnState,drawTowerTurn,playTowerCard} from "../web/tower_runtime.js";

// Regression evidence: contest capture (16), native fixed stamina, card
// p_card-01-ido-3_202 and P-item trigger; native block +10 and P-item order.
const effect=(id,type,v1,v2=0)=>({
  id,effectType:"ProduceExamEffectType_"+type,
  effectValue1:v1,effectValue2:v2,effectCount:1,effectTurn:0,
});
const deck=[
  {id:"active",upgradeCount:0,costValue:0,playEffects:[{produceExamEffectId:"damage"}]},
  {id:"filler-a",upgradeCount:0},{id:"filler-b",upgradeCount:0},
];
const masters=new Map(deck.map(card=>[card.id,card]));
const settings={
  stamina:39,turnLimit:2,drawPerTurn:3,initialRandomState:421,
  examRuntimeSettings:{},examScoreSettings:{},
};
{
  const state=createTowerTurnState(deck,421,masters,{
    ...settings,examEffectById:new Map([["damage",effect("damage","ExamStaminaReduceFix",2)]]),
  });
  drawTowerTurn(state,3);
  state.exam.staminaConsumptionDownFix=1;
  playTowerCard(state,state.hand.findIndex(card=>card.id==="active"));
  assert.equal(state.exam.stamina,37,"fixed direct stamina reduction bypasses card-cost downFix");
}
const pitem=(id,phase,examEffects)=>({
  id,effects:[{
    id:id+"-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
    effectTurn:-1,effectCount:1,
    examStatusEnchant:{
      id:id+"-enchant",trigger:{id:id+"-trigger",phaseTypes:[phase]},
      examEffects,
    },
  }],
});
{
  const startEffect=effect("start-aggressive","ExamCardPlayAggressive",10);
  const intervalEffect=effect("interval-block","ExamBlockAddMultipleAggressive",2,300);
  const state=createTowerTurnState(deck,421,masters,{
    ...settings,
    // Intentionally put Interval first; native phase priority overrides
    // registration order when both normalize to START_OF_TURN.
    pItems:[
      pitem("interval","ProduceExamPhaseType_ExamTurnInterval",[intervalEffect]),
      pitem("start","ProduceExamPhaseType_ExamStartTurn",[startEffect]),
    ],
    examEffectById:new Map([
      [startEffect.id,startEffect],
      [intervalEffect.id,intervalEffect],
    ]),
  });
  drawTowerTurn(state,3);
  assert.equal(state.exam.aggressive,10);
  assert.equal(state.exam.block,15,
    "Value2=300 is additive over 100%, and StartTurn executes before Interval");
}
console.log("Native stamina, block multiplier, P-item phase priority: OK");
