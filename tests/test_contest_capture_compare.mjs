import assert from "node:assert/strict";
import { compareContestCapture, reconstructContestCapture } from "../web/contest_capture_compare.js";

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
console.log("contest capture comparison: OK");
