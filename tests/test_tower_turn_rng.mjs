import assert from 'node:assert/strict';
import { calculateTowerTurnTypes, resolveTowerTurnInitialization, parseTowerNpcCounts,
  loadTowerStageCatalog, buildTowerStageChoices, TOWER_STAGE_MASTER_URLS } from '../web/tower_stage.js';
import { calculateWeightedTurnParameterTypes } from '../web/turn_parameters.js';
import { advanceXorshift32 } from '../web/simulation.js';
import { createTowerTurnState, drawTowerTurn, finishTowerTurn } from '../web/tower_runtime.js';

const config = { id: 'p_exam_battle_config-tower_001-2096_1715_2541-2589_2118_3139-turn_16',
  turn: 16, vocal: 2096, dance: 1715, visual: 2541 };
const shuffleState = 3437998083;
const options = { npcCount: 5 };
const initialization = resolveTowerTurnInitialization(config, shuffleState, options);
assert.deepEqual(initialization, { shuffleState, turnSeed: 775645918,
  turnRandomSteps: 13, npcRandomSteps: 80, npcCount: 5 });
const expected = ['Visual', 'Visual', 'Vocal', 'Dance', 'Dance', 'Visual', 'Vocal', 'Dance',
  'Visual', 'Visual', 'Vocal', 'Vocal', 'Visual', 'Dance', 'Vocal', 'Visual'];
assert.deepEqual(calculateTowerTurnTypes(config, shuffleState, options), expected);
assert.deepEqual(calculateTowerTurnTypes(config, `0x${shuffleState.toString(16)}`, options), expected);
assert.deepEqual(calculateWeightedTurnParameterTypes(config, initialization.turnSeed), expected);
assert.deepEqual(calculateWeightedTurnParameterTypes(config, shuffleState).slice(0, 2), ['Dance', 'Dance']);
assert.equal(advanceXorshift32(initialization.turnSeed, 13 + 80), shuffleState);
// Turn generation and NPC score jitter consume words even if a choice is
// determined (pool size 1, score jitter range 0..1). Counts vary by stage.
for (const turn of [4, 9, 12, 16, 20]) {
  for (const npcCount of [0, 1, 4, 5, 6]) {
    const sourceSeed = 0x12345678;
    const state = advanceXorshift32(sourceSeed, turn - 3 + npcCount * turn);
    const stage = { ...config, turn };
    assert.equal(resolveTowerTurnInitialization(stage, state, { npcCount }).turnSeed, sourceSeed);
    assert.deepEqual(calculateTowerTurnTypes(stage, state, { npcCount }),
      calculateWeightedTurnParameterTypes(stage, sourceSeed));
  }
}
assert.throws(() => calculateTowerTurnTypes(config, shuffleState), /NPC/);
assert.throws(() => calculateTowerTurnTypes(config, shuffleState, { npcCount: -1 }), /NPC/);
assert.throws(() => calculateTowerTurnTypes(config, shuffleState, null), /NPC/);

// Both the initial shuffle and every subsequent recycle retain the recovered
// RNG stream. Changing turn attributes must never advance the deck RNG again.
const cards = Array.from({ length: 21 }, (_, i) => ({ id: `card-${i}`, playEffects: [] }));
const byId = new Map(cards.map(card => [card.id, card]));
const old = createTowerTurnState(cards, shuffleState, byId, { stamina: 43, turnLimit: 16 });
const fixed = createTowerTurnState(cards, shuffleState, byId,
  { stamina: 43, turnLimit: 16, turnParameterTypes: expected });
for (let turn = 1; turn <= 16; turn++) {
  assert.deepEqual(drawTowerTurn(fixed).drawn, drawTowerTurn(old).drawn, `skip turn ${turn}`);
  assert.equal(fixed.randomState, old.randomState, `skip RNG turn ${turn}`);
  finishTowerTurn(fixed); finishTowerTurn(old);
}

// NPC counts come from the selected floor's group; do not hard-code 5 or count
// unrelated stage/NPC records. Loading is exercised through the production API.
const groupId = 'p_npc_group-tower_001-jsna-exam_review-stage_026';
const npcYaml = Array.from({ length: 5 }, (_, i) => `- id: ${groupId}\n  number: ${i + 1}\n  scoreMin: 0\n  scoreMax: 0`).join('\n')
  + '\n- id: p_npc_group-tower_001-other\n  number: 1\n- id: p_npc_group-other\n  number: 1';
assert.equal(parseTowerNpcCounts(npcYaml).get(groupId), 5);
assert.equal(parseTowerNpcCounts(npcYaml).get('p_npc_group-tower_001-other'), 1);
assert.equal(parseTowerNpcCounts(npcYaml).has('p_npc_group-other'), false);
const contents = new Map([
  [TOWER_STAGE_MASTER_URLS.battleConfigs, Object.entries(config).map(([k, v], i) => `${i ? ' ' : '-'} ${k}: ${v}`).join('\n')],
  [TOWER_STAGE_MASTER_URLS.scoreConfigs, '- id: p_exam_battle_score_config-tower_001-test\n  parameter: 0'],
  [TOWER_STAGE_MASTER_URLS.npcGroups, npcYaml],
]);
const layer = { towerId: 'tower_001-jsna', number: 26, maxSubMemoryCount: 3,
  examEffectType: 'ProduceExamEffectType_ExamReview', produceExamBattleConfigId: config.id,
  produceExamBattleNpcGroupId: groupId };
const catalog = await loadTowerStageCatalog(async url => {
  if (url === TOWER_STAGE_MASTER_URLS.liveLayers) return {
    ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ layerExams: [layer] })).buffer,
  };
  return { ok: contents.has(url), text: async () => contents.get(url) ?? '', status: 404 };
});
const choice = buildTowerStageChoices(catalog, 'jsna', layer.examEffectType)[0];
assert.equal(choice.npcCount, 5);
assert.deepEqual(calculateTowerTurnTypes(catalog.configById.get(choice.configId), shuffleState, choice), expected);
const missing = buildTowerStageChoices({ ...catalog, npcCountByGroupId: new Map() })[0];
assert.throws(() => calculateTowerTurnTypes(config, shuffleState, missing), /NPC/);
console.log('Tower native turn/NPC initialization, selected group counts and all-skip deck stream: ok');
