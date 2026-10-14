import assert from 'node:assert/strict';
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as executors } from '../web/tower_runtime.js';
import { createExamState, addNativeGenericTimedStatus, markNativeStatusTurnStart, tickNativeScoreTimedStatuses } from '../web/exam_effects.js';
import { calculateNativeAddingParameter } from '../web/exam_score.js';
const event = () => ({ effects: [], moved: [] });
const make = () => { const s=createTowerTurnState([{id:'dummy',stamina:0,playEffects:[]}],123,new Map(),{stamina:30,turnLimit:5}); s.deck.splice(0); return s; };
// ELF ShuffleDeck*: 2-card Deck + 2-card secondary pool, seed whose first
// permutation keeps both Deck cards. Two passes consume 6 RNG words.
for (const [type, pool] of [['ExamCardShuffleDeckGrave', 'discard'], ['ExamCardShuffleDeckLost', 'lost']]) {
  const s = make(), e = event();
  const cards = [...'ABCD'].map(token => ({ token, id: token }));
  s.deck.push(...cards.slice(0,2)); s[pool].push(...cards.slice(2)); s.randomState = 3601345174;
  executors[type].ExecuteEffect({ state: s, event: e });
  assert.deepEqual(s.deck.map(c => c.token), ['A','C']);
  assert.deepEqual(s[pool].map(c => c.token), ['D','B']);
  assert.equal(s.randomState, 3492243874);
  assert.equal(new Set([...s.deck,...s[pool]]).size,4, 'card objects are preserved');
  assert.equal(e.moved.length, 2);
  s[pool].splice(0); const before = s.randomState;
  executors[type].ExecuteEffect({ state: s, event: event() });
  assert.equal(s.randomState,before,'empty pool returns before RNG');
}
// ClearDebuff targets every Debuff row, leaving positive statuses intact.
{
  const s=make(), e=event();
  addNativeGenericTimedStatus(s.exam,'panic',1,3,'duration');
  addNativeGenericTimedStatus(s.exam,'blockRestriction',1,2,'duration');
  addNativeGenericTimedStatus(s.exam,'staminaRecoverAdd',4,-1);
  s.exam.staminaConsumptionAdd=3; s.exam.staminaConsumptionAddFix=2;
  s.searchPlayCardLimits.push({turn:2});
  executors.ExamClearDebuff.ExecuteEffect({state:s,event:e});
  assert.equal(s.exam.panic,false); assert.equal(s.exam.blockRestriction,false);
  assert.equal(s.exam.staminaConsumptionAdd,0); assert.equal(s.exam.staminaConsumptionAddFix,0);
  assert.equal(s.searchPlayCardLimits.length,0); assert.equal(s.exam.staminaRecoverAdd,4);
}
// Inclusive thresholds, native sort direction and MoreThan -> LessThan order.
{
  const exam=createExamState(), e=event();
  const add=(type,v1,v2,turn=2)=>executors[type].ExecuteEffect({exam,v1,v2,turn,event:e});
  add('ExamLessonChangeSpecifyMoreThan',8,10);
  add('ExamLessonChangeSpecifyMoreThan',7,10);
  assert.equal(calculateNativeAddingParameter(exam,9),9);
  assert.equal(calculateNativeAddingParameter(exam,10),7);
  add('ExamLessonChangeSpecifyLessThan',20,7);
  add('ExamLessonChangeSpecifyLessThan',30,7);
  assert.equal(calculateNativeAddingParameter(exam,10),30, 'LessThan sees replaced base 7');
  assert.equal(calculateNativeAddingParameter(exam,8),8);
  add('ExamLessonChangeSpecifyLessThan',30,7,3);
  assert.equal(exam.genericTimedStatuses.length,4,'same pair extends lifetime');
  markNativeStatusTurnStart(exam);
  tickNativeScoreTimedStatuses(exam); tickNativeScoreTimedStatuses(exam); tickNativeScoreTimedStatuses(exam);
  assert.equal(calculateNativeAddingParameter(exam,10),10,'expired overrides stop applying');
}
// EndTurnTimer uses status TurnCount (grant turn = 0), not StartTurn delay.
{
  const s=make(); drawTowerTurn(s,1);
  s.examEffectById.set('child',{id:'child',effectType:'ProduceExamEffectType_ExamReview',effectValue1:5});
  executors.ExamEffectTimerEndTurn.ExecuteEffect({state:s,parsed:{id:'timer',chainEffectId:'child'},v1:1,event:event()});
  finishTowerTurn(s,{type:'end'}); assert.equal(s.exam.review,0);
  drawTowerTurn(s,1); assert.equal(s.exam.review,0,'start of turn does not fire end timer');
  finishTowerTurn(s,{type:'end'}); assert.equal(s.exam.review,5);
  assert.equal(s.effectScheduler.registrations.filter(r=>r.active).length,0,'one activation');
  drawTowerTurn(s,1); finishTowerTurn(s,{type:'end'});
  assert.ok(s.exam.review<=5,'timer does not fire twice');
}
// Growth bonus is applied once at acquisition (ceil float32), and does
// not multiply existing growth or Block growth. Deferred self growth keeps
// the multiplier from the acquisition boundary, even after status expiry.
{
  const grow={id:'grow',effectType:'ProduceCardGrowEffectType_LessonAdd',value:3};
  const card={id:'card',stamina:0,playEffects:[{produceExamEffectId:'growth'}]};
  const s=createTowerTurnState([card],123,new Map([['card',card]]),{stamina:30,turnLimit:3,growEffectById:new Map([['grow',grow]])});
  s.examEffectById.set('growth',{id:'growth',effectType:'ProduceExamEffectType_ExamAddGrowEffect',produceCardGrowEffectIds:['grow'],produceCardSearchId:'all'});
  s.cardSearchById.set('all',{id:'all',cardPositionType:'ProduceCardPositionType_DeckAll'});
  drawTowerTurn(s,1);
  executors.ExamGrowEffectLessonAddAdditive.ExecuteEffect({exam:s.exam,v1:500,turn:1,event:event()});
  assert.equal(s.exam.growEffectLessonAddAdditiveMultiple,1.5);
  playTowerCard(s,0);
  const owned=[...s.deck,...s.hand,...s.discard,...s.lost].find(c=>c.id==='card');
  assert.equal(owned.runtimeGrowEffects[0].value,5);
  assert.equal(grow.value,3,'master growth is never mutated');
}
console.log('ELF pool shuffle, debuff clearing, threshold override, end-turn timer and growth acquisition: OK');
