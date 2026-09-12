const TURN_TYPE_ALIASES = new Map([
  ["vo", "Vo"],
  ["vocal", "Vo"],
  ["ボーカル", "Vo"],
  ["da", "Da"],
  ["dance", "Da"],
  ["ダンス", "Da"],
  ["vi", "Vi"],
  ["visual", "Vi"],
  ["ビジュアル", "Vi"],
]);

export function normalizeTurnType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return TURN_TYPE_ALIASES.get(raw.toLowerCase()) ?? TURN_TYPE_ALIASES.get(raw) ?? null;
}

export function normalizeTurnSequenceArray(values) {
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizeTurnType(value);
    if (!normalized) throw new Error(`不明なターン属性です: ${value}`);
    result.push(normalized);
  }
  return result;
}

export function parseTurnSequence(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const tokens = source
    .replace(/[→>]/g, " ")
    .split(/[\s,，、/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return normalizeTurnSequenceArray(tokens);
}

export function formatTurnSequence(sequence) {
  return normalizeTurnSequenceArray(sequence).join(" → ");
}

// ProduceExamBattleConfig gives the total turn count and the three judging
// weights. This can determine only the allocation counts. It cannot recover
// the exact server-generated order of Vo/Da/Vi turns.
export function allocateTurnCounts(totalTurns, weights = {}) {
  const total = Math.max(0, Math.trunc(Number(totalTurns) || 0));
  const entries = [
    ["Vo", Math.max(0, Number(weights.vocal ?? weights.Vo ?? 0) || 0)],
    ["Da", Math.max(0, Number(weights.dance ?? weights.Da ?? 0) || 0)],
    ["Vi", Math.max(0, Number(weights.visual ?? weights.Vi ?? 0) || 0)],
  ];
  const sum = entries.reduce((acc, [, weight]) => acc + weight, 0);
  if (!total || sum <= 0) return { Vo: 0, Da: 0, Vi: 0 };

  const exact = entries.map(([type, weight], index) => {
    const value = total * weight / sum;
    return { type, index, value, floor: Math.floor(value), fraction: value - Math.floor(value) };
  });
  let remaining = total - exact.reduce((acc, item) => acc + item.floor, 0);
  const order = [...exact].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) order[i % order.length].floor += 1;
  return Object.fromEntries(exact.map((item) => [item.type, item.floor]));
}

export function turnTypeAt(sequence, turn) {
  const normalized = normalizeTurnSequenceArray(sequence ?? []);
  const index = Math.trunc(Number(turn) || 0) - 1;
  return index >= 0 ? normalized[index] ?? null : null;
}
