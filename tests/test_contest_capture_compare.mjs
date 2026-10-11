import assert from "node:assert/strict";
import { compareContestCapture, reconstructContestCapture, verifyContestSetupRng } from "../web/contest_capture_compare.js";
import { replayObservedContest, ContestReplayUnsupported } from "../web/contest_native_replay.js";
import { normalizeNativeContestSetup } from "../web/contest_native_setup.js";
import { createTowerTurnState, drawTowerTurn } from "../web/tower_runtime.js";

const capture={schemaVersion:2,scope:"contest-gameplay-capture",moduleVersion:"1.5.17",events:[
 {pid:2,sessionId:1,event:"contest-start",characterId:"hrnm",seed:12,dataComplete:true},
 {pid:2,sessionId:1,event:"contest-progress",step:1,turnsEncoding:"delta",turnStartIndex:0,
  turnCount:1,turns:[{turn:1,score:6,hand:[{id:"card"}]}],
  score:6,vocal:6,dance:0,visual:0,dataComplete:true},
 {pid:2,sessionId:1,event:"contest-progress",step:2,turnsEncoding:"delta",turnStartIndex:1,
  turnCount:2,turns:[{turn:2,score:7,hand:[{id:"card2"}]}],
  score:7,vocal:7,dance:0,visual:0,dataComplete:true},
 {pid:2,sessionId:1,event:"contest-result",step:2,
  score:7,vocal:7,dance:0,visual:0,recordingComplete:true,dataComplete:true},
]};
const s=reconstructContestCapture(capture).sessions[0];
assert.equal(s.complete,true);
assert.deepEqual(s.turns.map(t=>t.turn),[1,2]);
let report=compareContestCapture(capture);
assert.equal(report.status,"simulation-unavailable");
assert.equal(report.complete,false);
assert.equal(report.summary.capturesComplete,1);
assert.equal(report.summary.totalTurns,2);
assert.equal(report.summary.simulationCompared,0);
assert.ok(report.sessions[0].warnings.some(w=>w.startsWith("simulator-input-missing:")));
const setup=Object.fromEntries(["initialDeck","pItems","initialParameters","examSettings","randomStateAtStart"].map(k=>[k,{}]));
capture.simulatorInputs={"2:1":setup};
report=compareContestCapture(capture,{simulator:()=>({
 provenance:"independent-simulator",progress:[{score:6},{score:7}],turns:[{turn:1},{turn:2}],result:{score:7}
})});
assert.equal(report.status,"partial-match");
assert.equal(report.complete,false);
assert.equal(report.summary.simulationPartialMatches,1);
report=compareContestCapture(capture,{simulator:()=>({
 provenance:"independent-simulator",progress:[{score:6},{score:9}],turns:[{turn:1},{turn:2}],result:{score:7}
})});
assert.equal(report.status,"mismatch");
assert.deepEqual(report.firstDivergence,{path:"progress[1].score",realDevice:7,simulation:9});
report=compareContestCapture(capture,{simulator:()=>({progress:[{score:6},{score:7}]})});
assert.equal(report.status,"simulation-unavailable");
assert.ok(report.sessions[0].warnings.some(w=>w.startsWith("simulator-execution-failed:")));
capture.events[2].turnStartIndex=3;
report=compareContestCapture(capture);
assert.equal(report.summary.capturesComplete,0);
assert.ok(report.sessions[0].warnings.some(w=>w.includes("turn-delta-gap")));
const old={scope:"contest-gameplay-capture",events:[capture.events[0],
 {...capture.events[1],turnsEncoding:undefined,turnStartIndex:undefined,turnCount:undefined},
 {...capture.events[2],turnsEncoding:undefined,turnStartIndex:undefined,turnCount:undefined,
 turns:[{turn:1,score:6,hand:[{id:"card"}]},{turn:2,score:7,hand:[{id:"card2"}]}]},
 capture.events[3]]};
assert.equal(reconstructContestCapture(old).sessions[0].turns.length,2);
// Confirm that native decisions do not become fake simulator outputs:
// a fresh runtime must independently shuffle/draw and predict turn values.
const neutralDeck=["p_card-N-A","p_card-N-B","p_card-N-C"].map(id=>({id,upgradeCount:0}));
const neutralMasters=new Map(neutralDeck.map(card=>[card.id,card]));
const nativeInput={
 initialDeck:neutralDeck,pItems:[],examSettings:{},
 randomStateAtStart:123,
 initialParameters:{stamina:100,maxStamina:100,drawPerTurn:3,turnLimit:1,
  turnParameterTypes:["vocal"]},
};
const expectedState=createTowerTurnState(neutralDeck,123,neutralMasters,{
 initialRandomState:123,stamina:100,turnLimit:1,drawPerTurn:3,
 turnParameterTypes:["vocal"],examRuntimeSettings:{},examScoreSettings:{},
});
const expectedHand=drawTowerTurn(expectedState,3).hand.map(c=>({id:c.id}));
const neutralSession={start:{seed:123},complete:true,
 turns:[{turn:1,hand:expectedHand,commands:[]}],
};
const predicted=replayObservedContest(neutralSession,nativeInput,{cardById:neutralMasters});
assert.equal(predicted.provenance,"independent-simulator");
assert.equal(predicted.replayMode,"observed-actions");
assert.equal(predicted.decisionSearchVerified,false);
assert.equal(predicted.turns.length,1);
assert.equal(predicted.warnings.length,0);
assert.equal(typeof predicted.result.score,"number");
assert.throws(()=>replayObservedContest(neutralSession,{
 ...nativeInput,randomStateAtStart:null,
},{cardById:neutralMasters}),ContestReplayUnsupported);
const mismatched={...neutralSession,turns:[{...neutralSession.turns[0],
 hand:[{id:"N-UNEXPECTED"},...expectedHand.slice(1)]}]};
const wrong=replayObservedContest(mismatched,nativeInput,{cardById:neutralMasters});
assert.equal(wrong.warnings.length,1);
assert.equal(wrong.turns.length,1);
assert.equal(wrong.turns[0].hand[0].id,expectedHand[0].id);
assert.equal(wrong.result,undefined);
const reflectedFields=Object.fromEntries(neutralDeck.map((c,i)=>[i,c]));
const wrappedDeck={ $type:"List`1",count:3,elements:neutralDeck.map(card=>({
 $type:"ExamCardData",fields:{"<ProduceCardId>k__BackingField":card.id,
 "<UpgradeCount>k__BackingField":0},
}))};
const normalizedSession={
 ...neutralSession,
 start:{...neutralSession.start,settingId:"p_exam_setting-1",
  nativeInitialState:{available:true,root:{$type:"ExamData",fields:{
   "<DeckProduceCardDataList>k__BackingField":wrappedDeck,
   "<ItemList>k__BackingField":{$type:"List`1",count:0,elements:[]},
   "<Stamina>k__BackingField":100,
   "<MaxStamina>k__BackingField":100,
   "<LimitTurn>k__BackingField":1,
  }}}},
 setup:{randomStateBeforeSetUp:123,examParameterSnapshot:{root:{$type:"ExamParameterModel",fields:{
  "<Stamina>k__BackingField":100,
  "<MaxStamina>k__BackingField":100,
  "<LimitTurn>k__BackingField":1,
  "<CardDrawCountPerTurn>k__BackingField":3,
  "<TurnParameterTypeList>k__BackingField":{$type:"List`1",count:1,elements:["Vocal"]},
 }}}},
};
const normalized=normalizeNativeContestSetup(normalizedSession,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(normalized.available,true,JSON.stringify(normalized.reasons));
assert.deepEqual(normalized.input.initialDeck,neutralDeck);
assert.equal(normalized.input.randomStateAtStart,123);
assert.equal(normalized.input.pItems.length,0);
const fixedSetup=normalizeNativeContestSetup({
 ...normalizedSession,setup:{...normalizedSession.setup,randomStateBeforeSetUp:null}
},{examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}]}});
assert.equal(fixedSetup.available,false);
assert.ok(fixedSetup.reasons.includes("pre-setup-random-state-missing"));
// Nine real native SetUpExam RNG observations from v1.5.18. Validate the
// complete XorShift32 chain, not a guessed or copied progress score.
const nativeSetupRngVectors=[
 [32569095,1938114379,7],[1728841425,3550892691,7],
 [988836711,2398991445,7],[275327106,2834979204,9],
 [1331584265,1347158072,9],[451864063,1297780487,9],
 [1983240382,3042704686,5],[1178990414,32525392,5],
 [714590827,3952157581,5],
];
for(const [seed,randomStateObserved,steps] of nativeSetupRngVectors){
 const verification=verifyContestSetupRng({start:{seed},setup:{randomStateObserved}});
 assert.equal(verification.status,"match");
 assert.equal(verification.advanceSteps,steps);
 assert.equal(verification.verifiedPreShuffle,false);
}
assert.equal(verifyContestSetupRng({start:{seed:1},setup:{randomStateObserved:null}}).status,"unavailable");
// The v1.5.19 real-device shape uses a top-level DeckList, inherited card
// backing fields, and numeric ProduceParameterType value-type list entries.
const deviceShape={
 ...normalizedSession,
 start:{...normalizedSession.start,
  nativeInitialState:{available:true,complete:false,root:{$type:"ExamData",fields:{
   "<DeckList>k__BackingField":neutralDeck.map((card,i)=>({
    $type:"ExamCardData",fields:{"_produceCardId":card.id,
     "_baseUpgradeCount":0,"_fixedDeckOrder":i}
   })),
   "<LimitTurn>k__BackingField":1,
   "<Stamina>k__BackingField":35,
   "<MaxStamina>k__BackingField":45,
   "<ItemList>k__BackingField":{$type:"List`1",count:0,elements:[]},
  }}},
 },
 setup:{...normalizedSession.setup,examParameterSnapshot:{available:true,complete:false,
  root:{$type:"ExamParameterModel",fields:{
   ...normalizedSession.setup.examParameterSnapshot.root.fields,
   "<LimitTurn>k__BackingField":null,
   "_turnTargetStatusParameterTypeList":{$type:"List`1",count:1,
     elements:[{$type:"ProduceParameterType",fields:{value__:1}}]},
  }}}},
};
const parsedDevice=normalizeNativeContestSetup(deviceShape,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(parsedDevice.available,true,JSON.stringify(parsedDevice.reasons));
assert.deepEqual(parsedDevice.input.initialDeck.map(x=>x.id),neutralDeck.map(x=>x.id));
assert.deepEqual(parsedDevice.input.initialParameters.turnParameterTypes,["vocal"]);
assert.equal(parsedDevice.input.initialParameters.turnLimit,1);
const missingIds={
 ...deviceShape,start:{...deviceShape.start,nativeInitialState:{...deviceShape.start.nativeInitialState,
  root:{$type:"ExamData",fields:{
    ...deviceShape.start.nativeInitialState.root.fields,
    "<DeckList>k__BackingField":neutralDeck.map(()=>({$type:"ExamCardData",fields:{"_baseUpgradeCount":0}}))
  }}
 }}
};
const rejected=normalizeNativeContestSetup(missingIds,{examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}]}});
assert.equal(rejected.available,false);
assert.ok(rejected.reasons.includes("native-deck-not-recognized"));
const scannedDeck={
 ...deviceShape,start:{...deviceShape.start,nativeInitialState:{
  ...deviceShape.start.nativeInitialState,root:{$type:"ExamData",fields:{
   ...deviceShape.start.nativeInitialState.root.fields,
   "<DeckList>k__BackingField":neutralDeck.map(c=>({
    $type:"ExamCardData",fields:{"$scannedCardId":c.id,"$scannedCardIdAmbiguous":false,
     "_baseUpgradeCount":c.upgradeCount,"_fixedDeckOrder":0}
   })),
  }},
 }},
};
const scannedResult=normalizeNativeContestSetup(scannedDeck,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(scannedResult.available,true,JSON.stringify(scannedResult.reasons));
assert.deepEqual(scannedResult.input.initialDeck.map(c=>c.id),neutralDeck.map(c=>c.id));
const scanMissing={...scannedDeck,start:{...scannedDeck.start,nativeInitialState:{
 ...scannedDeck.start.nativeInitialState,root:{$type:"ExamData",fields:{
  ...scannedDeck.start.nativeInitialState.root.fields,
  "<DeckList>k__BackingField":[{$type:"ExamCardData",fields:{"$scannedCardId":null,"_baseUpgradeCount":0}}],
 }},
}}};
assert.ok(normalizeNativeContestSetup(scanMissing,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}]},
}).reasons.includes("native-deck-not-recognized"));
// Native ArraySegment<T> must preserve the slice, not be mistaken for an
// empty IReadOnlyList or a missing P-item collection.
const segmentSession={...deviceShape,start:{...deviceShape.start,
 nativeInitialState:{...deviceShape.start.nativeInitialState,
 root:{$type:"ExamData",fields:{
  ...deviceShape.start.nativeInitialState.root.fields,
  "<ItemList>k__BackingField":{$type:"ArraySegment`1",fields:{
   _array:[null,{$type:"Item",fields:{_id:"pitem_0001"}},null],_offset:1,_count:1,
  }},
 }}}}};
const segment=normalizeNativeContestSetup(segmentSession,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],
  itemById:new Map([["pitem_0001",{id:"pitem_0001",produceItemEffectIds:[]}]]),
  itemEffectById:new Map()},
});
assert.ok(segment.available,JSON.stringify(segment.reasons));
assert.deepEqual(segment.input.pItems.map(x=>x.id),["pitem_0001"]);
// v1.5.22 metadata revealed the real ExamCardData._cardData reference at
// +0x10 (IL2CPP type kind 18); no ProduceCardId field is inherited.
const nestedCardMasterSession={
 ...deviceShape,
 start:{...deviceShape.start,nativeInitialState:{
  ...deviceShape.start.nativeInitialState,
  root:{$type:"ExamData",fields:{
   ...deviceShape.start.nativeInitialState.root.fields,
   "<DeckList>k__BackingField":neutralDeck.map(card=>({
    $type:"ExamCardData",fields:{
     "_cardData":{$type:"ProduceCardData",fields:{"_id":card.id}},
     "_baseUpgradeCount":card.upgradeCount,
     "$scannedCardId":null,"$scannedCardIdAmbiguous":false,
    },
   })),
  }},
 }},
};
const nestedResult=normalizeNativeContestSetup(nestedCardMasterSession,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],
  itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(nestedResult.available,true,JSON.stringify(nestedResult.reasons));
assert.deepEqual(nestedResult.input.initialDeck.map(card=>card.id),neutralDeck.map(card=>card.id));
const missingNestedMaster={
 ...nestedCardMasterSession,
 start:{...nestedCardMasterSession.start,nativeInitialState:{
  ...nestedCardMasterSession.start.nativeInitialState,
  root:{$type:"ExamData",fields:{
   ...nestedCardMasterSession.start.nativeInitialState.root.fields,
   "<DeckList>k__BackingField":[{$type:"ExamCardData",fields:{
    "_cardData":{$type:"ProduceCardData",fields:{"_id":null}},
    "_baseUpgradeCount":0,
   }}],
  }},
 }},
};
assert.ok(normalizeNativeContestSetup(missingNestedMaster,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}]},
}).reasons.includes("native-deck-not-recognized"));
console.log("contest capture comparison, setup normalization and independent action replay: OK");
