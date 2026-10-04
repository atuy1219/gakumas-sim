function numberField(memory, name) {
  return Number(memory?.[name] ?? memory?.raw?.[name] ?? 0) || 0;
}

export function hasNonZeroMemoryStats(memory) {
  return ["power", "vocal", "dance", "visual", "stamina"].some((name) => numberField(memory, name) !== 0);
}

function exactPItemIds(memory) {
  const source = memory?.examBattleProduceItemIds ?? memory?.raw?.examBattleProduceItemIds;
  const ids = Array.isArray(source) ? source : [];
  return [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))];
}

export function resolveMemoryPItemIds(memory, idolById) {
  const exact = exactPItemIds(memory);
  if (exact.length) return { ids: exact, source: "memory" };
  if (!hasNonZeroMemoryStats(memory)) return { ids: [], source: "empty" };

  const idol = idolById?.get?.(String(memory?.idolCardId ?? ""));
  if (!idol) return { ids: [], source: "unresolved" };

  // UserMemoryに実戦用PアイテムIDが残っていない場合だけPアイドルのマスターを参照する。
  // 強化段階を復元できない保存データもあるため、最終側を優先しつつ「Pアイドル由来」と明示する。
  const candidates = [
    idol.afterLevelLimitProduceItemId,
    idol.afterProduceItemId,
    idol.beforeLevelLimitProduceItemId,
    idol.beforeProduceItemId,
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
  const first = candidates[0];
  return first ? { ids: [first], source: "idol" } : { ids: [], source: "unresolved" };
}

