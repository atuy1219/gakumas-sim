import assert from 'node:assert/strict';
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard,
  serializeTowerTurnState, restoreTowerTurnState, resolveTowerBuffCostCard,
  NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES as executors } from '../web/tower_runtime.js';
import { calculateNativeBuffCost } from '../web/exam_effects.js';
const e=()=>({effects:[],moved:[],grown:[],drawn:[],recycleEvents:[]});
const cards=Array.from({length:16},(_,i)=>({id:'c'+i,category:i%2?'ProduceCardCategory_MentalSkill':'ProduceCardCategory_ActiveSkill',stamina:0,playEffects:[]}));
const make=()=>createTowerTurnState(cards,123,new Map(cards.map(c=>[c.id,c])),{stamina:30,turnLimit:5});
const master=(id,type,v1=0,extra={})=>({id,effectType:'ProduceExamEffectType_'+type,effectValue1:v1,...extra});
const grant=(s,type,v1,count,turn,searchId='active')=>executors[type].ExecuteEffect({state:s,exam:s.exam,parsed:{id:type,searchId,limitCount:count},v1,turn,event:e()});
const searches=s=>{
 s.cardSearchById.set('active',{id:'active',cardPositionType:'ProduceCardPositionType_Hand',cardCategories:['ProduceCardCategory_ActiveSkill']});
 s.cardSearchById.set('mental',{id:'mental',cardPositionType:'ProduceCardPositionType_Hand',cardCategories:['ProduceCardCategory_MentalSkill']});
};
// Native insert stack: siblings execute after inserted descendants; nested
// inserts are LIFO. Use non-commutative state changes to check the order.
{
 const s=make();drawTowerTurn(s,3);
 s.examEffectById.set('add',master('add','ExamLessonBuff',2));
 s.examEffectById.set('reduce',master('reduce','ExamLessonBuffReduce',1));
 s.examEffectById.set('nested',master('nested','ExamChainEffect',2,{chainProduceExamEffectId:'add'}));
 executors.ExamChainEffect.ExecuteEffect({state:s,parsed:{id:'outer',chainEffectIds:['reduce','nested']},v1:1,event:e()});
 assert.equal(s.exam.lessonBuff,3,'nested +2,+2 before -1');
 for(const [type,expected] of [['ExamChainEffect',3],['ExamChainEffectPerPassedTurn',3],['ExamChainEffectPerRemainTurn',3]]) {
  s.turn=3;s.turnOpen=true;s.turnLimit=5;s.exam.lessonBuff=0;
  executors[type].ExecuteEffect({state:s,parsed:{id:type,chainEffectId:'add'},v1:3,event:e()});
  assert.equal(s.exam.lessonBuff,expected*2,type);
 }
 const card=s.hand[0];card.playEffects=[{produceExamEffectId:'nested'},{produceExamEffectId:'score'}];
 s.examEffectById.set('score',master('score','ExamLesson',1,{effectCount:1}));
 s.exam.lessonBuff=0;
 playTowerCard(s,0);
 assert.equal(s.exam.parameter,5,'inserted chain runs before next score command');
 assert.equal(s.unsupported.length,0);
}
// Buff-cost replacement consumes ONE matching status, choosing the shortest
// finite lifetime. Affordability uses the replacement plus native multipliers.
{
 const s=make();searches(s);drawTowerTurn(s,10);
 const index=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 s.hand[index].costType='ExamCostType_ExamReview';s.hand[index].costValue=9;s.exam.review=20;
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',4,2,-1);
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',2,1,2);
 const snapshot=s.searchCardBuffCostChanges.map(x=>({...x}));
 assert.equal(resolveTowerBuffCostCard(s,s.hand[index]).temporaryBuffConsumptionFix,2);
 assert.deepEqual(s.searchCardBuffCostChanges,snapshot,'preview does not consume');
 playTowerCard(s,index);assert.equal(s.exam.review,18);
 assert.equal(s.searchCardBuffCostChanges.length,1);
 assert.equal(s.searchCardBuffCostChanges[0].count,2,'unselected status is untouched');
 finishTowerTurn(s,{type:'end'});drawTowerTurn(s,10);
 const next=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 s.hand[next].costType='ExamCostType_ExamReview';s.hand[next].costValue=9;
 playTowerCard(s,next);assert.equal(s.exam.review,14,'replacement -4 after prior -2');
 assert.equal(s.searchCardBuffCostChanges[0].count,1);
 const shared=Object.fromEntries(['cardById','examEffectById','cardSearchById'].map(k=>[k,s[k]]));
 const restored=restoreTowerTurnState(serializeTowerTurnState(s),shared);
 assert.deepEqual(restored.searchCardBuffCostChanges,s.searchCardBuffCostChanges);
}
{
 const s=make();searches(s);drawTowerTurn(s,10);
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',0,1,-1);
 const i=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 s.hand[i].costType='ExamCostType_ExamReview';s.hand[i].costValue=9;s.exam.review=0;
 playTowerCard(s,i);assert.equal(s.exam.review,0,'zero replacement permits otherwise unaffordable card');
 assert.equal(s.searchCardBuffCostChanges.length,0);
}
// Total count and per-turn count are independent. Restrictions apply while
// the first native row exists; qualifying completion restores one play.
{
 const s=make();searches(s);drawTowerTurn(s,10);
 grant(s,'ExamPlayCardLimitPlayableValueAdd',1,2,-1);
 const mental=s.hand.findIndex(c=>c.category.endsWith('MentalSkill'));
 assert.throws(()=>playTowerCard(s,mental),/対象カード/);
 let active=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 playTowerCard(s,active);assert.equal(s.playsRemaining,1);
 assert.equal(s.conditionalPlayableStatuses[0].count,1);
 active=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 playTowerCard(s,active);assert.equal(s.playsRemaining,0,'per-turn limit prevents another refund');
 finishTowerTurn(s,{type:'end'});drawTowerTurn(s,10);
 active=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 playTowerCard(s,active);assert.equal(s.playsRemaining,1);
 assert.equal(s.conditionalPlayableStatuses.length,0,'total count reached zero');
 const restored=restoreTowerTurnState(serializeTowerTurnState(s),{cardById:s.cardById,cardSearchById:s.cardSearchById});
 assert.deepEqual(restored.conditionalPlayableStatuses,[]);
}
// Move growth: receivers use Search1, donors Search2. Copy ORIGINAL growth
// at Value1 permil, reduce donor at Value2 permil, each rounded independently.
// Runtime LessonAdd multiplier is bypassed for transferred growth.
{
 const donor={id:'donor',stamina:4,playEffects:[]},receiver={id:'receiver',stamina:4,playEffects:[]};
 const s=createTowerTurnState([donor,receiver],123,new Map([['donor',donor],['receiver',receiver]]),{stamina:30,turnLimit:3});
 const d=s.deck.find(c=>c.id==='donor'),r=s.deck.find(c=>c.id==='receiver');
 d.runtimeGrowEffects=[{id:'g1',effectType:'ProduceCardGrowEffectType_LessonAdd',value:1},{id:'g2',effectType:'ProduceCardGrowEffectType_LessonAdd',value:2},{id:'gc',effectType:'ProduceCardGrowEffectType_CostReduce',value:2}];
 d.customGrowEffects=d.runtimeGrowEffects.map(x=>({...x}));d.stamina=2;
 s.cardSearchById.set('donors',{id:'donors',cardPositionType:'ProduceCardPositionType_Deck',produceCardIds:['donor']});
 s.cardSearchById.set('receivers',{id:'receivers',cardPositionType:'ProduceCardPositionType_Deck',produceCardIds:['receiver']});
 s.exam.growEffectLessonAddAdditiveMultiple=2;
 const parsed={id:'move',searchId:'receivers',searchId2:'donors',pickRangeType:'ProduceCardPickRangeType_All',pickCountType:'ProduceCardPickCountType_All',pickRangeType2:'ProduceCardPickRangeType_All',pickCountType2:'ProduceCardPickCountType_All'};
 executors.ExamMoveGrowEffect.ExecuteEffect({state:s,parsed,v1:500,v2:500,event:e()});
 assert.deepEqual(d.runtimeGrowEffects.map(x=>[x.effectType,x.value]),[['ProduceCardGrowEffectType_LessonAdd',1],['ProduceCardGrowEffectType_CostReduce',1]]);
 assert.deepEqual(r.runtimeGrowEffects.map(x=>[x.effectType,x.value]),[['ProduceCardGrowEffectType_LessonAdd',2],['ProduceCardGrowEffectType_CostReduce',1]]);
 assert.equal(d.stamina,3);assert.equal(r.stamina,3);
 const before=JSON.stringify(d.runtimeGrowEffects);
 s.deck.splice(s.deck.indexOf(r),1);
 executors.ExamMoveGrowEffect.ExecuteEffect({state:s,parsed,v1:1000,v2:1000,event:e()});
 assert.equal(JSON.stringify(d.runtimeGrowEffects),before,'no receivers = donor unchanged');
}
// Exact lifetimes and negative sentinels: unlimited count is not spent;
// status acquired mid-turn does not age until the next StartPlay boundary.
{
 const s=make();searches(s);drawTowerTurn(s,10);
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',0,-1,1);
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',0,2,1);
 assert.equal(s.searchCardBuffCostChanges.length,1,'same search/value/Turn merge');
 assert.equal(s.searchCardBuffCostChanges[0].count,1,'native signed count sum');
 finishTowerTurn(s,{type:'end'});
 assert.equal(s.searchCardBuffCostChanges[0].turn,1,'grant turn not spent');
 drawTowerTurn(s,10);finishTowerTurn(s,{type:'end'});
 assert.equal(s.searchCardBuffCostChanges.length,0,'next passed turn expires');
}
{
 const s=make();searches(s);drawTowerTurn(s,10);
 grant(s,'ExamSearchPlayCardBuffConsumptionChange',-1,1,-1);
 const i=s.hand.findIndex(c=>c.category.endsWith('ActiveSkill'));
 s.hand[i].costType='ExamCostType_ExamReview';s.hand[i].costValue=3;s.exam.review=20;
 playTowerCard(s,i);assert.equal(s.exam.review,17,'-1 sentinel uses original cost');
 assert.equal(s.searchCardBuffCostChanges.length,0,'sentinel still spends one use');
}
// Cycles fail explicitly and the transient command stack is cleaned up.
{
 const s=make();s.examEffectById.set('cycle',master('cycle','ExamChainEffect',1,{chainProduceExamEffectId:'cycle'}));
 assert.throws(()=>executors.ExamChainEffect.ExecuteEffect({state:s,parsed:{id:'root',chainEffectId:'cycle'},v1:1,event:e()}),/循環/);
 s.examEffectById.set('valid',master('valid','ExamReview',2));
 executors.ExamChainEffect.ExecuteEffect({state:s,parsed:{id:'root',chainEffectId:'valid'},v1:1,event:e()});
 assert.equal(s.exam.review,2,'a prior failure leaves no pending command');
}

// Reference-count selectors derive their bounds before card selection.
{
 const s=make();const donor=s.deck[0],receiver=s.deck[1];
 donor.runtimeGrowEffects=[{id:'growth',effectType:'ProduceCardGrowEffectType_LessonAdd',value:3}];
 donor.customGrowEffects=donor.runtimeGrowEffects.map(x=>({...x}));
 for(const [id,card] of [['donors',donor],['receivers',receiver]]) s.cardSearchById.set(id,{id,cardPositionType:'ProduceCardPositionType_Deck',produceCardIds:[card.id]});
 const parsed={id:'reference-move',searchId:'receivers',searchId2:'donors',
   pickRangeType:'ProduceCardPickRangeType_Select',pickCountType:'ProducePickCountType_Shortage',pickCountMin:2,pickCountMax:2,pickCountReferenceSearchId:'donors',
   pickRangeType2:'ProduceCardPickRangeType_All',pickCountType2:'ProducePickCountType_Normal'};
 executors.ExamMoveGrowEffect.ExecuteEffect({state:s,parsed,v1:1000,v2:1000,event:e()});
 assert.equal(donor.runtimeGrowEffects.length,0);
 assert.equal(receiver.runtimeGrowEffects[0].value,3);
}

console.log('All six final native executors: command order, costs, play limits, growth transfer and checkpoints OK');
