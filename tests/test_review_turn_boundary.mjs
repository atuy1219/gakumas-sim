import assert from "node:assert/strict";
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard } from "../web/tower_runtime.js";

// Verified against v3.4.1 native ReviewStatusEffect.SpendTurn (0x08082A18).
// Contest #4: StartPlay P-item Review 3 is marked, so it spends at next start.
// Contest #5: Review 6 played as a card is unmarked until the NEXT StartPlay.
const deck=["review-card","b","c","d","e","f","g","h","i"]
  .map(id=>({id,upgradeCount:0,isInitial:id==="review-card"}));
const byId=new Map(deck.map(card=>[card.id,{
 ...card,...(card.id==="review-card" ? {
  playEffects:[{produceExamEffectId:"review6"}],
 } : {}),
}]));
const examEffectById=new Map([["review6",{
 id:"review6",effectType:"ProduceExamEffectType_ExamReview",effectValue1:6,
}]]);
const startReviewItem={id:"pitem-start",effects:[{
 id:"pitem-effect",effectType:"ProduceItemEffectType_ExamStatusEnchant",
 effectTurn:-1,effectCount:1,examStatusEnchant:{
  id:"enchant-start",trigger:{
   id:"trigger-start",phaseTypes:["ProduceExamPhaseType_StartPlay"],
   lessonType:"ProduceStepLessonType_LessonVisual",
  },examEffects:[{
   id:"start-review3",effectType:"ProduceExamEffectType_ExamReview",effectValue1:3,
  }],
 },
}]};
function make(pItems=[]){
 return createTowerTurnState(deck,11,byId,{
  stamina:100,initialRandomState:11,turnLimit:3,drawPerTurn:3,
  turnParameterTypes:["visual","visual","visual"],pItems,examEffectById,
  examRuntimeSettings:{},examScoreSettings:{},
 });
}

const itemRun=make([startReviewItem]);
drawTowerTurn(itemRun);
assert.equal(itemRun.exam.review,3);
assert.equal(itemRun.exam.passingTurnStartFields.review,true);
finishTowerTurn(itemRun);
assert.equal(itemRun.exam.review,3,"StartPlay item review must survive its granting turn");
drawTowerTurn(itemRun);
assert.equal(itemRun.exam.review,2,"Eligible item review spends before next-turn actions");
finishTowerTurn(itemRun);
assert.equal(itemRun.exam.review,2,"Do not spend review after turn-end score");
drawTowerTurn(itemRun);
assert.equal(itemRun.exam.review,1);

const cardRun=make();
drawTowerTurn(cardRun);
playTowerCard(cardRun,cardRun.hand.findIndex(card=>card.id==="review-card"));
assert.equal(cardRun.exam.review,6);
assert.equal(cardRun.exam.passingTurnStartFields.review,false);
finishTowerTurn(cardRun);
assert.equal(cardRun.exam.review,6);
drawTowerTurn(cardRun);
assert.equal(cardRun.exam.review,6,"A card's new review remains unspent on next start");
assert.equal(cardRun.exam.passingTurnStartFields.review,true);
finishTowerTurn(cardRun);
assert.equal(cardRun.exam.review,6);
drawTowerTurn(cardRun);
assert.equal(cardRun.exam.review,5,"Review from the card starts spending one turn later");
console.log("Native review turn-boundary regressions: OK");
