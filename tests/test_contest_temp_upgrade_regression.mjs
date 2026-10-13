import assert from 'node:assert/strict';
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from '../web/tower_runtime.js';
import { findNativeReplayCardIndex } from '../web/contest_native_replay.js';

// Capture (16), session 8: アイドル魂+ delays a Hand-search upgrade to
// turn 2. いたずらサンタさん base stamina 6 -> temporary + stamina 3.
const upgrade = 'e_effect-exam_card_upgrade-p_card_search-hand-all-0_0';
const timer = 'e_effect-exam_effect_timer-0001-01-' + upgrade;
const soul = 'p_card-00-men-3_003', santa = 'p_card-03-sup-3_162';
const party = 'p_card-00-sup-3_027', base = 'p_card-03-men-0_013';
const image = 'p_card-03-men-0_015', spare = 'p_card-00-act-0_001';
const card = (id, upgradeCount, name, stamina, effects=[]) => ({
  id, upgradeCount, name, stamina, playMovePositionType:'ProduceCardMovePositionType_Grave',
  playEffects: effects.map(produceExamEffectId => ({produceExamEffectId})),
});
const variants = [
  card(soul,1,'アイドル魂+',2,['e_effect-exam_playable_value_add-01',timer]),
  card(party,0,'ティーパーティ',3,['e_effect-exam_playable_value_add-01',upgrade]),
  card(base,0,'メントレの基本',3), card(base,1,'メントレの基本+',3),
  card(santa,0,'いたずらサンタさん',6), card(santa,1,'いたずらサンタさん+',3),
  card(image,0,'イメージの基本',2), card(image,1,'イメージの基本+',2),
  card(spare,0,'アピールの基本',4), card(spare,1,'アピールの基本+',3),
];
const masters = new Map(variants.filter(c=>c.upgradeCount===0 || c.id===soul).map(c=>[c.id,c]));
const state = createTowerTurnState([
  {id:soul,upgradeCount:1},{id:party},{id:base},{id:santa},{id:image},{id:spare},
], 200246811, masters, {
  stamina:39, turnLimit:8, drawPerTurn:3,
  cardVariantByKey:new Map(variants.map(c=>[c.id+'@@'+c.upgradeCount,c])),
  cardSearchById:new Map([['p_card_search-hand',{
    id:'p_card_search-hand',cardPositionType:'ProduceCardPositionType_Hand',
  }]]),
  examEffectById:new Map([
    [timer,{id:timer,effectType:'ProduceExamEffectType_ExamEffectTimer',
      effectValue1:1,effectCount:1,chainProduceExamEffectId:upgrade}],
    [upgrade,{id:upgrade,effectType:'ProduceExamEffectType_ExamCardUpgrade',
      produceCardSearchId:'p_card_search-hand',pickRangeType:'ProducePickRangeType_All'}],
  ]),
});
// Fix a reproducible draw order; none of the native card effects or scores
// are injected into the simulator.
state.deck=[soul,party,base,santa,image,spare].map(id=>state.deck.find(c=>c.id===id));
drawTowerTurn(state,3);
playTowerCard(state,state.hand.findIndex(c=>c.id===soul));
playTowerCard(state,state.hand.findIndex(c=>c.id===party));
assert.equal(state.hand.find(c=>c.id===base).upgradeCount,1);
finishTowerTurn(state,{type:'end'});
assert.equal(state.discard.find(c=>c.id===base).upgradeCount,0,
  'the immediate skill upgrade must also be temporary');
drawTowerTurn(state,3);
const santaCard=state.hand.find(c=>c.id===santa);
assert.equal(santaCard.upgradeCount,1);
assert.equal(santaCard.name,'いたずらサンタさん+');
assert.equal(santaCard.stamina,3,'master + cost, not native-cost overwrite');
assert.deepEqual(findNativeReplayCardIndex(state.hand,{
  id:santa,baseUpgradeCount:0,temporaryUpgradeCount:1,
}),{index:0,upgradeFallback:false});
state.exam.block=0;
const before=state.exam.stamina;
playTowerCard(state,state.hand.indexOf(santaCard));
assert.equal(before-state.exam.stamina,3);
finishTowerTurn(state,{type:'end'});
assert.equal(state.discard.find(c=>c.id===santa).upgradeCount,0);
assert.equal(state.discard.find(c=>c.id===santa).stamina,6);
console.log('Delayed Hand search and temporary card master variant: ok');
