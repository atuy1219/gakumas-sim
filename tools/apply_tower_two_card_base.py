from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"target not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Current Idol Road uses the compact two-card base deck, not produce_default's 8-card deck.
p = Path("web/tower_runtime.js")
text = p.read_text()
repls = {
    '"initial_deck-produce_default-parameter_buff"': '"initial_deck-parameter_buff"',
    '"initial_deck-produce_default-concentration"': '"initial_deck-concentration"',
    '"initial_deck-produce_default-lesson_buff"': '"initial_deck-lesson_buff"',
    '"initial_deck-produce_default-review"': '"initial_deck-review"',
    '"initial_deck-produce_default-aggressive"': '"initial_deck-aggressive"',
    '"initial_deck-produce_default-full_power"': '"initial_deck-full_power"',
    'ProduceExamEffectType_ExamConcentration: "センス / 集中"': 'ProduceExamEffectType_ExamConcentration: "アノマリー / 強気"',
    'ProduceExamEffectType_ExamLessonBuff: "ロジック / やる気"': 'ProduceExamEffectType_ExamLessonBuff: "センス / 集中"',
    'ProduceExamEffectType_ExamCardPlayAggressive: "アノマリー / 強気"': 'ProduceExamEffectType_ExamCardPlayAggressive: "ロジック / やる気"',
}
for old, new in repls.items():
    if old not in text:
        raise SystemExit(f"tower_runtime replacement target missing: {old}")
    text = text.replace(old, new, 1)
p.write_text(text)

# Regression test all six current two-card base decks and the corrected semantic labels.
p = Path("test_tower_runtime.mjs")
text = p.read_text()
text = text.replace(
'''  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,\n''',
'''  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,\n  TOWER_EXAM_EFFECT_LABELS,\n''',
1,
)
old = '''const initialDeckById = new Map([\n  ["initial_deck-produce_default-concentration", {\n    id: "initial_deck-produce_default-concentration",\n    cards: Array.from({ length: 8 }, (_, i) => ({ id: `B${i + 1}`, upgradeCount: 0 })),\n  }],\n]);\nconst idolCardById = new Map([["idol-1", {\n  id: "idol-1",\n  examEffectType: "ProduceExamEffectType_ExamConcentration",\n}]]);\nconst resolved = resolveTowerDefaultDeck("idol-1", idolCardById, initialDeckById);\nassert.equal(TOWER_DEFAULT_DECK_BY_EXAM_EFFECT.ProduceExamEffectType_ExamConcentration, "initial_deck-produce_default-concentration");\nassert.equal(resolved.deckId, "initial_deck-produce_default-concentration");\nassert.equal(resolved.cards.length, 8);\n'''
new = '''const effectDeckCases = [\n  ["ProduceExamEffectType_ExamParameterBuff", "initial_deck-parameter_buff", "センス / 好調"],\n  ["ProduceExamEffectType_ExamLessonBuff", "initial_deck-lesson_buff", "センス / 集中"],\n  ["ProduceExamEffectType_ExamCardPlayAggressive", "initial_deck-aggressive", "ロジック / やる気"],\n  ["ProduceExamEffectType_ExamReview", "initial_deck-review", "ロジック / 好印象"],\n  ["ProduceExamEffectType_ExamConcentration", "initial_deck-concentration", "アノマリー / 強気"],\n  ["ProduceExamEffectType_ExamFullPower", "initial_deck-full_power", "アノマリー / 全力"],\n];\nconst initialDeckById = new Map(effectDeckCases.map(([effectType, deckId], caseIndex) => [\n  deckId,\n  {\n    id: deckId,\n    cards: [\n      { id: `BASE-${caseIndex + 1}-A`, upgradeCount: 0 },\n      { id: `BASE-${caseIndex + 1}-B`, upgradeCount: 0 },\n    ],\n  },\n]));\nconst idolCardById = new Map(effectDeckCases.map(([effectType], index) => [\n  `idol-${index + 1}`,\n  { id: `idol-${index + 1}`, examEffectType: effectType },\n]));\nfor (const [effectType, deckId, label] of effectDeckCases) {\n  assert.equal(TOWER_DEFAULT_DECK_BY_EXAM_EFFECT[effectType], deckId);\n  assert.equal(TOWER_EXAM_EFFECT_LABELS[effectType], label);\n}\nconst resolved = resolveTowerDefaultDeck("idol-5", idolCardById, initialDeckById);\nassert.equal(resolved.deckId, "initial_deck-concentration");\nassert.equal(resolved.label, "アノマリー / 強気");\nassert.equal(resolved.cards.length, 2);\n'''
if old not in text:
    raise SystemExit("test tower base deck block not found")
text = text.replace(old, new, 1)
p.write_text(text)

replace(
    "README.md",
    "メモリー2〜4枚を選択すると、MainのPアイドルの `examEffectType` に対応する公式初期デッキ8枚を自動追加します。",
    "メモリー2〜4枚を選択すると、MainのPアイドルの `examEffectType` に対応する現在のドル道仕様の基本カード2枚を自動追加します。",
)
replace(
    "web/index.html",
    "アイドルへの道のデッキは、選択メモリーの採用カード + MainのPアイドルのタイプに対応する公式初期デッキ8枚で構成します。",
    "アイドルへの道のデッキは、選択メモリーの採用カード + MainのPアイドルのタイプに対応する基本カード2枚で構成します。",
)
replace(
    "web/index.html",
    "Pアイドルの examEffectType（好調 / 集中 / やる気 / 好印象 / 強気 / 全力）から公式の8枚初期デッキを自動選択します。",
    "Pアイドルの examEffectType（好調 / 集中 / やる気 / 好印象 / 強気 / 全力）から現在のドル道仕様に対応する基本カード2枚を自動選択します。",
)
