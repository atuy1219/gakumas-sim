import assert from "node:assert/strict";
import { payCardCost } from "../web/exam_effects.js";
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
// An idol-unique card has an originIdolCardId in the ProduceCard master,
// not a literal searchTag. Native after-play P-item checks must see it.
const idolSearch={
 id:"idol-unique",cardSearchTag:"idol-unique",
 cardPositionType:"ProduceCardPositionType_Target",
};
const idolPItem={id:"pitem-idol",effects:[{
 id:"pitem-idol-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
 effectCount:1,effectTurn:-1,
 examStatusEnchant:{id:"enchant-idol",trigger:{
  id:"trigger-idol-after",
  phaseTypes:["ProduceExamPhaseType_ExamCardPlayAfter"],
  fieldStatusTypes:["ProduceExamFieldStatusType_StaminaUpMultiple"],
  fieldStatusValues:[800],lowerSearchCount:1,cardSearch:idolSearch,
 },examEffects:[{
  id:"effect-extra",effectType:"ProduceExamEffectType_ExamPlayableValueAdd",
  effectValue1:0,effectCount:1,
 }]},
}]};
const idolDeck=[
 {id:"idol-special",upgradeCount:0},
 {id:"ordinary",upgradeCount:0},
 {id:"ordinary2",upgradeCount:0},
];
const idolMasters=new Map(idolDeck.map(c=>[c.id,{
 ...c,category:"ProduceCardCategory_MentalSkill",
 originIdolCardId:c.id==="idol-special"?"i_card-unique":"",
}]));
const idolState=createTowerTurnState(idolDeck,42,idolMasters,{
 stamina:100,initialRandomState:42,turnLimit:1,drawPerTurn:3,
 turnParameterTypes:["vocal"],pItems:[idolPItem],
 examRuntimeSettings:{},examScoreSettings:{},
});
drawTowerTurn(idolState,3);
const idolIndex=idolState.hand.findIndex(c=>c.id==="idol-special");
assert.ok(idolIndex>=0);
playTowerCard(idolState,idolIndex);
assert.equal(idolState.playsRemaining,1,
 "Idol unique after-play P-item effect must grant another play");

console.log("contest master trigger lesson, play phases and idol-unique search: OK");

const fullPowerPItem={id:"pitem-full-power",effects:[{
 id:"e-full",effectType:"ProduceItemEffectType_ExamStatusEnchant",effectCount:1,effectTurn:-1,
 examStatusEnchant:{id:"ench-full",trigger:{
  id:"t-full",phaseTypes:["ProduceExamPhaseType_ExamCardPlay"],phaseValues:[0],
  fieldStatusTypes:["ProduceExamFieldStatusType_FullPowerUp"],fieldStatusValues:[0],
  lowerSearchCount:1,cardSearch:idolSearch,
 },examEffects:[{id:"effect-block4",effectType:"ProduceExamEffectType_ExamBlock",effectValue1:4}]},
}]};
function fullPowerTrigger(stance){
 const state=createTowerTurnState(idolDeck,44,idolMasters,{
  stamina:100,initialRandomState:44,turnLimit:1,drawPerTurn:3,
  turnParameterTypes:["vocal"],pItems:[fullPowerPItem],
  examRuntimeSettings:{},examScoreSettings:{},
 });
 drawTowerTurn(state,3);
 state.exam.idolStatusType=stance;
 state.exam.idolStatusStep=1;
 playTowerCard(state,state.hand.findIndex(c=>c.id==="idol-special"));
 return state.exam.block;
}
assert.equal(fullPowerTrigger(0),0,
 "FullPowerUp=0 must not match a player outside the full-power stance");
assert.equal(fullPowerTrigger(3),4,
 "FullPowerUp=0 must match an active full-power stance");

const thresholdItem={id:"pitem-light-purple",effects:[{
 id:"item-light-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
 effectTurn:-1,effectCount:3,examStatusEnchant:{
  id:"light-enchant",trigger:{
   id:"light-trigger",phaseTypes:["ProduceExamPhaseType_ExamCardPlay"],
   phaseValues:[0],fieldStatusTypes:["ProduceExamFieldStatusType_StaminaUpMultiple"],
   fieldStatusValues:[800],cardSearch:{
    id:"active-playing",cardCategories:["ProduceCardCategory_ActiveSkill"],
    cardPositionType:"ProduceCardPositionType_Playing"
   },lowerSearchCount:1,
  },examEffects:[{id:"light-block6",effectType:"ProduceExamEffectType_ExamBlock",effectValue1:6}]
 }}]};
function thresholdTest(initialStamina){
 const cards=[{id:"active-cost",upgradeCount:0},{id:"filler1",upgradeCount:0},{id:"filler2",upgradeCount:0}];
 const masters=new Map(cards.map(card=>[card.id,{
  ...card,category:card.id==="active-cost"?"ProduceCardCategory_ActiveSkill":"ProduceCardCategory_MentalSkill",
  stamina:card.id==="active-cost"?10:0,
 }]));
 const st=createTowerTurnState(cards,32,masters,{
  stamina:initialStamina,initialRandomState:32,
  drawPerTurn:3,turnLimit:1,turnParameterTypes:["visual"],pItems:[thresholdItem],
  examRuntimeSettings:{},examScoreSettings:{},captureActionTelemetry:true,
 });
 st.exam.maxStamina=100;
 drawTowerTurn(st,3);
 const action=playTowerCard(st,st.hand.findIndex(card=>card.id==="active-cost"));
 return {state:st,action};
}
const above=thresholdTest(85);
assert.equal(above.state.exam.block,6,
 "Purple light should test 85% pre-cost stamina, not 75% post-cost");
const triggerPhase=above.action.actionTelemetry.find(x=>x.phase==="before-main-card-effects-after-card-play-triggers");
assert.equal(triggerPhase.block,6);
assert.deepEqual(triggerPhase.effects,["元気 +6"]);
assert.equal(above.action.actionTelemetry[0].stamina,85);
assert.equal(triggerPhase.stamina,75);
const below=thresholdTest(79);
assert.equal(below.state.exam.block,0,
 "Purple light should not trigger below 80% before the card cost");

// Captured contest #4 T1: prior 仕切り直し+ grants 4 turns of
// 50% stamina reduction, which must also modify 気分転換's forceStamina.
const directExam={stamina:36,maxStamina:42,block:15,staminaConsumptionDown:4};
const directEvents=payCardCost(directExam,{
 id:"p_card-02-act-0_010",stamina:0,forceStamina:5,
 costType:"ExamCostType_Unknown",costValue:0,
});
assert.equal(directExam.stamina,33);
assert.equal(directExam.block,15,"forceStamina must not consume Genki");
assert.ok(directEvents.includes("直接体力消費 3"));
const noBuff={stamina:36,maxStamina:42,block:15,staminaConsumptionDown:0};
payCardCost(noBuff,{stamina:0,forceStamina:5});
assert.equal(noBuff.stamina,31,"unmodified direct stamina cost remains 5");
