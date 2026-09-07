export const UINT32_MASK = 0xffffffffn;

function normalizedKey(key) {
  return String(key).replace(/[_\-\s]/g, "").toLowerCase();
}

export function getField(object, ...names) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;
  const wanted = new Set(names.map(normalizedKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function hasField(object, ...names) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  const wanted = new Set(names.map(normalizedKey));
  return Object.keys(object).some((key) => wanted.has(normalizedKey(key)));
}

export function parseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch (error) {
    throw new Error(`JSONを読み取れません: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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

export function normalizeProduceCard(card, extra = {}) {
  if (typeof card === "string" || typeof card === "number") {
    return { id: String(card), fixedDeckOrder: 0, ...extra };
  }
  if (!card || typeof card !== "object") throw new Error("カードデータの形式が不正です。");
  const id = getField(card, "id", "produceCardId");
  if (id === undefined || id === null || String(id) === "") throw new Error("カードIDがないカードがあります。");
  const fixedRaw = getField(card, "fixedDeckOrder") ?? 0;
  const fixedDeckOrder = Number(fixedRaw);
  if (!Number.isInteger(fixedDeckOrder)) throw new Error(`カード ${id}: FixedDeckOrder が整数ではありません。`);
  return {
    id: String(id),
    fixedDeckOrder,
    upgradeCount: Number(getField(card, "upgradeCount") ?? 0),
    customizes: getField(card, "customizes") ?? [],
    ...extra,
  };
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

export function simulateCards(cards, seedInput, drawCount = 5) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で入力してください。");
  if (!Array.isArray(cards) || !cards.length) throw new Error("カードを1枚以上指定してください。");
  const result = shuffleDeck(cards.map((card) => normalizeProduceCard(card, { source: card.source })), seed);
  return {
    seed,
    initialDeck: result.cards,
    draw: result.cards.slice(0, count),
    remainingDeck: result.cards.slice(count),
    randomState: result.randomState,
    fixedOrder: result.fixedOrder,
  };
}

export function simulateDistribution(deckText, seedText, drawCount) {
  return simulateCards(parseDeck(deckText), seedText, drawCount);
}

function walkJson(root, visit) {
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    visit(value);
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push(value[i]);
    } else {
      for (const child of Object.values(value)) stack.push(child);
    }
  }
}

function findSituation(payload) {
  if (payload && typeof payload === "object" && Array.isArray(getField(payload, "stages"))) return payload;
  let found;
  walkJson(payload, (value) => {
    if (found || Array.isArray(value)) return;
    const situation = getField(value, "examContestSituation");
    if (situation && typeof situation === "object" && Array.isArray(getField(situation, "stages"))) found = situation;
  });
  return found;
}

function sectionPlayers(sections, side, stageIndex) {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section, sectionIndex) => {
    const player = getField(section, "player");
    if (!player || typeof player !== "object") return [];
    const seedRaw = getField(player, "seed");
    const produceCardsRaw = getField(player, "produceCards");
    if (seedRaw === undefined || !Array.isArray(produceCardsRaw)) return [];
    const seed = Number(BigInt(String(seedRaw)) & UINT32_MASK) >>> 0;
    const cards = produceCardsRaw.map((card) => normalizeProduceCard(card));
    return [{
      key: `${side}-${stageIndex}-${sectionIndex}`,
      side,
      stageIndex,
      sectionIndex,
      seed,
      cards,
      characterId: getField(player, "characterId"),
      idolCardId: getField(player, "idolCardId"),
      examEffectType: getField(player, "examEffectType"),
    }];
  });
}

export function extractStartPlayers(payload) {
  const situation = findSituation(payload);
  if (!situation) throw new Error("ExamContestSituation が見つかりません。");
  const stages = getField(situation, "stages");
  const players = [];
  stages.forEach((stage, stageIndex) => {
    players.push(...sectionPlayers(getField(stage, "selfSections"), "self", stageIndex));
    players.push(...sectionPlayers(getField(stage, "rivalSections"), "rival", stageIndex));
  });
  if (!players.length) throw new Error("Seed と ProduceCards を持つ Player が見つかりません。");
  return players;
}

export function simulateStartPlayer(payload, playerKey, drawCount = 5) {
  const players = extractStartPlayers(payload);
  const player = players.find((item) => item.key === playerKey) ?? players[0];
  return { player, ...simulateCards(player.cards, player.seed, drawCount) };
}

function normalizeMemoryCandidate(candidate) {
  let wrapper = candidate;
  let memory = candidate;
  const wrapped = getField(candidate, "memory");
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) memory = wrapped;
  const userMemoryId = getField(memory, "userMemoryId");
  if (userMemoryId === undefined || userMemoryId === null || String(userMemoryId) === "") return null;

  const rawCards = getField(memory, "examBattleProduceCards");
  const hasActiveProduceCardIds = hasField(wrapper, "activeProduceCardIds") || hasField(memory, "activeProduceCardIds");
  const activeIdsRaw = getField(wrapper, "activeProduceCardIds") ?? getField(memory, "activeProduceCardIds") ?? [];
  const activeIds = Array.isArray(activeIdsRaw) ? activeIdsRaw.map(String) : [];
  const cardList = Array.isArray(rawCards) ? rawCards.map((card) => normalizeProduceCard(card)) : [];
  const byId = new Map(cardList.map((card) => [card.id, card]));
  const activeCards = activeIds.map((id) => ({ ...(byId.get(id) ?? { id, fixedDeckOrder: 0 }), sourceMemoryId: String(userMemoryId) }));

  const userIdText = String(userMemoryId);
  const explicitName = getField(memory, "name", "memoryName", "displayName");
  const idolCardId = getField(memory, "idolCardId");
  const label = explicitName
    ? String(explicitName)
    : `${idolCardId ? `Idol ${idolCardId} · ` : ""}${userIdText.length > 10 ? `…${userIdText.slice(-8)}` : userIdText}`;

  return {
    userMemoryId: userIdText,
    label,
    idolCardId: idolCardId === undefined ? null : String(idolCardId),
    hasActiveProduceCardIds,
    activeProduceCardIds: activeIds,
    examBattleProduceCards: cardList,
    activeCards,
    raw: memory,
  };
}

export function extractMemories(payload) {
  const candidates = [];
  walkJson(payload, (value) => {
    if (Array.isArray(value)) return;
    const memory = getField(value, "memory");
    const directId = getField(value, "userMemoryId");
    if (directId !== undefined || (memory && getField(memory, "userMemoryId") !== undefined)) candidates.push(value);
  });
  const byId = new Map();
  for (const candidate of candidates) {
    const memory = normalizeMemoryCandidate(candidate);
    if (!memory) continue;
    const old = byId.get(memory.userMemoryId);
    if (!old || (!old.hasActiveProduceCardIds && memory.hasActiveProduceCardIds)) byId.set(memory.userMemoryId, memory);
  }
  return [...byId.values()];
}

function collectTopLevelBaseCards(payload) {
  const direct = getField(payload, "baseProduceCards", "defaultProduceCards", "embedProduceCards");
  if (!Array.isArray(direct)) return [];
  return direct.map((card) => normalizeProduceCard(card, { source: "default" }));
}

function hasBaseCardField(payload) {
  return hasField(payload, "baseProduceCards", "defaultProduceCards", "embedProduceCards");
}

export function composeMemoryDeck(payload, selectedMemoryIds) {
  const memories = extractMemories(payload);
  const ids = selectedMemoryIds.map(String);
  if (ids.length < 2 || ids.length > 3) throw new Error("メモリーは2枚または3枚選択してください。");
  if (new Set(ids).size !== ids.length) throw new Error("同じメモリーを複数の枠に選択できません。");
  const selected = ids.map((id) => memories.find((memory) => memory.userMemoryId === id));
  if (selected.some((memory) => !memory)) throw new Error("選択したメモリーが入力データにありません。");
  const missingActive = selected.filter((memory) => !memory.hasActiveProduceCardIds);
  if (missingActive.length) {
    throw new Error(`ActiveProduceCardIds がないメモリーがあります: ${missingActive.map((m) => m.label).join(" / ")}`);
  }

  if (!hasBaseCardField(payload)) {
    throw new Error("baseProduceCards がありません。空の場合も baseProduceCards: [] を明示してください。");
  }

  const cards = [];
  selected.forEach((memory, index) => {
    const role = index === 0 ? "main" : `sub${index}`;
    for (const card of memory.activeCards) cards.push({ ...card, source: `${role}: ${memory.label}` });
  });
  cards.push(...collectTopLevelBaseCards(payload));
  if (!cards.length) throw new Error("選択したメモリーから有効カードを取得できませんでした。");
  return { memories: selected, cards, hasBaseCards: collectTopLevelBaseCards(payload).length > 0 };
}

export function simulateMemorySelection(payload, selectedMemoryIds, seedInput, drawCount = 5) {
  const composition = composeMemoryDeck(payload, selectedMemoryIds);
  return { composition, ...simulateCards(composition.cards, seedInput, drawCount) };
}
