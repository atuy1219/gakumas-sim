import assert from 'node:assert/strict';
import {createTowerTurnState, drawTowerTurn, finishTowerTurn} from '../web/tower_runtime.js';
import {
  addNativeScalarTimedStatus, addNativeGenericTimedStatus, addNativeScoreTimedStatus,
  markNativeStatusTurnStart, tickNativeScoreTimedStatuses, trySetExamStance,
} from '../web/exam_effects.js';
import {EXAM_IDOL_STATUS_TYPE} from '../web/exam_score.js';
import {createSimulationBackup, stringifySimulationBackup, parseSimulationBackup} from '../web/simulation_backup.js';

const make = () => {
  const deck=Array.from({length:18},(_,i)=>({id:'basic-'+i,stamina:0,playEffects:[]}));
  return createTowerTurnState(deck,123,new Map(deck.map(c=>[c.id,c])),{
    stamina:40,turnLimit:6,examRuntimeSettings:{preservationReleaseEnthusiastic1:5},
  });
};
function grantRelease(s) {
  s.exam.idolStatusType=EXAM_IDOL_STATUS_TYPE.Preservation;
  s.exam.idolStatusStep=1;
  return trySetExamStance(s.exam,EXAM_IDOL_STATUS_TYPE.Concentration,1);
}
function checkpoint(state) {
  return parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(state,'tower'))).state;
}
// ELF: EnthusiasticStatusEffect is Turn=1, _isTurnLimited=1. A new
// status granted during a turn has its passage flag already set by its
// constructor; it must spend at the end of THAT turn.
{
 const s=make();drawTowerTurn(s);assert.equal(grantRelease(s).releasedPreservation,true);
 assert.equal(s.exam.enthusiastic,5);
 assert.deepEqual(s.exam.scalarTimedStatuses.map(x=>[x.value,x.turn,x.isTurnLimited,x.isPassingTurnStart]),[[5,1,true,true]]);
 const restored=checkpoint(s);
 for(const branch of [s,restored]) {
   finishTowerTurn(branch);
   assert.equal(branch.exam.enthusiastic,0,'one-turn enthusiasm expires at the grant turn end');
   assert.equal(branch.exam.scalarTimedStatuses.length,0);
   drawTowerTurn(branch);
   assert.equal(branch.exam.enthusiastic,0);
 }
}
// Multiple turns and unlimited: do not hard-code enthusiasm=0 at every end.
{
 const s=make();drawTowerTurn(s);
 addNativeScalarTimedStatus(s.exam,'enthusiastic',12,3);
 addNativeGenericTimedStatus(s.exam,'enthusiasticAdditivePermil',4,2);
 addNativeScoreTimedStatus(s.exam,'reviewMultiple',500,2);
 finishTowerTurn(s);
 assert.equal(s.exam.enthusiastic,12);assert.equal(s.exam.scalarTimedStatuses[0].turn,2);
 for(let remaining=1;remaining>=0;remaining--) {
   drawTowerTurn(s);finishTowerTurn(s);
   assert.equal(s.exam.scalarTimedStatuses[0]?.turn??0,remaining);
   assert.equal(s.exam.enthusiastic,remaining>0?12:0);
 }
 assert.equal(s.exam.enthusiasticAdditivePermil,0);
 assert.equal(s.exam.reviewMultiple,1);
}
// Stacking value in native TryAddEnthusiasticStatus does not extend Turn.
{
 const s=make();drawTowerTurn(s);addNativeScalarTimedStatus(s.exam,'enthusiastic',4,2);
 finishTowerTurn(s);drawTowerTurn(s);
 addNativeScalarTimedStatus(s.exam,'enthusiastic',5,9);
 assert.equal(s.exam.enthusiastic,9);
 assert.equal(s.exam.scalarTimedStatuses[0].turn,1,'regrant preserves original expiry');
 finishTowerTurn(s);assert.equal(s.exam.enthusiastic,0);
}
// Unlimited effects and independently timed parallel statuses.
{
 const s=make();drawTowerTurn(s);
 addNativeScalarTimedStatus(s.exam,'enthusiastic',8,-1);
 addNativeGenericTimedStatus(s.exam,'lessonDebuff',2,-1);
 addNativeScoreTimedStatus(s.exam,'reviewMultiple',800,-1);
 for(let i=0;i<4;i++) {finishTowerTurn(s);drawTowerTurn(s)}
 assert.equal(s.exam.enthusiastic,8);
 assert.equal(s.exam.scalarTimedStatuses[0].turn,-1);
 assert.equal(s.exam.lessonDebuff,2);
 assert.ok(Math.abs(s.exam.reviewMultiple-1.8)<1e-6);
}
// Direct helper model: MarkPassingTurnStart and SpendTurn must handle each
// instance's turn independently without resetting other status effects.
{
 const s=make(); const e=s.exam;
 addNativeScalarTimedStatus(e,'enthusiastic',2,2); e.turnLifetimeEnabled=true;
 tickNativeScoreTimedStatuses(e);assert.equal(e.enthusiastic,2);
 assert.equal(e.scalarTimedStatuses[0].turn,1);
 markNativeStatusTurnStart(e);tickNativeScoreTimedStatuses(e);assert.equal(e.enthusiastic,0);
}
console.log('ELF SpendTurn scalar, generic, score, stacking, infinite, serialization: ok');
