from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:200]}")
    p.write_text(text.replace(old, new, 1))


# UserMemory already contains these fields; preserve them in the normalized library object.
replace_exact(
    "web/engine.js",
    '''    planType: planType ?? null,
    power,
    hasActiveProduceCardIds,''',
    '''    planType: planType ?? null,
    power,
    grade: getField(memory, "grade") ?? null,
    vocal: Number(getField(memory, "vocal") ?? 0),
    dance: Number(getField(memory, "dance") ?? 0),
    visual: Number(getField(memory, "visual") ?? 0),
    stamina: Number(getField(memory, "stamina") ?? 0),
    examBattleProduceItemIds: Array.isArray(getField(memory, "examBattleProduceItemIds"))
      ? getField(memory, "examBattleProduceItemIds").map(String)
      : [],
    hasActiveProduceCardIds,'''
)

# Existing localStorage records already retain the original UserMemory under raw.
# Read raw as a compatibility fallback so users do not have to re-import memories.
replace_exact(
    "web/app_v6.js",
    '''function numberField(memory, name) {
  return Number(memory?.[name] ?? 0) || 0;
}''',
    '''function numberField(memory, name) {
  return Number(memory?.[name] ?? memory?.raw?.[name] ?? 0) || 0;
}'''
)
replace_exact(
    "web/app_v6.js",
    '''function exactPItemIds(memory) {
  const ids = Array.isArray(memory?.examBattleProduceItemIds) ? memory.examBattleProduceItemIds : [];
  return [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))];
}''',
    '''function exactPItemIds(memory) {
  const source = memory?.examBattleProduceItemIds ?? memory?.raw?.examBattleProduceItemIds;
  const ids = Array.isArray(source) ? source : [];
  return [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))];
}'''
)
replace_exact(
    "web/app_v6.js",
    '''export function hasUsableMemoryStats(memory) {
  const values = ["vocal", "dance", "visual", "stamina"].map((name) => memory?.[name]);
  if (values.some((value) => value !== null && value !== undefined && Number(value) !== 0)) return true;
  // 総合力があるのに4能力がすべて0なら、旧exporterで途中スナップショットを
  // 保存した可能性が高い。実値0とは断定せず未取得として扱う。
  return numberField(memory, "power") === 0;
}''',
    '''export function hasUsableMemoryStats(memory) {
  const values = ["vocal", "dance", "visual", "stamina"].map((name) => numberField(memory, name));
  if (values.some((value) => value !== 0)) return true;
  return numberField(memory, "power") === 0;
}'''
)
replace_exact(
    "web/app_v6.js",
    '''  const grade = gradeLabel(memory?.grade);''',
    '''  const grade = gradeLabel(memory?.grade ?? memory?.raw?.grade);'''
)

# Regression coverage for top-level normalization and compatibility fallback.
test = Path("test_web.mjs")
text = test.read_text()
needle = '''assert.equal(richer.raw.vocal, 1876);
assert.equal(richer.raw.dance, 1633);
assert.equal(richer.raw.visual, 1804);
assert.equal(richer.raw.stamina, 38);
assert.equal(richer.raw.grade, "ResultGrade_SsPlus");
assert.deepEqual(richer.raw.examBattleProduceItemIds, ["p_item-test"]);'''
replacement = '''assert.equal(richer.raw.vocal, 1876);
assert.equal(richer.raw.dance, 1633);
assert.equal(richer.raw.visual, 1804);
assert.equal(richer.raw.stamina, 38);
assert.equal(richer.raw.grade, "ResultGrade_SsPlus");
assert.deepEqual(richer.raw.examBattleProduceItemIds, ["p_item-test"]);
assert.equal(richer.vocal, 1876);
assert.equal(richer.dance, 1633);
assert.equal(richer.visual, 1804);
assert.equal(richer.stamina, 38);
assert.equal(richer.grade, "ResultGrade_SsPlus");
assert.deepEqual(richer.examBattleProduceItemIds, ["p_item-test"]);'''
if needle not in text:
    raise SystemExit("test_web richer snapshot assertions not found")
test.write_text(text.replace(needle, replacement, 1))

app6 = Path("test_app_v6.mjs")
t = app6.read_text()
marker = '\nconsole.log("app v6 tests: ok");\n'
if marker not in t:
    raise SystemExit("test_app_v6 marker not found")
addition = '''
assert.equal(hasUsableMemoryStats({ power: 15744, raw: { vocal: 321, dance: 654, visual: 987, stamina: 42 } }), true);
assert.deepEqual(
  resolveMemoryPItemIds({
    idolCardId: "i-campus",
    power: 15744,
    raw: { examBattleProduceItemIds: ["pitem-from-raw"] },
  }, idolById),
  { ids: ["pitem-from-raw"], source: "memory" },
);
'''
app6.write_text(t.replace(marker, addition + marker, 1))
