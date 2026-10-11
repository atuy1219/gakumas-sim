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
