import { XorShift32, parseSeed } from "./engine.js";

const TURN_TYPES = new Set(["Vocal", "Dance", "Visual"]);

function normalizeTurnOrder(orderInput) {
  const order = Array.isArray(orderInput) ? orderInput.map(String) : [];
  if (order.length !== 3 || new Set(order).size !== 3 || order.some((type) => !TURN_TYPES.has(type))) {
    throw new Error("審査属性順はVo・Da・Viを1回ずつ指定してください。");
  }
  return order;
}

function normalizeTurnCounts(countsInput) {
  const counts = Array.isArray(countsInput) ? countsInput.map((value) => Math.trunc(Number(value))) : [];
  if (counts.length !== 3 || counts.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("審査属性のターン数が不正です。");
  }
  return counts;
}

export function calculateTurnParameterTypesFromCounts(orderInput, countsInput, seedInput) {
  const [high, middle, low] = normalizeTurnOrder(orderInput);
  const [highCount, middleCount, lowCount] = normalizeTurnCounts(countsInput);

  const pool = [
    ...Array(highCount - 1).fill(high),
    ...Array(middleCount - 1).fill(middle),
    ...Array(lowCount - 1).fill(low),
  ];

  const rng = new XorShift32(parseSeed(seedInput));
  const result = [];
  while (pool.length) {
    result.push(pool.splice(rng.nextInt(0, pool.length), 1)[0]);
  }

  // Native ExamParameterModel fixes the final three turns to
  // 流3 -> 流2 -> 流1 after shuffling the preceding turns.
  result.push(low, middle, high);
  return result;
}

function roundToEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function calculateWeightedTurnParameterTypes(config, seedInput) {
  if (!config) throw new Error("試験設定を選択してください。");
  const limitTurn = Math.trunc(Number(config.turn ?? 0));
  if (limitTurn <= 0) return [];

  const ordered = [
    { type: "Vocal", order: 0, weight: Math.trunc(Number(config.vocal ?? 0)) },
    { type: "Dance", order: 1, weight: Math.trunc(Number(config.dance ?? 0)) },
    { type: "Visual", order: 2, weight: Math.trunc(Number(config.visual ?? 0)) },
  ].sort((a, b) => b.weight - a.weight || a.order - b.order);

  const [high, middle, low] = ordered;
  if (limitTurn <= 3) {
    return [low.type, middle.type, high.type].slice(3 - limitTurn);
  }

  const randomTurnCount = limitTurn - 3;
  const totalWeight = high.weight + middle.weight + low.weight;
  if (!totalWeight) throw new Error("Vo/Da/Vi設定値がすべて0です。");

  const highRatio = Math.fround(
    Math.fround(Math.fround(randomTurnCount) * Math.fround(high.weight))
    / Math.fround(totalWeight)
  );
  const highRandomCount = Math.ceil(highRatio);
  const remaining = randomTurnCount - highRandomCount;
  const middleLowWeight = middle.weight + low.weight;
  const middleRatio = remaining
    ? Math.fround(
        Math.fround(Math.fround(remaining) * Math.fround(middle.weight))
        / Math.fround(middleLowWeight)
      )
    : 0;
  const middleRandomCount = remaining ? roundToEven(middleRatio) : 0;
  const lowRandomCount = remaining - middleRandomCount;

  return calculateTurnParameterTypesFromCounts(
    [high.type, middle.type, low.type],
    [highRandomCount + 1, middleRandomCount + 1, lowRandomCount + 1],
    seedInput,
  );
}
