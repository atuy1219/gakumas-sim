import assert from "node:assert/strict";
import { createTowerTurnState, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as effects } from "../web/tower_runtime.js";
import { markNativeStatusTurnStart, tickNativeScoreTimedStatuses } from "../web/exam_effects.js";

const initial = Array.from({length:6},(_,i)=>({id:"base-"+i,upgradeCount:0,stamina:0,playEffects:[]}));
const card0={id:"GEN",upgradeCount:0,stamina:7,playEffects:[],rarity:"SSR"};
const card1={...card0,upgradeCount:1,stamina:3};
const masters=new Map([...initial,card0].map(card=>[card.id,card]));
const variants=new Map([["GEN@@0",card0],["GEN@@1",card1]]);
const search=new Map([["gen-only",{produceCardIds:["GEN"],upgradeCounts:[0]}]]);
const state=createTowerTurnState(initial,123,masters,{
  cardVariantByKey:variants,cardSearchById:search,stamina:30,turnLimit:5,
});
const create=()=>{
  const event={effects:[],created:[],moved:[],drawn:[],grown:[],supportCardRolls:[],recycleEvents:[]};
  effects.ExamCardCreateSearch.ExecuteEffect({
    state,exam:state.exam,event,v1:0,v2:0,turn:0,
    parsed:{searchId:"gen-only",pickCountMin:1,pickCountMax:1,movePositionType:"ProduceCardMovePositionType_DeckFirst"},
  });
  assert.equal(event.created.length,1);
  return event.created[0].card;
};
const before=create();
assert.equal(before.upgradeCount,0,"generated card stays base before upgrade status");
effects.ExamGetCardUpgrade.ExecuteEffect({exam:state.exam,v1:2,event:{effects:[]}});
assert.equal(state.exam.getCardUpgrade,true);
const upgraded=create();
assert.equal(upgraded.upgradeCount,1,"native AddCard upgrades newly obtained eligible card");
assert.equal(upgraded.stamina,3,"upgraded variant must change master-defined costs");
const stored=state.deck.find(x=>x.token===upgraded.token);
assert.equal(stored.upgradeCount,1);
markNativeStatusTurnStart(state.exam);
tickNativeScoreTimedStatuses(state.exam);
tickNativeScoreTimedStatuses(state.exam);
assert.equal(state.exam.getCardUpgrade,false,"status expires after two passed turns");
assert.equal(create().upgradeCount,0,"new card no longer upgrades after expiration");
assert.equal(stored.upgradeCount,1,"previously acquired cards retain their grade");
console.log("ELF GetCardUpgrade/AddCard new-card-only upgrade and expiry: OK");
