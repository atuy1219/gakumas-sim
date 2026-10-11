import assert from "node:assert/strict";
import { compareContestCapture, reconstructContestCapture, verifyContestSetupRng } from "../web/contest_capture_compare.js";
import { replayObservedContest, ContestReplayUnsupported } from "../web/contest_native_replay.js";
import { normalizeNativeContestSetup } from "../web/contest_native_setup.js";
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from "../web/tower_runtime.js";
import { advanceXorshift32 } from "../web/simulation.js";

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
assert.ok(fixedSetup.reasons.includes("initial-shuffle-random-state-unavailable"));
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
// The real p_exam_setting-1 master supplies turnStartDistribute=3.
// No first-hand inference or globally hardcoded draw count is allowed.
const masterDrawSession={
 ...deviceShape,
 setup:{...deviceShape.setup,examParameterSnapshot:{
  ...deviceShape.setup.examParameterSnapshot,
  root:{$type:"ExamParameterModel",fields:{
   "_turnTargetStatusParameterTypeList":{$type:"List`1",count:1,
    elements:[{$type:"ProduceParameterType",fields:{value__:1}}]},
  }},
 }},
};
const masterDraw=normalizeNativeContestSetup(masterDrawSession,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],
  itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(masterDraw.available,true,JSON.stringify(masterDraw.reasons));
assert.equal(masterDraw.input.initialParameters.drawPerTurn,3);
assert.equal(masterDraw.candidates.drawPerTurnProvenance,"exact-exam-setting-master");
const masterDrawMissing=normalizeNativeContestSetup(masterDrawSession,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1"}],
  itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(masterDrawMissing.available,false);
assert.ok(masterDrawMissing.reasons.includes("exact-initial-parameters-missing"));
// A native array containing nulls is an incomplete capture, not a legal
// turn distribution. The adapter must fail closed instead of shifting turns.
const truncatedTurns={
 ...masterDrawSession,
 setup:{...masterDrawSession.setup,examParameterSnapshot:{
  ...masterDrawSession.setup.examParameterSnapshot,root:{$type:"ExamParameterModel",fields:{
   "_turnTargetStatusParameterTypeList":{$type:"List`1",count:2,
    elements:[{$type:"ProduceParameterType",fields:{value__:1}},null]},
  }},
 }},
};
const truncatedResult=normalizeNativeContestSetup(truncatedTurns,{
 examItemCatalogs:{examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],
  itemById:new Map(),itemEffectById:new Map()},
});
assert.equal(truncatedResult.available,false);
assert.ok(truncatedResult.reasons.includes("exact-initial-parameters-missing"));
assert.equal(truncatedResult.candidates.rawTurnTargetsDecoded,1);

// Nine observed v1.5.23 contest seeds: all 90 base-turn attributes and
// nine post-SetUpExam RNG states were independently reproduced.
const seedTurnVectors=[
 [437227396,10,178,312,401,[3,2,2,3,3,3,1,1,2,3]],
 [240264658,10,178,312,401,[3,3,2,3,3,2,1,1,2,3]],
 [1038966591,10,178,312,401,[3,3,1,2,3,3,2,1,2,3]],
 [1171610728,12,178,312,401,[3,3,3,3,2,2,1,3,2,1,2,3]],
 [509769912,12,178,312,401,[3,3,3,2,3,3,1,2,2,1,2,3]],
 [690258658,12,178,312,401,[3,2,3,3,1,2,3,3,2,1,2,3]],
 [1220720477,8,401,312,178,[1,3,2,1,1,3,2,1]],
 [1749525210,8,401,312,178,[1,1,1,2,3,3,2,1]],
 [1047967221,8,401,312,178,[1,3,1,2,1,3,2,1]],
];
const enumToName={1:"vocal",2:"dance",3:"visual"};
for(const [seed,turnLimit,vocal,dance,visual,attributes] of seedTurnVectors){
 const nativeFields={
  ...masterDrawSession.start.nativeInitialState.root.fields,
  "<LimitTurn>k__BackingField":turnLimit,
  "<VocalConfigParameter>k__BackingField":vocal,
  "<DanceConfigParameter>k__BackingField":dance,
  "<VisualConfigParameter>k__BackingField":visual,
 };
 const session={
  ...masterDrawSession,
  start:{...masterDrawSession.start,seed,nativeInitialState:{
   ...masterDrawSession.start.nativeInitialState,root:{$type:"ExamData",fields:nativeFields}}},
  setup:{...masterDrawSession.setup,randomStateBeforeSetUp:null,
   randomStateObserved:advanceXorshift32(seed,turnLimit-3),
   examParameterSnapshot:{root:{$type:"ExamParameterModel",fields:{
    // Not a turn-target array. Misidentifying this is the v1.5.23 bug.
    "<ConfigParameterTypeOrderedList>k__BackingField":{$type:"List`1",count:3,
     elements:[{$type:"ValueTuple`2",fields:{Item1:{$cycle:true},Item2:401}},
               {$type:"ValueTuple`2",fields:{Item1:{$cycle:true},Item2:312}},
               {$type:"ValueTuple`2",fields:{Item1:{$cycle:true},Item2:178}}]},
   }}}},
 };
 const found=normalizeNativeContestSetup(session,{examItemCatalogs:{
  examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],
  itemById:new Map(),itemEffectById:new Map()}});
 assert.equal(found.available,true,JSON.stringify(found.reasons));
 assert.equal(found.candidates.turnParameterTypesSource,"seed-weights-verified-xorshift32");
 assert.equal(found.input.metadata.rngProvenance,"verified-seed-post-setup-hypothesis");
 assert.equal(found.input.metadata.verifiedPreShuffle,false);
 assert.equal(found.input.randomStateAtStart,advanceXorshift32(seed,turnLimit-3));
 assert.deepEqual(found.input.initialParameters.turnParameterTypes,attributes.map(a=>enumToName[a]));
 // A captured after-setup state that does not match the derivation is not
 // evidence for any particular turn scheduling algorithm.
 const bad={...session,setup:{...session.setup,randomStateObserved:0xffffffff}};
 const rejected=normalizeNativeContestSetup(bad,{examItemCatalogs:{
  examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],itemById:new Map(),itemEffectById:new Map()}});
 assert.equal(rejected.available,false);
 assert.equal(rejected.candidates.turnParameterTypesSource,null);
}
// A native thirteenth turn is not an error merely because the *base*
// turn-attribute vector contains twelve items. But it must have been granted
// by a simulated card effect; never fake an extra turn to fit the log.
const missingExtraTurnSession={...neutralSession,
 turns:[...neutralSession.turns,{turn:2,hand:[],commands:[]}]};
const noExtraReplay=replayObservedContest(missingExtraTurnSession,nativeInput,{
 cardById:neutralMasters,
});
assert.equal(noExtraReplay.extraTurnsObserved,1);
assert.equal(noExtraReplay.extraTurnsSimulated,0);
assert.equal(noExtraReplay.warnings[0].phase,"extra-turn-not-generated");
assert.equal(noExtraReplay.result,undefined);
// Actual card p_card-02-men-3_002 (私がスター) grants +1 turn.
// Verify the engine handles a real parsed master effect and the observed
// action replay accepts the resulting turn without inventing any score.
const starId="p_card-02-men-3_002";
const starDeck=[starId,"p_card-TEST-B","p_card-TEST-C"].map(id=>({id,upgradeCount:0}));
const starMasters=new Map(starDeck.map(card=>[card.id,{...card}]));
starMasters.set(starId,{...starDeck[0],name:"私がスター",
 playEffects:[
  {produceExamEffectId:"e_effect-exam_extra_turn-1"},
  {produceExamEffectId:"e_effect-exam_playable_value_add-1"},
 ]});
const starOpts={initialRandomState:44,stamina:100,turnLimit:1,drawPerTurn:3,
 turnParameterTypes:["vocal"],examRuntimeSettings:{},examScoreSettings:{}};
const starState=createTowerTurnState(starDeck,44,starMasters,starOpts);
const opening=drawTowerTurn(starState,3).hand.map(c=>({id:c.id}));
const starIndex=starState.hand.findIndex(c=>c.id===starId);
assert.ok(starIndex>=0);
playTowerCard(starState,starIndex);
assert.equal(starState.turnLimit,2);
finishTowerTurn(starState,{type:starState.playsRemaining>0?"skip":"end"});
const extraOpening=drawTowerTurn(starState,3).hand.map(c=>({id:c.id}));
assert.equal(starState.turn,2);
const starSession={start:{seed:44},complete:true,turns:[
 {turn:1,hand:opening,commands:[{commandType:2,card:{id:starId,baseUpgradeCount:0}}]},
 {turn:2,hand:extraOpening,commands:[]},
]};
const starInput={initialDeck:starDeck,pItems:[],examSettings:{},
 randomStateAtStart:44,
 initialParameters:{stamina:100,maxStamina:100,drawPerTurn:3,turnLimit:1,
 turnParameterTypes:["vocal"]}};
const starReplay=replayObservedContest(starSession,starInput,{cardById:starMasters});
assert.equal(starReplay.extraTurnsObserved,1);
assert.equal(starReplay.extraTurnsSimulated,1);
assert.equal(starReplay.warnings.length,0);
assert.equal(starReplay.turns.length,2);
assert.ok(starReplay.result);
// Native multipliers cannot separately reveal the account support bonus.
const bonusSession={...masterDrawSession,start:{...masterDrawSession.start,
 nativeInitialState:{...masterDrawSession.start.nativeInitialState,
 root:{$type:"ExamData",fields:{
  ...masterDrawSession.start.nativeInitialState.root.fields,
  "<VocalBonusPermil>k__BackingField":10680,
  "<DanceBonusPermil>k__BackingField":21690,
  "<VisualBonusPermil>k__BackingField":30380,
 }}}}};
const bonusSetup=normalizeNativeContestSetup(bonusSession,{examItemCatalogs:{
 examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],
 itemById:new Map(),itemEffectById:new Map()}});
assert.equal(bonusSetup.available,true,JSON.stringify(bonusSetup.reasons));
assert.deepEqual(bonusSetup.input.parameterBonus,{
 vocal:{bonusPermil:10680},dance:{bonusPermil:21690},visual:{bonusPermil:30380}});
assert.equal(bonusSetup.input.supportBonus.percent,null);
assert.equal(bonusSetup.input.metadata.supportBonusSeparatelyVerified,false);
const verifiedShuffle=normalizeNativeContestSetup({...bonusSession,
 setup:{...bonusSession.setup,randomStateBeforeInitialShuffle:87654321,preShuffleStateVerified:true}},
 {examItemCatalogs:{examSettings:[{id:"p_exam_setting-1",turnStartDistribute:3}],
 itemById:new Map(),itemEffectById:new Map()}});
assert.equal(verifiedShuffle.input.randomStateAtStart,87654321);
assert.equal(verifiedShuffle.input.metadata.verifiedPreShuffle,true);
assert.equal(bonusSetup.input.metadata.verifiedPreShuffle,false);
const turnReport=compareContestCapture(capture,{simulator:()=>({
 provenance:"independent-simulator",turns:[{turn:1,score:4},{turn:2,score:7}]})});
assert.equal(turnReport.sessions[0].comparison.turnDiagnostics[0].scoreDelta,-2);
console.log("contest capture comparison, setup normalization and independent action replay: OK");
