import assert from "node:assert/strict";
import {
  EXAM_PRESET_FORMAT,
  EXAM_PRESET_VERSION,
  createExamPreset,
  parseExamPreset,
} from "./web/exam_preset.js";

const preset = createExamPreset({
  characterId: "hski",
  planType: "ProducePlanType_Plan1",
  idolCardId: "i_card-hski-3-001",
  cards: [{ id: "p_card-a", count: 2 }, { id: "p_card-b", count: 1 }],
  stamina: 30,
  targetScore: 12000,
});
assert.equal(preset.format, EXAM_PRESET_FORMAT);
assert.equal(preset.version, EXAM_PRESET_VERSION);
assert.equal(preset.characterId, "hski");
assert.deepEqual(preset.cards, [{ id: "p_card-a", count: 2 }, { id: "p_card-b", count: 1 }]);
assert.equal(preset.stamina, 30);
assert.equal(preset.targetScore, 12000);

const parsed = parseExamPreset(JSON.stringify(preset));
assert.equal(parsed.idolCardId, "i_card-hski-3-001");
assert.deepEqual(parsed.cards, preset.cards);

const grouped = createExamPreset({ ...preset, cards: [{ id: "p_card-a", count: 1 }, { id: "p_card-a", count: 2 }] });
assert.deepEqual(grouped.cards, [{ id: "p_card-a", count: 3 }]);
assert.throws(() => parseExamPreset("not-json"), /JSON/);
assert.throws(() => parseExamPreset(JSON.stringify({ ...preset, format: "wrong" })), /編成ファイル/);
assert.throws(() => createExamPreset({ ...preset, cards: [] }), /1枚もありません/);

console.log("exam preset tests: ok");
