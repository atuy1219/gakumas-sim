import assert from 'node:assert/strict';
import { createExamState, trySetExamStance } from '../web/exam_effects.js';
import { EXAM_IDOL_STATUS_TYPE as STANCE } from '../web/exam_score.js';
import { createTowerTurnState, drawTowerTurn, playTowerCard } from '../web/tower_runtime.js';

// ELF ExamEffectUtility.TryInternalSetStance @ 0x8036F64:
// leaving Preservation calls AddBlockFix @ 0x8035098 *before* setting the
// new stance; release rewards are dependent on the old stance and step.
const variants = [
  { from: STANCE.Preservation, level: 1, to: STANCE.Concentration, block: 0, enthusiasm: 5, plays: 1 },
  { from: STANCE.Preservation, level: 2, to: STANCE.Concentration, block: 5, enthusiasm: 8, plays: 1 },
  { from: STANCE.Preservation, level: 2, to: STANCE.Unknown, block: 5, enthusiasm: 8, plays: 1 },
  { from: STANCE.OverPreservation, level: 1, to: STANCE.Concentration, block: 5, enthusiasm: 10, plays: 1 },
  { from: STANCE.OverPreservation, level: 1, to: STANCE.FullPower, block: 5, enthusiasm: 10, plays: 2 },
  { from: STANCE.Concentration, level: 2, to: STANCE.Preservation, block: 0, enthusiasm: 0, plays: 0 },
  { from: STANCE.Preservation, level: 1, to: STANCE.Preservation, block: 0, enthusiasm: 0, plays: 0 },
];
for (const test of variants) {
  const e = createExamState();
  e.idolStatusType = test.from;
  e.idolStatusStep = test.level;
  e.blockRestriction = true; // AddBlockFix is separate from ordinary Block.
  const outcome = trySetExamStance(e, test.to, 1);
  assert.equal(outcome.changed,true, JSON.stringify(test));
  assert.equal(e.block,test.block,JSON.stringify(test));
  assert.equal(e.enthusiastic,test.enthusiasm,JSON.stringify(test));
  assert.equal(outcome.releasedBlockAdd,test.block,JSON.stringify(test));
  assert.equal(outcome.releasedEnthusiasticAdd,test.enthusiasm,JSON.stringify(test));
  assert.equal(outcome.playableValueAdd,test.plays,JSON.stringify(test));
}
// The full-power lock and same-stance max-step guard do not grant release.
{
 const e=createExamState();e.idolStatusType=STANCE.FullPower;e.idolStatusStep=1;
 assert.equal(trySetExamStance(e,STANCE.Preservation,1).changed,false);
 assert.equal(e.block,0);
 e.idolStatusType=STANCE.Preservation;e.idolStatusStep=2;
 assert.equal(trySetExamStance(e,STANCE.Preservation,1).changed,false);
 assert.equal(e.block,0);
}
// Integration: leaving Preservation(2) via a played Concentration card gives
// fixed +5 Block independently of the card's ordinary effects. The display
// must identify this release reward rather than claiming the card gave Block.
{
 const cards=[
  {id:'into-strong', stamina:0,playMovePositionType:'ProduceCardMovePositionType_Grave',
   playEffects:[{produceExamEffectId:'strong-effect'}]},
  {id:'filler-a', stamina:0}, {id:'filler-b', stamina:0},
 ];
 const masters=new Map(cards.map(c=>[c.id,c]));
 const s=createTowerTurnState(cards,1234,masters,{
  stamina:30,turnLimit:2,drawPerTurn:3,
  examEffectById:new Map([['strong-effect',{
    id:'strong-effect',effectType:'ProduceExamEffectType_ExamConcentration',effectValue1:1,
  }]]),
 });
 s.exam.idolStatusType=STANCE.Preservation;
 s.exam.idolStatusStep=2;
 s.exam.blockRestriction=true;
 drawTowerTurn(s,3);
 const event=playTowerCard(s,s.hand.findIndex(c=>c.id==='into-strong'));
 assert.equal(s.exam.idolStatusType,STANCE.Concentration);
 assert.equal(s.exam.block,5);
 assert.ok(event.effects.includes('温存解除・固定元気 +5'));
 assert.ok(event.effects.includes('温存解除・熱意 +8'));
}
console.log('Native stance transitions, release rewards and logging: OK');
