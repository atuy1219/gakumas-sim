from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:180]}")
    p.write_text(text.replace(old, new, 1))


# 1) Preserve the native card order of each UserMemory regardless of checkbox click order.
replace_exact(
    "web/engine.js",
    '''    const activeIds = Array.isArray(selection.activeProduceCardIds)
      ? selection.activeProduceCardIds.map(String)
      : memory.activeProduceCardIds;
    if (!activeIds.length) throw new Error(`${memory.label}: 有効カードを1枚以上選択してください。`);
    const byId = new Map(memory.examBattleProduceCards.map((card) => [card.id, card]));
    const activeCards = activeIds.map((id) => {
      const card = byId.get(id);
      if (!card) throw new Error(`${memory.label}: カード ${id} はこのメモリーにありません。`);
      return card;
    });
    return { memory, activeIds, activeCards };''',
    '''    const requestedActiveIds = Array.isArray(selection.activeProduceCardIds)
      ? selection.activeProduceCardIds.map(String)
      : memory.activeProduceCardIds.map(String);
    if (!requestedActiveIds.length) throw new Error(`${memory.label}: 有効カードを1枚以上選択してください。`);
    const byId = new Map(memory.examBattleProduceCards.map((card) => [String(card.id), card]));
    for (const id of requestedActiveIds) {
      if (!byId.has(id)) throw new Error(`${memory.label}: カード ${id} はこのメモリーにありません。`);
    }
    const activeIdSet = new Set(requestedActiveIds);
    // Fisher–Yates の入力順は UI でチェックした順ではなく、UserMemory が持つ
    // examBattleProduceCards のネイティブ順を必ず使う。
    const activeCards = memory.examBattleProduceCards.filter((card) => activeIdSet.has(String(card.id)));
    const activeIds = activeCards.map((card) => String(card.id));
    return { memory, activeIds, activeCards };'''
)

# 2) Prefer the richest/latest snapshot when Frida logs repeated merges for one memory.
replace_exact(
    "web/engine.js",
    '''export function extractMemories(payload) {
  const candidates = [];''',
    '''function memoryCompletenessScore(memory) {
  const raw = memory?.raw ?? {};
  let score = (memory?.examBattleProduceCards?.length ?? 0) * 10;
  if (memory?.hasActiveProduceCardIds) score += 1000;
  for (const field of [
    "idolCardId", "characterId", "planType", "power", "grade",
    "vocal", "dance", "visual", "stamina", "examBattleProduceItemIds",
  ]) {
    if (hasField(raw, field)) score += 5;
  }
  const pitems = getField(raw, "examBattleProduceItemIds");
  if (Array.isArray(pitems)) score += pitems.length;
  return score;
}

export function extractMemories(payload) {
  const candidates = [];'''
)
replace_exact(
    "web/engine.js",
    '''    const old = byId.get(memory.userMemoryId);
    const score = (item) => item.examBattleProduceCards.length * 10 + (item.hasActiveProduceCardIds ? 1000 : 0);
    if (!old || score(memory) > score(old)) byId.set(memory.userMemoryId, memory);''',
    '''    const old = byId.get(memory.userMemoryId);
    // 同点なら後から観測したスナップショットを採用する。InternalMergeFrom は
    // 同一 UserMemory を段階的に埋めることがあるため、最初の断片を固定しない。
    if (!old || memoryCompletenessScore(memory) >= memoryCompletenessScore(old)) {
      byId.set(memory.userMemoryId, memory);
    }'''
)

# 3) Frida exporter: do not discard every later snapshot of the same UserMemory.
replace_exact(
    "tools/frida/export_memories.js",
    "const exportedIds = new Set();",
    "const exportedSnapshots = new Map();"
)
replace_exact(
    "tools/frida/export_memories.js",
    '''        const userMemoryId = String(memory.userMemoryId ?? '');
        if (!userMemoryId || exportedIds.has(userMemoryId)) return;
        exportedIds.add(userMemoryId);
        console.log(OUTPUT_PREFIX + JSON.stringify(memory));''',
    '''        const userMemoryId = String(memory.userMemoryId ?? '');
        if (!userMemoryId) return;
        const snapshot = JSON.stringify(memory);
        if (exportedSnapshots.get(userMemoryId) === snapshot) return;
        exportedSnapshots.set(userMemoryId, snapshot);
        // InternalMergeFrom は同じオブジェクトを複数回更新する。後続の完全な
        // スナップショットも出力し、Web 側で最も情報量の多いものを採用する。
        console.log(OUTPUT_PREFIX + snapshot);'''
)

# 4) Tower is memory cards + basic cards. Remove the generic initial-deck model from tower.
replace_exact(
    "web/app_v3.js",
    '''function automaticBaseCards(mode) {
  const ids = simIds(mode);
  const selectedId = $(ids.initialId).value.trim();
  let deck = selectedId ? catalogs.initialDeckById.get(selectedId) : null;
  if (mode === "contest" && $("contest-initial-auto").checked) {''',
    '''function automaticBaseCards(mode) {
  // アイドルへの道はメモリー以外に加えるのは基本カードだけ。
  // 汎用の ExamInitialDeck をドル道へ混ぜない。
  if (mode === "tower") return [];
  const ids = simIds(mode);
  const selectedId = $(ids.initialId)?.value.trim() ?? "";
  let deck = selectedId ? catalogs.initialDeckById.get(selectedId) : null;
  if (mode === "contest" && $("contest-initial-auto").checked) {'''
)
replace_exact(
    "web/app_v3.js",
    '''for (const mode of ["contest", "tower"]) {
  $(simIds(mode).count).addEventListener("change", () => renderSimBuilder(mode));
  $(simIds(mode).initialId).addEventListener("change", () => {
    renderBaseCards(mode);
    if (mode === "tower") renderObservationButtons();
  });
  $(`${mode}-add-base`).addEventListener("click", () => addBaseCard(mode));
}''',
    '''for (const mode of ["contest", "tower"]) {
  $(simIds(mode).count).addEventListener("change", () => renderSimBuilder(mode));
  const initialIdInput = $(simIds(mode).initialId);
  initialIdInput?.addEventListener("change", () => {
    renderBaseCards(mode);
    if (mode === "tower") renderObservationButtons();
  });
  $(`${mode}-add-base`).addEventListener("click", () => addBaseCard(mode));
}'''
)

replace_exact(
    "web/index.html",
    '''        <div class="sim-config-grid">
          <label><span>メモリー枚数</span><select id="tower-memory-count"><option value="2">2枚</option><option value="3" selected>3枚</option><option value="4">4枚</option></select></label>
          <label><span>初期デッキID</span><input id="tower-initial-id" list="initial-deck-options" placeholder="対象ステージのinitial_deck-..."></label>
        </div>
        <p class="hint">アイドルへの道の初期デッキ対応は自動推測しません。対象ステージで確認できるIDを指定するか、下でカードを追加してください。</p>''',
    '''        <div class="sim-config-grid">
          <label><span>メモリー枚数</span><select id="tower-memory-count"><option value="2">2枚</option><option value="3" selected>3枚</option><option value="4">4枚</option></select></label>
        </div>
        <p class="hint">アイドルへの道のデッキは、選択したメモリーの採用カードと下で指定する基本カードだけで構成します。</p>'''
)
replace_exact(
    "web/index.html",
    '''        <div class="base-deck-box">
          <h3>追加の初期 / 共通カード</h3>
          <div id="tower-base-list" class="chip-list"></div>
          <div class="inline-add"><input id="tower-base-input" list="produce-card-options" placeholder="カード名を入力または選択"><button id="tower-add-base" type="button" class="secondary compact">追加</button></div>
        </div>''',
    '''        <div class="base-deck-box">
          <h3>基本カード</h3>
          <div id="tower-base-list" class="chip-list"></div>
          <div class="inline-add"><input id="tower-base-input" list="produce-card-options" placeholder="ドル道で追加される基本カードを選択"><button id="tower-add-base" type="button" class="secondary compact">追加</button></div>
          <p class="hint">メモリー以外の任意カードやコンテスト用初期デッキはここには追加しません。</p>
        </div>'''
)

# 5) Missing historical stats must not be presented as real zero values.
replace_exact(
    "web/app_v6.js",
    '''function memoryStatsText(memory) {
  const grade = gradeLabel(memory?.grade);
  const parts = [];
  if (grade !== "未指定") parts.push(`評価 ${grade}`);
  if (numberField(memory, "power")) parts.push(`総合力 ${numberField(memory, "power")}`);
  parts.push(
    `Vo ${numberField(memory, "vocal")}`,
    `Da ${numberField(memory, "dance")}`,
    `Vi ${numberField(memory, "visual")}`,
    `体力 ${numberField(memory, "stamina")}`,
  );
  return parts.join(" · ");
}''',
    '''export function hasUsableMemoryStats(memory) {
  const values = ["vocal", "dance", "visual", "stamina"].map((name) => memory?.[name]);
  if (values.some((value) => value !== null && value !== undefined && Number(value) !== 0)) return true;
  // 総合力があるのに4能力がすべて0なら、旧exporterで途中スナップショットを
  // 保存した可能性が高い。実値0とは断定せず未取得として扱う。
  return numberField(memory, "power") === 0;
}

function memoryStatsText(memory) {
  const grade = gradeLabel(memory?.grade);
  const parts = [];
  if (grade !== "未指定") parts.push(`評価 ${grade}`);
  if (numberField(memory, "power")) parts.push(`総合力 ${numberField(memory, "power")}`);
  if (!hasUsableMemoryStats(memory)) {
    parts.push("Vo 未取得", "Da 未取得", "Vi 未取得", "体力 未取得");
  } else {
    parts.push(
      `Vo ${numberField(memory, "vocal")}`,
      `Da ${numberField(memory, "dance")}`,
      `Vi ${numberField(memory, "visual")}`,
      `体力 ${numberField(memory, "stamina")}`,
    );
  }
  return parts.join(" · ");
}'''
)

# 6) Regression tests: click-order invariance and richer repeated snapshots.
test = Path("test_web.mjs")
text = test.read_text()
marker = '\nconsole.log("web parity tests: ok");\n'
if marker not in text:
    raise SystemExit("test_web marker not found")
addition = r'''

// Checkbox insertion order must never change the pre-shuffle deck order.
const orderMemory = extractMemories({ userMemoryList: [{
  userMemoryId: "order-memory",
  examBattleProduceCards: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
}] })[0];
const orderLibrary = [orderMemory, owned[0]];
const orderA = composeSelectedMemories(orderLibrary, [
  { userMemoryId: "order-memory", activeProduceCardIds: ["D", "B", "A"] },
  { userMemoryId: "owned-1", activeProduceCardIds: ["A", "B"] },
]);
const orderB = composeSelectedMemories(orderLibrary, [
  { userMemoryId: "order-memory", activeProduceCardIds: ["A", "D", "B"] },
  { userMemoryId: "owned-1", activeProduceCardIds: ["B", "A"] },
]);
assert.deepEqual(orderA.cards.map((card) => card.id), ["A", "B", "D", "A", "B"]);
assert.deepEqual(orderB.cards.map((card) => card.id), orderA.cards.map((card) => card.id));

// InternalMergeFrom may emit a partial snapshot first and a richer one later.
const repeatedSnapshots = {
  userMemoryList: [
    {
      userMemoryId: "snapshot-memory",
      power: 15744,
      examBattleProduceCards: [{ id: "S1" }, { id: "S2" }],
    },
    {
      userMemoryId: "snapshot-memory",
      idolCardId: "i_card-jsna-3-000",
      characterId: "jsna",
      planType: "ProducePlanType_Plan1",
      power: 15744,
      grade: "ResultGrade_SsPlus",
      vocal: 1876,
      dance: 1633,
      visual: 1804,
      stamina: 38,
      examBattleProduceCards: [{ id: "S1" }, { id: "S2" }],
      examBattleProduceItemIds: ["p_item-test"],
    },
  ],
};
const richer = extractMemories(repeatedSnapshots)[0];
assert.equal(richer.raw.vocal, 1876);
assert.equal(richer.raw.dance, 1633);
assert.equal(richer.raw.visual, 1804);
assert.equal(richer.raw.stamina, 38);
assert.equal(richer.raw.grade, "ResultGrade_SsPlus");
assert.deepEqual(richer.raw.examBattleProduceItemIds, ["p_item-test"]);
'''
test.write_text(text.replace(marker, addition + marker, 1))

app6_test = Path("test_app_v6.mjs")
t = app6_test.read_text()
old_import = '''import {
  findRestrictedDuplicateIds,
  hasNonZeroMemoryStats,
  resolveMemoryPItemIds,
} from "./web/app_v6.js";'''
new_import = '''import {
  findRestrictedDuplicateIds,
  hasNonZeroMemoryStats,
  hasUsableMemoryStats,
  resolveMemoryPItemIds,
} from "./web/app_v6.js";'''
if old_import not in t:
    raise SystemExit("test_app_v6 import target not found")
t = t.replace(old_import, new_import, 1)
marker2 = '\nconsole.log("app v6 tests: ok");\n'
if marker2 not in t:
    raise SystemExit("test_app_v6 marker not found")
t = t.replace(
    marker2,
    '''\nassert.equal(hasUsableMemoryStats({ power: 15744, vocal: 0, dance: 0, visual: 0, stamina: 0 }), false);\nassert.equal(hasUsableMemoryStats({ power: 15744, vocal: 100, dance: 0, visual: 0, stamina: 0 }), true);\n''' + marker2,
    1,
)
app6_test.write_text(t)

html = Path("web/index.html").read_text()
if 'id="tower-initial-id"' in html:
    raise SystemExit("tower initial deck input still exists")
if '<h3>基本カード</h3>' not in html:
    raise SystemExit("tower basic-card section missing")
