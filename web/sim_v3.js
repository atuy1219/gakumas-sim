import { XorShift32, normalizeProduceCard, simulateCards } from "./engine.js";

export const UINT32_SPACE = 0x100000000;

export function makeSimulationSeeds(count, seedBase = 0x6d2b79f5) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 1000000) {
    throw new Error("シミュレーション回数は1〜1,000,000の整数で指定してください。");
  }
  const rng = new XorShift32(Number(seedBase) >>> 0);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(rng.state >>> 0);
    rng.nextU32();
  }
  return out;
}

export function runOrderMonteCarlo(cards, count, seedBase, drawCount = 3) {
  const normalized = cards.map((card) => normalizeProduceCard(card, { source: card.source }));
  if (!normalized.length) throw new Error("デッキにカードがありません。");
  const seeds = makeSimulationSeeds(count, seedBase);
  const firstCardCounts = new Map();
  const firstHandCounts = new Map();
  const samples = [];

  for (const seed of seeds) {
    const result = simulateCards(normalized, seed, drawCount);
    const first = result.draw[0]?.id ?? "(none)";
    firstCardCounts.set(first, (firstCardCounts.get(first) ?? 0) + 1);
    const handKey = result.draw.map((card) => card.id).join(" | ");
    firstHandCounts.set(handKey, (firstHandCounts.get(handKey) ?? 0) + 1);
    if (samples.length < 20) {
      samples.push({
        seed,
        draw: result.draw.map((card) => card.id),
        order: result.initialDeck.map((card) => card.id),
        randomState: result.randomState,
      });
    }
  }

  const sortCounts = (map) => [...map.entries()]
    .map(([key, value]) => ({ key, count: value, ratio: value / seeds.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    count: seeds.length,
    seedBase: Number(seedBase) >>> 0,
    deckCount: normalized.length,
    drawCount: Number(drawCount),
    firstCard: sortCounts(firstCardCounts),
    firstHand: sortCounts(firstHandCounts),
    samples,
    scoreSupported: false,
  };
}

export function makeCardInstances(cards) {
  const seen = new Map();
  return cards.map((card, index) => {
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    return {
      id,
      ordinal,
      token: `${id}@@${ordinal}`,
      index,
      card,
    };
  });
}

export function deriveFisherYatesChoices(initialTokens, finalTokens) {
  if (!Array.isArray(initialTokens) || !Array.isArray(finalTokens) || initialTokens.length !== finalTokens.length) {
    throw new Error("初期デッキと観測順の枚数が一致しません。");
  }
  const initialSet = new Set(initialTokens);
  const finalSet = new Set(finalTokens);
  if (initialSet.size !== initialTokens.length || finalSet.size !== finalTokens.length) {
    throw new Error("内部トークンが一意ではありません。");
  }
  if (initialSet.size !== finalSet.size || [...initialSet].some((token) => !finalSet.has(token))) {
    throw new Error("観測順が初期デッキと同じカード集合ではありません。");
  }

  const work = initialTokens.slice();
  const choices = [];
  for (let n = work.length; n >= 2; n -= 1) {
    const target = finalTokens[n - 1];
    let j = -1;
    for (let i = 0; i < n; i += 1) {
      if (work[i] === target) {
        j = i;
        break;
      }
    }
    if (j < 0) throw new Error("観測順からシャッフル交換列を復元できません。");
    choices.push({ n, j });
    [work[j], work[n - 1]] = [work[n - 1], work[j]];
  }
  if (work.some((token, index) => token !== finalTokens[index])) {
    throw new Error("観測順がFisher–Yatesの置換として復元できません。");
  }
  return choices;
}

function multisetCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return counts;
}

function sameMultiset(a, b) {
  const aa = multisetCounts(a);
  const bb = multisetCounts(b);
  if (aa.size !== bb.size) return false;
  for (const [key, value] of aa) if (bb.get(key) !== value) return false;
  return true;
}

export function deriveSeedChoiceVariants(cards, observedIds, maxVariants = 64) {
  const instances = makeCardInstances(cards);
  const observed = observedIds.map((id) => String(id).trim()).filter(Boolean);
  if (observed.length !== instances.length) {
    throw new Error(`観測順はデッキ全${instances.length}枚を入力してください（現在${observed.length}枚）。`);
  }
  const initialIds = instances.map((item) => item.id);
  if (!sameMultiset(initialIds, observed)) {
    throw new Error("観測順のカード構成が現在のデッキと一致しません。重複枚数も確認してください。");
  }

  const tokensById = new Map();
  for (const instance of instances) {
    if (!tokensById.has(instance.id)) tokensById.set(instance.id, []);
    tokensById.get(instance.id).push(instance.token);
  }
  const used = new Set();
  const finalTokens = new Array(observed.length);
  const variantKeys = new Set();
  const variants = [];
  let truncated = false;

  function visit(index) {
    if (variants.length >= maxVariants) {
      truncated = true;
      return;
    }
    if (index >= observed.length) {
      const choices = deriveFisherYatesChoices(instances.map((item) => item.token), finalTokens);
      const key = choices.map((item) => `${item.n}:${item.j}`).join(",");
      if (!variantKeys.has(key)) {
        variantKeys.add(key);
        variants.push(choices);
      }
      return;
    }
    const candidates = tokensById.get(observed[index]) ?? [];
    for (const token of candidates) {
      if (used.has(token)) continue;
      used.add(token);
      finalTokens[index] = token;
      visit(index + 1);
      used.delete(token);
      if (variants.length >= maxVariants) break;
    }
  }
  visit(0);
  if (!variants.length) throw new Error("観測順からseed条件を作成できませんでした。");
  return { variants, truncated, instanceCount: instances.length };
}

export function seedIntervalFromChoices(choices) {
  if (!choices?.length) return { start: 0, end: UINT32_SPACE, size: UINT32_SPACE };
  const { n, j } = choices[0];
  const start = Math.ceil((j * UINT32_SPACE) / n);
  const end = Math.ceil(((j + 1) * UINT32_SPACE) / n);
  return { start, end, size: end - start };
}

export function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

export function seedMatchesChoices(seed, choices) {
  let state = Number(seed) >>> 0;
  for (const { n, j } of choices) {
    const mapped = Math.floor((state * n) / UINT32_SPACE);
    if (mapped !== j) return false;
    state = xorshift32(state);
  }
  return true;
}

export function scanSeedRange(choices, start, end, maxMatches = 128) {
  const out = [];
  const lo = Math.max(0, Math.trunc(Number(start)));
  const hi = Math.min(UINT32_SPACE, Math.trunc(Number(end)));
  for (let candidate = lo; candidate < hi; candidate += 1) {
    if (seedMatchesChoices(candidate, choices)) {
      out.push(candidate >>> 0);
      if (out.length >= maxMatches) break;
    }
  }
  return out;
}

export function mergeIntervals(intervals) {
  const sorted = intervals
    .map((item) => ({ start: Number(item.start), end: Number(item.end) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else out.push({ ...item });
  }
  return out.map((item) => ({ ...item, size: item.end - item.start }));
}
