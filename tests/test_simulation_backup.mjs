import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn, serializeTowerTurnState, useTowerDrink} from '../web/tower_runtime.js';
import {createSimulationBackup, parseSimulationBackup, stringifySimulationBackup} from '../web/simulation_backup.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/tower26-replay-masters.json',import.meta.url)));
const map=rows=>new Map(rows.map(row=>[row.id,row]));
const maps=Object.fromEntries(['examEffectById','examStatusEnchantById','examTriggerById','cardSearchById'].map(key=>[key,map(fixture[key])]));
const cards=fixture.cards.filter(c=>c.upgradeCount===0);
const basic=Array.from({length:20},(_,i)=>({id:`basic-${i}`,name:`basic-${i}`,playEffects:[],stamina:0}));
const byId=map([...cards,...basic]);
const variants=new Map(fixture.cards.map(c=>[`${c.id}@@${c.upgradeCount}`,c]));
const setup=extra=>createTowerTurnState([{id:'p_card-02-ido-3_169',upgradeCount:1},{id:'p_card-02-men-2_054'},...basic],123,byId,{...maps,cardVariantByKey:variants,stamina:43,turnLimit:16,...extra});
const norm=s=>JSON.parse(JSON.stringify(serializeTowerTurnState(s)));
// Real final-turn P-item: it must run after drawing on turns 16 and 17,
// and consume both activations without firing on any earlier turn.
{
 const s=setup({pItems:fixture.pItems.filter(item=>item.name==='頂点の輝き')});
 for(let turn=1;turn<=18;turn++){
  const events=s.simulationLog.events.length;
  drawTowerTurn(s);
  const activations=s.simulationLog.events.slice(events).filter(e=>e.effectId==='e_effect-exam_extra_turn');
  assert.equal(activations.length,turn===16||turn===17?1:0,`turn ${turn}`);
  if(activations.length){
   assert.equal(activations[0].phase,'afterStartOfTurn');
   assert.ok(s.simulationLog.events.slice(events).find(e=>e.kind==='handAdded').sequence<activations[0].sequence);
  }
  finishTowerTurn(s);
 }
 assert.equal(s.turnLimit,18);
}
// Real Tower26 purple debuffs, with the two observed skill cards. Recover
// the newest debuff before drawing turn 2; leave the other debuffs intact.
{
 const s=setup({pItems:fixture.pItems,gimmicks:fixture.gimmicks});
 drawTowerTurn(s);
 assert.equal(s.exam.review,0);assert.equal(s.turnLimit,16);assert.equal(s.hand.length,2);
 for(const id of ['p_card-02-ido-3_169','p_card-02-men-2_054'])playTowerCard(s,s.hand.findIndex(c=>c.id===id));
 assert.equal(s.exam.review,6);
 finishTowerTurn(s);assert.equal(drawTowerTurn(s).drawn.length,3);
 assert.equal(s.exam.startTurnCardDrawDown,0);assert.equal(s.exam.blockAddDown,true);
 assert.equal(s.exam.staminaConsumptionAddFix,2);assert.ok(s.exam.lessonParameterDown>0);
 const backup=createSimulationBackup(s,'tower');
 assert.equal(backup.version,2);assert.ok(!('simulationLog' in backup.checkpoint.state));
 const restored=parseSimulationBackup(stringifySimulationBackup(backup)).state;
 assert.deepEqual(norm(restored),norm(s));
 for(let turn=3;turn<=18;turn++){
  finishTowerTurn(s);finishTowerTurn(restored);drawTowerTurn(s);drawTowerTurn(restored);
  assert.deepEqual(norm(restored),norm(s));
 }
 // Old backups remain readable; their existing results are preserved.
 const legacy={...backup,version:1,checkpoint:serializeTowerTurnState(restored)};
 assert.deepEqual(norm(parseSimulationBackup(stringifySimulationBackup(legacy)).state),norm(restored));
}
// Catalog pruning must include indirect creation, all upgrade variants,
// chained effects, enchants, random pools and filtered catalog generation.
{
 const search={id:'search',produceCardRandomPoolId:'pool'};
 const grow={id:'grow'};
 const effects=[{id:'create',effectType:'ProduceExamEffectType_ExamCardCreateSearch',produceCardSearchId:'search',effectCount:1,pickCountMin:1,pickCountMax:1,movePositionType:'ProduceCardMovePositionType_DeckFirst'},
  {id:'enchant',effectType:'ProduceExamEffectType_ExamStatusEnchant',produceExamStatusEnchantId:'ench'},
  {id:'draw',effectType:'ProduceExamEffectType_ExamCardDraw',effectCount:1}];
 const generated={id:'generated',playEffects:[{produceExamEffectId:'enchant'}]};
 const start={id:'start',playEffects:[{produceExamEffectId:'create'}]};
 const unused={id:'unused'};
 const s=createTowerTurnState([start],123,map([start,generated,unused]),{stamina:20,examEffectById:map(effects),
  cardVariantByKey:new Map([['generated@@1',{...generated,upgradeCount:1,customGrowEffectIds:['grow']}]]),growEffectById:map([grow]),
  cardSearchById:map([search]),cardRandomPoolById:new Map([['pool',[{produceCardId:'generated',upgradeCount:0,ratio:1}]]]),
  examStatusEnchantById:map([{id:'ench',produceExamEffectIds:['draw'],produceExamTriggerId:'trigger'}]),
  examTriggerById:map([{id:'trigger',phaseTypes:['ProduceExamPhaseType_ExamStartTurn']}])});
 drawTowerTurn(s);
 const backup=createSimulationBackup(s,'tower');
 const restored=parseSimulationBackup(stringifySimulationBackup(backup)).state;
 assert.deepEqual([...restored.cardById.keys()],['start','generated']);
 assert.ok(restored.cardVariantByKey.has('generated@@1'));assert.ok(restored.growEffectById.has('grow'));
 assert.ok(restored.examTriggerById.has('trigger'));assert.ok(restored.examEffectById.has('draw'));
 playTowerCard(s,0);playTowerCard(restored,0);assert.deepEqual(norm(restored),norm(s));
 // A search without a pool generates from the filtered card catalog. Preserve
 // every eligible candidate in its original order, even if not yet generated.
 const fullSearch={id:'all-mental',cardCategories:['ProduceCardCategory_MentalSkill']};
 const gen={...effects[0],id:'all-create',produceCardSearchId:fullSearch.id};
 s.cardSearchById.set(fullSearch.id,fullSearch);s.examEffectById.set(gen.id,gen);
 s.deck[0].playEffects=[{produceExamEffectId:gen.id}];
 s.cardById.set('eligible',{id:'eligible',category:'ProduceCardCategory_MentalSkill'});
 const all=parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(s,'tower'))).state;
 assert.ok(all.cardById.has('eligible'));assert.ok(!all.cardById.has('unused'));
}
console.log('Tower26 draw/recovery, final-turn P-item, compact/v1 backups and future master dependency closure: ok');
