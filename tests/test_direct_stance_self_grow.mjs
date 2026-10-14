import assert from 'node:assert/strict';
import {createTowerTurnState,drawTowerTurn,playTowerCard,finishTowerTurn} from '../web/tower_runtime.js';
import {EXAM_IDOL_STATUS_TYPE} from '../web/exam_score.js';
import {applyCardGrowEffectsToParsedEffect} from '../web/card_customization.js';
import {parseExamEffectId} from '../web/exam_effects.js';

// ProduceCardStatusEnchant: 踊り狂え！+
// e_trigger-exam_stance_change_concentration -> LessonAdd +2, BlockAdd +1.
// This fires on a DIRECT concentration effect, but must not retroactively
// increase the lesson / block values of the very play that triggered it.
const cardId='p_card-03-ido-3_172';
const enchantId='card_enchant-e_trigger-exam_stance_change_concentration-g_effect-lesson_add-2-g_effect-block_add-1';
const triggerId='e_trigger-exam_stance_change_concentration';
const growIds=['g_effect-lesson_add-2','g_effect-block_add-1'];
const cardEffects=['e_effect-exam_concentration-0001', 'e_effect-exam_lesson-0002-02',
  'e_effect-exam_block-0002','e_effect-exam_full_power_point-0002'];
function make(hasEnchant) {
  const card={id:cardId,name:'踊り狂え！+',upgradeCount:1,stamina:5,
    playEffects:cardEffects.map(produceExamEffectId=>({produceExamEffectId})),
    playMovePositionType:'ProduceCardMovePositionType_Grave',
    ...(hasEnchant?{produceCardStatusEnchantId:enchantId}:{})};
  const fillers=['filler-a','filler-b'].map(id=>({id,stamina:0,playEffects:[],playMovePositionType:'ProduceCardMovePositionType_Grave'}));
  const cards=[card,...fillers];
  const s=createTowerTurnState(cards,34123,new Map(cards.map(c=>[c.id,c])),{
    stamina:30,turnLimit:2,drawPerTurn:3,
    cardStatusEnchantById:new Map([[enchantId,{id:enchantId,produceExamTriggerId:triggerId,
      produceCardGrowEffectIds:growIds,triggerCount:0}]]),
    examTriggerById:new Map([[triggerId,{id:triggerId,phaseTypes:['ProduceExamPhaseType_ExamStanceChangeConcentration'],
      phaseValues:[],fieldStatusTypes:[],fieldStatusValues:[],fieldStatusCheckTypes:[],effectTypes:[]}]]),
    growEffectById:new Map([
      ['g_effect-lesson_add-2',{id:'g_effect-lesson_add-2',effectType:'ProduceCardGrowEffectType_LessonAdd',value:2}],
      ['g_effect-block_add-1',{id:'g_effect-block_add-1',effectType:'ProduceCardGrowEffectType_BlockAdd',value:1}],
    ]),
  });
  s.deck=[cardId,'filler-a','filler-b'].map(id=>s.deck.find(c=>c.id===id));
  drawTowerTurn(s,3);
  s.exam.idolStatusType=EXAM_IDOL_STATUS_TYPE.Preservation;
  s.exam.idolStatusStep=1;
  const played=s.hand.find(c=>c.id===cardId);
  const before={score:s.exam.parameter,block:s.exam.block};
  const event=playTowerCard(s,s.hand.indexOf(played));
  return {s,card:played,before,event};
}
const ordinary=make(false);
const growing=make(true);
assert.equal(growing.s.exam.parameter,ordinary.s.exam.parameter,
  'self growth must not affect the first play score');
assert.equal(growing.s.exam.block,ordinary.s.exam.block,
  'self growth must not affect the first play Block');
assert.ok(growing.event.grown?.some(e=>e.deferredUntilAfterPlay===true),
  'native stance-change trigger must register growth as deferred');
assert.equal(growing.card.runtimeGrowEffects.length,2,
  'both self growth effects persist on the actual card after its play');
const nextBlock=applyCardGrowEffectsToParsedEffect(parseExamEffectId('e_effect-exam_block-0002'),growing.card);
const baseBlock=parseExamEffectId('e_effect-exam_block-0002');
assert.equal(nextBlock.value-baseBlock.value,1,'self +1 block growth becomes available for subsequent uses');
const nextLesson=applyCardGrowEffectsToParsedEffect(parseExamEffectId('e_effect-exam_lesson-0002-02'),growing.card);
const baseLesson=parseExamEffectId('e_effect-exam_lesson-0002-02');
assert.equal(nextLesson.value-baseLesson.value,2,'self +2 lesson growth becomes available for subsequent uses');
assert.equal(ordinary.card.runtimeGrowEffects?.length??0,0);
assert.equal(growing.s.discard.find(c=>c.token===growing.card.token),growing.card,
  'growth persists after card leaves Playing');
console.log('Direct stance-change self growth is deferred until after current play: OK');
