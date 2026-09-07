export const UINT32_MASK = 0xffffffffn;

export function parseSeed(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("シード値を入力してください。");
  let value;
  try {
    value = BigInt(text);
  } catch {
    throw new Error("シード値は10進数または 0x から始まる16進数で入力してください。");
  }
  return Number(value & UINT32_MASK) >>> 0;
}

export class XorShift32 {
  constructor(seed) {
    this.state = Number(seed) >>> 0;
  }

  nextU32() {
    let x = this.state >>> 0;
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    this.state = x >>> 0;
    return this.state;
  }

  nextInt(minimum, maximum) {
    minimum = Number(minimum);
    maximum = Number(maximum);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum) {
      throw new Error("乱数範囲が不正です。");
    }
    const width = maximum - minimum;
    const mapped = Number((BigInt(this.state >>> 0) * BigInt(width)) >> 32n);
    const result = minimum + mapped;
    this.nextU32();
    return result;
  }
}

export function parseDeck(text) {
  const cards = [];
  for (const [index, rawLine] of String(text ?? "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [idPart, orderPart, ...rest] = line.split(",");
    if (rest.length) throw new Error(`${index + 1}行目: 「カードID,FixedDeckOrder」の形式で入力してください。`);
    const id = idPart.trim();
    if (!id) throw new Error(`${index + 1}行目: カードIDが空です。`);
    let fixedDeckOrder = 0;
    if (orderPart !== undefined && orderPart.trim() !== "") {
      fixedDeckOrder = Number(orderPart.trim());
      if (!Number.isInteger(fixedDeckOrder)) {
        throw new Error(`${index + 1}行目: FixedDeckOrder は整数で入力してください。`);
      }
    }
    cards.push({ id, fixedDeckOrder });
  }
  if (!cards.length) throw new Error("カードを1枚以上入力してください。");
  return cards;
}

export function shuffleDeck(inputCards, seed) {
  const cards = inputCards.map((card) => ({ ...card }));
  const rng = new XorShift32(seed);
  const fixed = cards.some((card) => Number(card.fixedDeckOrder) > 0);

  if (fixed) {
    const seen = new Set();
    for (const card of cards) {
      const key = Number(card.fixedDeckOrder);
      if (seen.has(key)) {
        throw new Error("同じ FixedDeckOrder を持つカードがある固定順デッキは現在未対応です。");
      }
      seen.add(key);
    }
    cards.sort((a, b) => Number(a.fixedDeckOrder) - Number(b.fixedDeckOrder));
    return { cards, randomState: rng.state >>> 0, fixedOrder: true };
  }

  for (let n = cards.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [cards[j], cards[n - 1]] = [cards[n - 1], cards[j]];
  }
  return { cards, randomState: rng.state >>> 0, fixedOrder: false };
}

export function simulateDistribution(deckText, seedText, drawCount) {
  const seed = parseSeed(seedText);
  const deck = parseDeck(deckText);
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で入力してください。");
  const result = shuffleDeck(deck, seed);
  return {
    seed,
    initialDeck: result.cards,
    draw: result.cards.slice(0, count),
    remainingDeck: result.cards.slice(count),
    randomState: result.randomState,
    fixedOrder: result.fixedOrder,
  };
}
