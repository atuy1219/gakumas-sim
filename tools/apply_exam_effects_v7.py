from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: replacement count={count}")
    return result


# --- web/engine.js: keep full card play-effect data from ProduceCard.yaml ---
engine_path = ROOT / "web" / "engine.js"
engine = engine_path.read_text(encoding="utf-8")
engine = replace_once(
    engine,
    r"function yamlScalar\(value\) \{.*?\n\}\n\n(?=export function parseProduceCardCatalogYaml)",
    '''function yamlScalar(value) {
  const text = String(value ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      if (text.startsWith('"')) return JSON.parse(text);
    } catch {}
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\\d+(?:\\.\\d+)?$/.test(text)) return Number(text);
  return text;
}

''',
    "engine yamlScalar",
    re.S,
)
engine = replace_once(
    engine,
    r"export function parseProduceCardCatalogYaml\(text\) \{.*?\n\}\n\n(?=export function parseIdolCardCatalogYaml)",
    '''export function parseProduceCardCatalogYaml(text) {
  const cards = [];
  let current = null;
  let section = null;
  let activePlayEffect = null;
  const scalarFields = new Set([
    "upgradeCount", "name", "planType", "category", "rarity", "assetId",
    "stamina", "forceStamina", "costType", "costValue",
    "playProduceExamTriggerId", "playMovePositionType", "moveEffectTriggerType",
    "isEndTurnLost", "isInitial", "isRestrict", "produceCardStatusEnchantId",
    "noDeckDuplication", "isLimited", "evaluation",
  ]);
  const flush = () => {
    if (!current?.id) return;
    current.upgradeCount = Number(current.upgradeCount ?? 0);
    current.stamina = Number(current.stamina ?? 0);
    current.forceStamina = Number(current.forceStamina ?? 0);
    current.costValue = Number(current.costValue ?? 0);
    current.evaluation = Number(current.evaluation ?? 0);
    current.playEffects = Array.isArray(current.playEffects) ? current.playEffects : [];
    current.moveProduceExamEffectIds = Array.isArray(current.moveProduceExamEffectIds) ? current.moveProduceExamEffectIds : [];
    current.noDeckDuplication = current.noDeckDuplication === true;
    current.isLimited = current.isLimited === true;
    current.isEndTurnLost = current.isEndTurnLost === true;
    current.isInitial = current.isInitial === true;
    current.isRestrict = current.isRestrict === true;
    cards.push(current);
  };

  for (const line of String(text ?? "").split(/\\r?\\n/)) {
    let match = line.match(/^- id:\\s*(.+?)\\s*$/);
    if (match) {
      flush();
      current = { id: String(yamlScalar(match[1])), playEffects: [], moveProduceExamEffectIds: [] };
      section = null;
      activePlayEffect = null;
      continue;
    }
    if (!current) continue;

    match = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):\\s*(.*?)\\s*$/);
    if (match) {
      const field = match[1];
      const raw = match[2];
      activePlayEffect = null;
      if (field === "playEffects") {
        section = raw === "[]" ? null : "playEffects";
        current.playEffects = [];
      } else if (field === "moveProduceExamEffectIds") {
        section = raw === "[]" ? null : "moveProduceExamEffectIds";
        current.moveProduceExamEffectIds = [];
      } else {
        section = null;
        if (scalarFields.has(field)) current[field] = yamlScalar(raw);
      }
      continue;
    }

    if (section === "playEffects") {
      match = line.match(/^  -\\s*([A-Za-z][A-Za-z0-9_]*):\\s*(.*?)\\s*$/);
      if (match) {
        activePlayEffect = { [match[1]]: yamlScalar(match[2]) };
        current.playEffects.push(activePlayEffect);
        continue;
      }
      match = line.match(/^    ([A-Za-z][A-Za-z0-9_]*):\\s*(.*?)\\s*$/);
      if (match && activePlayEffect) {
        activePlayEffect[match[1]] = yamlScalar(match[2]);
        continue;
      }
    }

    if (section === "moveProduceExamEffectIds") {
      match = line.match(/^  -\\s*(.*?)\\s*$/);
      if (match) current.moveProduceExamEffectIds.push(String(yamlScalar(match[1])));
    }
  }
  flush();
  return cards;
}

''',
    "engine ProduceCard parser",
    re.S,
)
engine = replace_once(
    engine,
    r"  const cards = parseProduceCardCatalogYaml\(cardText\);\n  const initialDecks = parseExamInitialDeckYaml\(deckText\);\n  const idolCards = parseIdolCardCatalogYaml\(idolText\);\n  return \{\n    cards,\n    cardById: new Map\(cards.map\(\(card\) => \[String\(card.id\), card\]\)\),",
    '''  const cards = parseProduceCardCatalogYaml(cardText);
  const initialDecks = parseExamInitialDeckYaml(deckText);
  const idolCards = parseIdolCardCatalogYaml(idolText);
  const cardVariantByKey = new Map(cards.map((card) => [
    `${String(card.id)}@@${Number(card.upgradeCount ?? 0)}`,
    card,
  ]));
  return {
    cards,
    cardById: new Map(cards.map((card) => [String(card.id), card])),
    cardVariantByKey,''',
    "engine variant map",
)
engine_path.write_text(engine, encoding="utf-8")


# --- web/app_v3.js: wire card effects and resolved P-item metadata into Tower runtime ---
app_path = ROOT / "web" / "app_v3.js"
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    r'''import \{
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  resolveTowerDefaultDeck,
\} from "\./tower_runtime\.js";''',
    '''import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
  resolveTowerDefaultDeck,
} from "./tower_runtime.js";
import {
  describeCardEffects,
  describeProduceItemEffect,
  loadExamItemCatalogs,
  resolveProduceItems,
} from "./exam_effects_v7.js";''',
    "app imports",
)
app = replace_once(
    app,
    r"let towerTurnState = null;",
    '''let towerTurnState = null;
let examItemCatalogs = {
  items: [], itemById: new Map(), itemEffects: [], itemEffectById: new Map(),
};''',
    "app item catalog state",
)
app = replace_once(
    app,
    r"\nfunction searchMemoryText\(memory\) \{",
    '''
async function initializeExamItemCatalogs() {
  try {
    examItemCatalogs = await loadExamItemCatalogs();
    renderPItems("contest");
    renderPItems("tower");
    if (towerTurnState) renderTowerTurnState();
  } catch (error) {
    console.warn("P-item effect catalog load failed", error);
  }
}

function searchMemoryText(memory) {''',
    "app item catalog loader",
)
app = replace_once(
    app,
    r"function renderPItems\(mode\) \{.*?\n\}\n\n(?=for \(const mode of \[\"contest\", \"tower\"\]\))",
    '''function renderPItems(mode) {
  const container = $(simIds(mode).pitems);
  if (!container) return;
  container.innerHTML = "";
  const seen = new Set();
  for (const slot of ensureSlots(mode)) {
    if (!slot) continue;
    const memory = memoryList.find((item) => item.userMemoryId === slot.memoryId);
    const ids = memory?.examBattleProduceItemIds?.length
      ? memory.examBattleProduceItemIds
      : rawArray(memory, "examBattleProduceItemIds");
    for (const id of ids ?? []) seen.add(String(id));
  }
  const resolved = resolveProduceItems([...seen], examItemCatalogs.itemById, examItemCatalogs.itemEffectById);
  for (const item of resolved.items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item.name && item.name !== item.id ? item.name : item.id;
    chip.title = [item.id, ...(item.effects ?? []).map(describeProduceItemEffect)].join("\\n");
    container.append(chip);
  }
  if (!seen.size) container.textContent = "Pアイテムなし / 未取得";
}

''',
    "app renderPItems",
    re.S,
)
app = replace_once(
    app,
    r"function runtimeCardLabel\(card\) \{.*?\n\}\n\n(?=\$\(\"tower-run\"\)\.addEventListener)",
    '''function runtimeCardLabel(card) {
  return observationCardLabel(catalogName(card), Number(card?.upgradeCount ?? 0));
}

function examStateText(exam) {
  const stamina = Number(exam?.maxStamina ?? 0) > 0
    ? `${Number(exam.stamina ?? 0)}/${Number(exam.maxStamina ?? 0)}`
    : String(Number(exam?.stamina ?? 0));
  return `基礎パラメータ ${Number(exam?.parameter ?? 0)} · 体力 ${stamina} · 元気 ${Number(exam?.block ?? 0)} · 好印象 ${Number(exam?.review ?? 0)} · やる気 ${Number(exam?.aggressive ?? 0)} · 集中 ${Number(exam?.lessonBuff ?? 0)} · 好調 ${Number(exam?.parameterBuff ?? 0)}T`;
}

function renderTowerTurnState() {
  const box = $("tower-turn-result");
  if (!box) return;
  box.hidden = !towerTurnState;
  if (!towerTurnState) return;

  $("tower-turn-meta").textContent = `Turn ${towerTurnState.turn} · 使用可能 ${towerTurnState.playsRemaining}回 · 山札 ${towerTurnState.deck.length} · 捨て札 ${towerTurnState.discard.length} · 除外 ${towerTurnState.lost.length} · 再シャッフル ${towerTurnState.recycleCount}回 · RNG ${asHex(towerTurnState.randomState)}`;
  const handBox = $("tower-turn-hand");
  let examLine = $("tower-turn-exam-state");
  if (!examLine) {
    examLine = document.createElement("p");
    examLine.id = "tower-turn-exam-state";
    examLine.className = "hint";
    box.insertBefore(examLine, handBox);
  }
  examLine.textContent = examStateText(towerTurnState.exam);

  let itemLine = $("tower-turn-pitems-state");
  if (!itemLine) {
    itemLine = document.createElement("p");
    itemLine.id = "tower-turn-pitems-state";
    itemLine.className = "hint";
    box.insertBefore(itemLine, handBox);
  }
  const pItemNames = (towerTurnState.pItems ?? []).map((item) => item.name || item.id);
  itemLine.textContent = pItemNames.length
    ? `Pアイテム: ${pItemNames.join(" / ")}（効果参照は解決済み、継続効果の発火処理は順次対応）`
    : "Pアイテム: なし / 未解決";

  let warningLine = $("tower-turn-effect-warning");
  if (!warningLine) {
    warningLine = document.createElement("p");
    warningLine.id = "tower-turn-effect-warning";
    warningLine.className = "callout";
    box.insertBefore(warningLine, handBox);
  }
  warningLine.hidden = !(towerTurnState.unsupported?.length);
  warningLine.textContent = towerTurnState.unsupported?.length
    ? `未対応の効果/条件: ${towerTurnState.unsupported.join(" / ")}`
    : "";

  handBox.innerHTML = "";
  towerTurnState.hand.forEach((card, index) => {
    const article = document.createElement("article");
    article.className = "tower-turn-card-v7";
    const title = document.createElement("strong");
    title.textContent = runtimeCardLabel(card);
    const detail = document.createElement("small");
    const move = card.onceOnly ? "レッスン中1回 · 使用すると除外" : "使用後は捨て札";
    const effects = describeCardEffects(card);
    detail.textContent = [move, ...effects].join(" · ");
    const use = document.createElement("button");
    use.type = "button";
    use.className = "secondary compact";
    use.textContent = "このカードを使用";
    use.disabled = Number(towerTurnState.playsRemaining ?? 0) <= 0;
    use.addEventListener("click", () => advanceTowerTurn({ type: "use", index }));
    article.append(title, detail, use);
    handBox.append(article);
  });

  const history = $("tower-turn-history");
  history.innerHTML = "";
  for (const entry of [...towerTurnState.history].reverse()) {
    const li = document.createElement("li");
    const plays = entry.plays ?? [];
    const action = plays.length
      ? plays.map((play) => {
          const details = [...(play.cost ?? []), ...(play.effects ?? [])].filter(Boolean).join(" / ");
          return `使用: ${runtimeCardLabel(play.card)}${details ? `（${details}）` : ""}`;
        }).join(" → ")
      : "スキップ";
    const remains = (entry.hand ?? []).length ? ` · 終了時手札 ${entry.hand.map(runtimeCardLabel).join(" / ")}` : "";
    li.textContent = `Turn ${entry.turn}: ${action}${remains}`;
    history.append(li);
  }
}

function advanceTowerTurn(action) {
  try {
    clearError();
    if (String(action?.type) === "use") {
      playTowerCard(towerTurnState, action.index);
      if (Number(towerTurnState.playsRemaining ?? 0) <= 0) {
        finishTowerTurn(towerTurnState, { type: "end" });
        drawTowerTurn(towerTurnState, 3);
      }
    } else {
      finishTowerTurn(towerTurnState, action);
      drawTowerTurn(towerTurnState, 3);
    }
    renderTowerTurnState();
  } catch (error) {
    showError(error);
    renderTowerTurnState();
  }
}

''',
    "app tower runtime UI",
    re.S,
)
app = replace_once(
    app,
    r"    towerTurnState = createTowerTurnState\(composition\.cards, \$\(\"tower-seed\"\)\.value, catalogs\.cardById\);",
    '''    const pItemIds = [...new Set(composition.memories.flatMap((memory) =>
      memory.examBattleProduceItemIds?.length ? memory.examBattleProduceItemIds : rawArray(memory, "examBattleProduceItemIds")
    ).map(String))];
    const resolvedPItems = resolveProduceItems(pItemIds, examItemCatalogs.itemById, examItemCatalogs.itemEffectById);
    towerTurnState = createTowerTurnState(composition.cards, $("tower-seed").value, catalogs.cardById, {
      cardVariantByKey: catalogs.cardVariantByKey,
      stamina: Number(composition.memories[0]?.stamina ?? getField(composition.memories[0]?.raw, "stamina") ?? 0),
      pItems: resolvedPItems.items,
    });''',
    "app tower create state",
)
app = replace_once(
    app,
    r"initializeCatalogs\(\);\s*$",
    '''initializeCatalogs();
initializeExamItemCatalogs();
''',
    "app startup",
)
app_path.write_text(app, encoding="utf-8")


# --- Fix play-card validation order: don't mutate cost before checking play trigger. ---
runtime_path = ROOT / "web" / "tower_runtime.js"
runtime = runtime_path.read_text(encoding="utf-8")
old = '''  event.cost.push(...payCardCost(state.exam, card));
  state.hand.splice(index, 1);
  state.playsRemaining -= 1;
  state.exam.cardPlayCount += 1;

  const cardTrigger = checkCardEffectTrigger(card.playProduceExamTriggerId, state.exam);
  if (!cardTrigger.supported) {
    rememberUnsupported(state, `play-trigger:${card.playProduceExamTriggerId}`);
    event.effects.push(`カード使用条件は未対応: ${card.playProduceExamTriggerId}`);
  } else if (!cardTrigger.triggered) {
    throw new Error(`${card.id}: カード使用条件を満たしていません。`);
  }

  for (const entry of card.playEffects ?? []) applyCardEffectEntry(state, entry, event);'''
new = '''  const cardTrigger = checkCardEffectTrigger(card.playProduceExamTriggerId, state.exam);
  if (!cardTrigger.supported) {
    rememberUnsupported(state, `play-trigger:${card.playProduceExamTriggerId}`);
    event.effects.push(`カード使用条件は未対応: ${card.playProduceExamTriggerId}`);
  } else if (!cardTrigger.triggered) {
    throw new Error(`${card.id}: カード使用条件を満たしていません。`);
  }

  event.cost.push(...payCardCost(state.exam, card));
  state.hand.splice(index, 1);
  state.playsRemaining -= 1;
  state.exam.cardPlayCount += 1;
  for (const entry of card.playEffects ?? []) applyCardEffectEntry(state, entry, event);'''
if old not in runtime:
    raise RuntimeError("tower runtime play trigger/cost block not found")
runtime = runtime.replace(old, new, 1)
runtime_path.write_text(runtime, encoding="utf-8")


# --- web/index.html: update the old 'effects are not calculated' notice. ---
index_path = ROOT / "web" / "index.html"
index = index_path.read_text(encoding="utf-8")
old_notice = '''<p class="callout">毎ターン3枚を実際にドローし、カードを1枚使用するかスキップして次ターンへ進めます。通常カードは捨て札へ、「レッスン中1回」のカードは<strong>使用した場合だけ除外</strong>されます。山札が空なら、その時点の捨て札だけを同じ乱数状態の続きで再シャッフルします。カード効果そのものはこの画面では計算しません。</p>'''
new_notice = '''<p class="callout">毎ターン3枚を実際にドローし、カードを使用するかターン終了して進めます。通常カードは捨て札へ、「レッスン中1回」のカードは<strong>使用した場合だけ除外</strong>されます。カード効果はProduceCardマスタから読み取り、パラメータ・元気・好印象・やる気・集中・好調・体力回復・追加ドロー・カード使用回数など対応済みの効果を反映します。未対応の効果や条件は無視せず画面に表示します。PアイテムはProduceItem → ProduceItemEffectの参照まで解決し、継続効果の発火処理は順次追加します。</p>'''
if old_notice not in index:
    raise RuntimeError("index tower effect notice not found")
index = index.replace(old_notice, new_notice, 1)
index_path.write_text(index, encoding="utf-8")


# --- test_tower_runtime.mjs: add a real card-effect execution case. ---
test_path = ROOT / "test_tower_runtime.mjs"
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    r"  finishTowerTurn,\n  isOnceOnlyMove,",
    '''  finishTowerTurn,
  isOnceOnlyMove,
  playTowerCard,''',
    "tower test import",
)
insert = '''

// Supported ProduceCard play effects mutate the live Exam state and can add plays.
const effectCardById = new Map([
  ["EFFECT", {
    id: "EFFECT",
    stamina: 2,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0008-01" },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_block-0004" },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-0001" },
    ],
  }],
  ["X", { id: "X", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["Y", { id: "Y", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
state = createTowerTurnState(
  ["EFFECT", "X", "Y"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  effectCardById,
  { stamina: 20 },
);
drawTowerTurn(state, 3);
const effectIndex = state.hand.findIndex((card) => card.id === "EFFECT");
assert.ok(effectIndex >= 0);
const play = playTowerCard(state, effectIndex);
assert.equal(state.exam.stamina, 18);
assert.equal(state.exam.parameter, 8);
assert.equal(state.exam.block, 4);
assert.equal(state.playsRemaining, 1);
assert.match(play.effects.join(" / "), /パラメータ \+8/);
assert.equal(state.discard.some((card) => card.id === "EFFECT"), true);
'''
marker = '\nconsole.log("tower runtime tests: ok");\n'
if marker not in test:
    raise RuntimeError("tower runtime test marker not found")
test = test.replace(marker, insert + marker, 1)
test_path.write_text(test, encoding="utf-8")


# --- CI: syntax-check and execute the new tests. ---
ci_path = ROOT / ".github" / "workflows" / "ci.yml"
ci = ci_path.read_text(encoding="utf-8")
if "node --check web/exam_effects_v7.js" not in ci:
    ci = ci.replace("          node --check web/engine.js\n", "          node --check web/engine.js\n          node --check web/exam_effects_v7.js\n", 1)
if "Exam effect tests" not in ci:
    ci = ci.replace(
        "      - name: Tower runtime tests\n        run: node test_tower_runtime.mjs\n",
        "      - name: Tower runtime tests\n        run: node test_tower_runtime.mjs\n      - name: Exam effect tests\n        run: |\n          node test_exam_effects_v7.mjs\n          node test_card_master_effects.mjs\n",
        1,
    )
ci_path.write_text(ci, encoding="utf-8")

print("exam effects v7 patch applied")
