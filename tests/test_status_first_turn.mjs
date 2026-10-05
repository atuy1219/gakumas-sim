import assert from 'node:assert/strict';
import {createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard, useTowerDrink} from '../web/tower_runtime.js';
import {addNativeGenericTimedStatus, addNativeScoreTimedStatus} from '../web/exam_effects.js';
import {createSimulationBackup, parseSimulationBackup, stringifySimulationBackup} from '../web/simulation_backup.js';
const cards = Array.from({length: 30}, (_, i) => ({id: `basic-${i}`, stamina: 0, playEffects: []}));
const setup = extra => createTowerTurnState(cards, 123, new Map(cards.map(c => [c.id, c])), {stamina: 100, turnLimit: 8, ...extra});
const grant = (s, type, value) => useTowerDrink(s, {id: type, effects: [{examEffect: {
  id: type, effectType: `ProduceExamEffectType_${type}`, effectValue1: value, effectTurn: value, effectCount: 1,
}}]});
const resume = s => parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(s, 'tower'))).state;
// Fresh scalar durations do not decrease; extending an existing duration
// retains its passing flag. Both branches must survive a JSON checkpoint.
for (const [type, field] of [['ExamReview', 'review'], ['ExamParameterBuff', 'parameterBuff'],
  ['ExamParameterBuffMultiplePerTurn', 'parameterBuffMultiplePerTurn']]) {
  const original = setup(); drawTowerTurn(original); grant(original, type, 6);
  for (const s of [original, resume(original)]) {
    finishTowerTurn(s); assert.equal(s.exam[field], 6, field);
    drawTowerTurn(s); grant(s, type, 2); finishTowerTurn(s);
    assert.equal(s.exam[field], field === 'parameterBuffMultiplePerTurn' ? 5 : 7, `${field}: regrant must not reset the flag`);
    drawTowerTurn(s); finishTowerTurn(s); assert.equal(s.exam[field], field === 'parameterBuffMultiplePerTurn' ? 4 : 6);
  }
}
// Additive rows with equal remaining duration are the same native status.
// A separate duration receives a separate first-turn exemption.
{
  const s = setup(); drawTowerTurn(s);
  addNativeGenericTimedStatus(s.exam, 'reviewAdditivePermil', 500, 2, 'add');
  addNativeScoreTimedStatus(s.exam, 'reviewMultiple', 500, 2);
  finishTowerTurn(s); assert.equal(s.exam.genericTimedStatuses[0].turn, 2);
  assert.equal(s.exam.scoreTimedStatuses[0].turn, 2);
  drawTowerTurn(s);
  addNativeGenericTimedStatus(s.exam, 'reviewAdditivePermil', 200, 2, 'add');
  addNativeGenericTimedStatus(s.exam, 'reviewAdditivePermil', 100, 1, 'add');
  addNativeScoreTimedStatus(s.exam, 'reviewMultiple', 500, 2);
  finishTowerTurn(s);
  assert.deepEqual(s.exam.genericTimedStatuses.map(row => [row.value, row.turn]), [[700, 1], [100, 1]]);
  assert.equal(s.exam.scoreTimedStatuses[0].turn, 1);
  assert.equal(s.history[0].examAfterTurnEnd.genericTimedStatuses[0].value, 500, 'later grants must not mutate saved turns');
  drawTowerTurn(s); finishTowerTurn(s);
  assert.equal(s.exam.reviewAdditivePermil, 0); assert.equal(s.exam.scoreTimedStatuses.length, 0);
}
// StartOfTurn additions have passed the native marker; StartPlay additions
// and card plays occur after the marker and are exempt on their first turn.
{
  const effect = {id: 'gain', effectType: 'ProduceExamEffectType_ExamReview', effectValue1: 3};
  const item = phase => ({id: phase, effects: [{id: phase, effectType: 'ProduceItemEffectType_ExamStatusEnchant', effectCount: 1,
    examStatusEnchant: {id: phase, trigger: {id: phase, phaseTypes: [`ProduceExamPhaseType_${phase}`]}, examEffects: [effect]}}]});
  for (const [phase, expected] of [['ExamStartTurn', 2], ['StartPlay', 3]]) {
    const s = setup({pItems: [item(phase)]}); drawTowerTurn(s); finishTowerTurn(s);
    assert.equal(s.exam.review, expected, phase);
  }
}
// Unused extra plays persist to the next turn, where they expire. The normal
// play and automatic replay do not spend the additional-play status.
{
  const s = setup(); drawTowerTurn(s); playTowerCard(s, 0); grant(s, 'ExamPlayableValueAdd', 1);
  finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.playsRemaining, 2);
  playTowerCard(s, 0); assert.equal(s.playableAddStatus.count, 1);
  const restored = resume(s);
  for (const branch of [s, restored]) {
    playTowerCard(branch, 0); assert.equal(branch.playableAddStatus, null);
    finishTowerTurn(branch); drawTowerTurn(branch); assert.equal(branch.playsRemaining, 1);
  }
  const expiry = setup(); drawTowerTurn(expiry); grant(expiry, 'ExamPlayableValueAdd', 1);
  finishTowerTurn(expiry); drawTowerTurn(expiry); assert.equal(expiry.playsRemaining, 2);
  finishTowerTurn(expiry); drawTowerTurn(expiry); assert.equal(expiry.playsRemaining, 1);
}

// Direct-effect Review triggers cannot chain from an ordinary enchant.
// These are the trigger/effect shapes used by びしっとキメ顔 and
// ファンシーチャーム; automatic card playback still uses a direct context.
{
  const s = setup(); drawTowerTurn(s);
  const gain = {id: 'review-gain', effectType: 'ProduceExamEffectType_ExamReview', effectValue1: 1};
  const score = {id: 'direct-score', effectType: 'ProduceExamEffectType_ExamLessonFix', effectValue1: 7};
  const enchants = [
    {id: 'direct', trigger: {id: 'direct', phaseTypes: ['ProduceExamPhaseType_ExamStatusChange'],
      effectTypes: ['ProduceExamEffectType_ExamReview']}, examEffects: [score]},
    {id: 'fan', trigger: {id: 'fan', phaseTypes: ['ProduceExamPhaseType_ExamCardPlay']}, examEffects: [gain]},
  ];
  for (const enchant of enchants) {
    s.examStatusEnchantById.set(enchant.id, {id: enchant.id, produceExamTriggerId: enchant.trigger.id, produceExamEffectIds: enchant.examEffects.map(e => e.id)});
    s.examTriggerById.set(enchant.trigger.id, enchant.trigger);
    for (const effect of enchant.examEffects) s.examEffectById.set(effect.id, effect);
    useTowerDrink(s, {id: 'install', effects: [{examEffect: {id: `install-${enchant.id}`,
      effectType: 'ProduceExamEffectType_ExamStatusEnchant', effectTurn: -1, produceExamStatusEnchantId: enchant.id}}]});
  }
  playTowerCard(s, 0); assert.equal(s.exam.review, 1); assert.equal(s.exam.parameter, 0);
  grant(s, 'ExamReview', 2); assert.equal(s.exam.parameter, 7);
}
// Catalogs contain nested Maps (customization levels). JSON must preserve
// both the level map and its transitive grow-effect references.
{
  const s = setup(); s.deck[0].customizes = [{id: 'custom', customizeCount: 1}];
  s.customizeById.set('custom', {id: 'custom', levels: new Map([[1, {produceCardGrowEffectIds: ['growth']} ]])});
  s.growEffectById.set('growth', {id: 'growth', value: 3});
  const restored = resume(s);
  assert.ok(restored.customizeById.get('custom').levels instanceof Map);
  assert.deepEqual(restored.customizeById.get('custom').levels.get(1), {produceCardGrowEffectIds: ['growth']});
  assert.ok(restored.growEffectById.has('growth'));
}


// Natural Review decay is consumption too. Dependent direct Review grants
// dispatch the same Review-change trigger as a fixed Review grant.
{
  const s = setup(); drawTowerTurn(s); grant(s, 'ExamReview', 10);
  finishTowerTurn(s); assert.equal(s.exam.reviewConsumptionSum, 0);
  drawTowerTurn(s); finishTowerTurn(s); assert.equal(s.exam.reviewConsumptionSum, 1);
  drawTowerTurn(s);
  const score = {id: 'dependent-score', effectType: 'ProduceExamEffectType_ExamLessonFix', effectValue1: 7};
  s.examEffectById.set(score.id, score);
  s.examTriggerById.set('review-change', {id: 'review-change', phaseTypes: ['ProduceExamPhaseType_ExamStatusChange'],
    effectTypes: ['ProduceExamEffectType_ExamReview']});
  s.examStatusEnchantById.set('direct-review', {id: 'direct-review', produceExamTriggerId: 'review-change', produceExamEffectIds: [score.id]});
  useTowerDrink(s, {id: 'install', effects: [{examEffect: {id: 'install', effectType: 'ProduceExamEffectType_ExamStatusEnchant',
    effectTurn: -1, produceExamStatusEnchantId: 'direct-review'}}]});
  const before = s.exam.parameter;
  grant(s, 'ExamReviewDependReviewConsumptionSum', 850);
  assert.equal(s.exam.review, 10); assert.equal(s.exam.parameter - before, 7);
}
// The actual ゆめみごこち customization stores an Unknown costType: the
// CostReviewReduce enum itself identifies the Review cost being reduced.
{
  const card = {id: 'yume', stamina: 0, costType: 'ExamCostType_ExamReview', costValue: 1, playEffects: []};
  const grow = {id: 'g_effect-cost_review_reduce-1', effectType: 'ProduceCardGrowEffectType_CostReviewReduce',
    costType: 'ExamCostType_Unknown', value: 1};
  const s = createTowerTurnState([{id: card.id, customizes: [{id: 'custom', customizeCount: 1}]}], 123, new Map([[card.id, card]]), {
    stamina: 30, turnLimit: 4,
    customizeById: new Map([['custom', {id: 'custom', levels: new Map([[1, {growEffectIds: [grow.id]}]])}]]),
    growEffectById: new Map([[grow.id, grow]]),
  });
  drawTowerTurn(s); grant(s, 'ExamReview', 10);
  assert.equal(s.hand[0].costValue, 0);
  const legacyBackup = createSimulationBackup(s, 'tower');
  legacyBackup.checkpoint.state.hand[0].costValue = 1;
  delete legacyBackup.checkpoint.state.hand[0].specificCostGrowApplied;
  const legacy = parseSimulationBackup(stringifySimulationBackup(legacyBackup)).state;
  assert.equal(legacy.hand[0].costValue, 0);
  for (const branch of [s, resume(s), legacy, resume(legacy)]) {
    playTowerCard(branch, 0); assert.equal(branch.exam.review, 10);
    assert.equal(branch.exam.reviewConsumptionSum, 0);
  }
}

console.log('Native first-turn lifetimes, direct triggers, Review consumption, customized costs and JSON resume: ok');
