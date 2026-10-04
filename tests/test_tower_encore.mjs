import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard} from '../web/tower_runtime.js';
import {createSimulationBackup, parseSimulationBackup, stringifySimulationBackup} from '../web/simulation_backup.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/tower-encore-masters.json', import.meta.url)));
const id = 'p_card-02-ido-3_203';
const map = rows => new Map(rows.map(row => [row.id, row]));
const maps = Object.fromEntries(['examEffectById', 'examStatusEnchantById', 'examTriggerById', 'cardSearchById'].map(key => [key, map(fixture[key])]));
const variants = new Map(fixture.cards.map(card => [`${card.id}@@${card.upgradeCount}`, card]));
function setup(upgradeCount, withItem) {
  const basics = Array.from({length: 20}, (_, i) => ({id: `basic-${i}`, playEffects: [], stamina: 0}));
  return createTowerTurnState([{id, upgradeCount}, ...basics], 123, map([fixture.cards[0], ...basics]), {
    ...maps, cardVariantByKey: variants, stamina: 30, review: 20, handLimit: 30, turnLimit: 4,
    pItems: withItem ? fixture.pItems : [],
  });
}
for (const upgrade of [0, 1]) for (const withItem of [false, true]) {
  const original = setup(upgrade, withItem);
  drawTowerTurn(original, 21);
  // The skill costs five Review; Encore must replay even with insufficient Review.
  original.exam.review = 20;
  playTowerCard(original, original.hand.findIndex(card => card.id === id));
  assert.equal(original.statusEnchantSerial, 1);
  const backup = createSimulationBackup(original, 'tower');
  const resumed = parseSimulationBackup(stringifySimulationBackup(backup)).state;
  // Emulate pre-fix checkpoints with no per-card count, including the lost card.
  for (const pool of ['hand', 'deck', 'discard', 'lost', 'hold']) for (const card of backup.checkpoint.state[pool]) delete card.playCount;
  const legacy = parseSimulationBackup(stringifySimulationBackup(backup)).state;
  assert.equal(legacy.lost.find(card => card.id === id).playCount, 1);
  for (const s of [original, resumed, legacy]) {
    for (let turn = 2; turn <= (withItem ? 6 : 4); turn++) {
      finishTowerTurn(s); s.exam.review = 0;
      drawTowerTurn(s);
      const finalPhase = turn >= 4;
      const used = s.currentTurnPlays.filter(play => play.card.id === id);
      assert.equal(used.length, finalPhase ? 1 : 0, `+${upgrade}, item=${withItem}, turn=${turn}`);
      if (finalPhase) {
        assert.deepEqual(used[0].cost, [], 'Encore pays neither Review nor stamina');
        assert.equal(s.playsRemaining, 2, 'Encore adds a play without consuming the normal one');
        assert.equal(s.exam.review, upgrade ? 4 : 3);
      }
      assert.equal(s.statusEnchantSerial, 1, 'the initial-only Encore effect cannot reinstall itself');
      assert.equal(s.lost.filter(card => card.id === id).length, 1);
      assert.equal(s.hand.some(card => card.id === id), false);
    }
    assert.equal(s.turnLimit, withItem ? 6 : 4);
    assert.equal(s.statusEnchantRemainingCounts.get('statusEnchant:1'), withItem ? 0 : 2);
    assert.deepEqual(s.unsupported, []);
    finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.ended, true);
  }
}
// Ordinary exams may temporarily upgrade the skill through a support card.
// Reverting the variant must retain the prior-use count and not reinstall Encore.
{
  const s = setup(0, true);
  s.supportCards = [{supportCardId: 'always', cardSearchId: 'mental', produceCardUpgradePermil: 1000}];
  s.cardSearchById.set('mental', {id: 'mental', cardPositionType: 'ProduceCardPositionType_Hand',
    cardCategories: ['ProduceCardCategory_MentalSkill']});
  drawTowerTurn(s, 21); s.exam.review = 20;
  assert.equal(s.hand.find(card => card.id === id).upgradeCount, 1);
  playTowerCard(s, s.hand.findIndex(card => card.id === id));
  finishTowerTurn(s);
  assert.equal(s.lost.find(card => card.id === id).upgradeCount, 0);
  assert.equal(s.lost.find(card => card.id === id).playCount, 1);
  s.supportCards = [];
  for (let turn = 2; turn <= 4; turn++) { drawTowerTurn(s); if (turn < 4) finishTowerTurn(s); }
  assert.equal(s.currentTurnPlays.filter(play => play.card.id === id).length, 1);
  assert.equal(s.statusEnchantSerial, 1);
}
console.log('Real Encore base/+, concurrent final-turn extension, initial-only effects and legacy resume: ok');
