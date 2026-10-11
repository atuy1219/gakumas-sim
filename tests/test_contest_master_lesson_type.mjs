import assert from "node:assert/strict";
import { createTowerTurnState, drawTowerTurn, playTowerCard } from "../web/tower_runtime.js";

const deck=["cardA","cardB","cardC"].map(id=>({id,upgradeCount:0}));
const byId=new Map(deck.map(c=>[c.id,c]));
const visualPItem={id:"pitem-test-visual-start",effects:[{
 id:"pitem-visual-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
 effectTurn:-1,effectCount:1,
 examStatusEnchant:{id:"enchant-visual",trigger:{
  id:"trigger-start-play-visual",
  phaseTypes:["ProduceExamPhaseType_StartPlay"],
  lessonType:"ProduceStepLessonType_LessonVisual",
 },examEffects:[{id:"effect-review3",effectType:"ProduceExamEffectType_ExamReview",effectValue1:3}]},
}]};
function opening(type){
 const state=createTowerTurnState(deck,11,byId,{
  stamina:100,initialRandomState:11,turnLimit:1,drawPerTurn:3,
  turnParameterTypes:[type],pItems:[visualPItem],
  examRuntimeSettings:{},examScoreSettings:{},
 });
 const turn=drawTowerTurn(state,3);
 return {state,turn};
}
const visual=opening("visual");
assert.equal(visual.state.exam.review,3,"Visual StartPlay must fire");
assert.equal(visual.state.turnStartEffects.filter(x=>x.includes("好印象 +3")).length,1);
assert.equal(visual.turn.hand.length,3);
assert.equal(opening("vocal").state.exam.review,0,"other attributes must not fire Visual effects");

const skillPItem={id:"pitem-test-play",effects:[{
 id:"pitem-play-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
 effectTurn:-1,effectCount:1,
 examStatusEnchant:{id:"enchant-play",trigger:{
  id:"trigger-play-zero",phaseTypes:["ProduceExamPhaseType_ExamCardPlay"],
  phaseValues:[0],
  fieldStatusTypes:["ProduceExamFieldStatusType_StaminaUpMultiple"],
  fieldStatusValues:[800],fieldStatusCheckTypes:[],
  cardSearch:{id:"search-active",
   cardCategories:["ProduceCardCategory_ActiveSkill"],
   cardPositionType:"ProduceCardPositionType_Playing"},
  lowerSearchCount:1,
 },examEffects:[{id:"effect-block6",effectType:"ProduceExamEffectType_ExamBlock",effectValue1:6}]},
}]};
const active=[{id:"active-test",upgradeCount:0,category:"ProduceCardCategory_ActiveSkill",stamina:1},...deck.slice(1)];
const activeMap=new Map(active.map(c=>[c.id,c]));
const activeState=createTowerTurnState(active,22,activeMap,{
 stamina:100,initialRandomState:22,turnLimit:1,drawPerTurn:3,
 turnParameterTypes:["visual"],pItems:[skillPItem],
 examRuntimeSettings:{},examScoreSettings:{},
});
drawTowerTurn(activeState,3);
const activeIndex=activeState.hand.findIndex(c=>c.id==="active-test");
const played=playTowerCard(activeState,activeIndex);
assert.equal(activeState.exam.block,6,"ExamCardPlay phaseValue=0 must fire");
assert.ok(played.effects.some(x=>x.includes("元気 +6")));
console.log("contest master trigger lesson and card-play phases: OK");
