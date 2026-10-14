import assert from 'node:assert/strict';
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from '../web/tower_runtime.js';

// ELF StaminaReduceEffectExecutor.ExecuteEffect @ 0x80643D4:
// +800 permille of maxStamina=39 reduces 39 -> 8, not a flat 800.
// StaminaReduceFix remains a fixed-value reduction.
const cards = ['one', 'two', 'three'].map(id => ({id, stamina:0, playMovePositionType:'ProduceCardMovePositionType_Grave'}));
const cardById = new Map(cards.map(c=>[c.id,c]));
const createReduction = (type,value) => {
  const pitem = {id: 'pitem-start-reduce',effects:[{
    id:'item-effect', effectType:'ProduceItemEffectType_ExamStatusEnchant', effectTurn:-1,effectCount:1,
    examStatusEnchant:{id:'start-reduction',trigger:{id:'trigger-start-exam',phaseTypes:['ProduceExamPhaseType_ExamStartExam']},
      examEffects:[{id:'stamina-reduction',effectType:type,effectValue1:value}]},
  }]};
  const s = createTowerTurnState(cards,1234,cardById,{stamina:39,turnLimit:2,drawPerTurn:3,pItems:[pitem]});
  drawTowerTurn(s,3);
  return s;
};
const ratio = createReduction('ProduceExamEffectType_ExamStaminaReduce',800);
assert.equal(ratio.exam.stamina,8,'800 permille of max 39 leaves 8 stamina');
assert.equal(createReduction('ProduceExamEffectType_ExamStaminaReduceFix',8).exam.stamina,31,
  'ReduceFix must subtract a flat 8');

// A DeckAll grow must not alter the lesson being scored now; it must be
// preserved on the very same card object for the next time it is played.
const growId='e_effect-grow-test';
const lessonId='e_effect-lesson-test';
const growMaster={id:growId,effectType:'ProduceExamEffectType_ExamAddGrowEffect',
  produceCardSearchId:'search-deck-all',pickRangeType:'ProducePickRangeType_All',
  produceCardGrowEffectIds:['g_effect-lesson_add-10']};
const lessonMaster={id:lessonId,effectType:'ProduceExamEffectType_ExamLesson',effectValue1:20};
const growCard={id:'replay-star',stamina:0,category:'ProduceCardCategory_ActiveSkill',
  playMovePositionType:'ProduceCardMovePositionType_Grave',playEffects:[{produceExamEffectId:growId},{produceExamEffectId:lessonId}]};
const fillers=['filler-a','filler-b'].map(id=>({id,stamina:0,category:'ProduceCardCategory_MentalSkill',
  playMovePositionType:'ProduceCardMovePositionType_Grave'}));
const deck=[growCard,...fillers];
const s=createTowerTurnState(deck,77,new Map(deck.map(x=>[x.id,x])),{
  stamina:39,turnLimit:3,drawPerTurn:3,
  examEffectById:new Map([[growId,growMaster],[lessonId,lessonMaster]]),
  cardSearchById:new Map([['search-deck-all',{id:'search-deck-all',cardPositionType:'ProduceCardPositionType_DeckAll',
      cardCategories:['ProduceCardCategory_ActiveSkill']}]]),
  growEffectById:new Map([['g_effect-lesson_add-10',{
    id:'g_effect-lesson_add-10',effectType:'ProduceCardGrowEffectType_LessonAdd',value:10,
  }]]),
});
s.deck=[...deck].map(x=>s.deck.find(c=>c.id===x.id));
drawTowerTurn(s,3);
const card=s.hand.find(c=>c.id==='replay-star');
assert.ok(card);
const before=s.exam.parameter;
const action=playTowerCard(s,s.hand.indexOf(card));
assert.equal(s.exam.parameter-before,20,'in-flight growth cannot affect the same lesson');
assert.equal(card.runtimeGrowEffects.filter(x=>x.id==='g_effect-lesson_add-10').length,1,
  'the original card must receive deferred growth exactly once');
assert.equal(s.discard.find(c=>c.id==='replay-star'),card,'identity persists in graveyard');
finishTowerTurn(s);
s.deck=[];
drawTowerTurn(s,3);
const nextCard=s.hand.find(c=>c.id==='replay-star');
assert.equal(nextCard?.token,card.token,'logical card identity persists after recycling');
assert.equal(nextCard.runtimeGrowEffects.length,1,'growth survives the recycle');
const old=s.exam.parameter;
playTowerCard(s,s.hand.indexOf(nextCard));
assert.equal(s.exam.parameter-old,30,'previous growth affects the next lesson');
assert.equal(nextCard.runtimeGrowEffects.filter(x=>x.id==='g_effect-lesson_add-10').length,2,
  'growth granted by each use persists on the card');
console.log('ELF stamina ratio, fixed cost, deferred DeckAll growth, next play: OK');
