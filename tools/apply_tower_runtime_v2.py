from pathlib import Path
import re


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:240]}")
    p.write_text(text.replace(old, new, 1))


def replace_re(path, pattern, replacement, flags=0):
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"regex replacement target count={count}: {path}\n{pattern[:240]}")
    p.write_text(new)


# ---------------------------------------------------------------------------
# Tower runtime: exact default deck by IdolCard.examEffectType and interactive
# 3-card turn simulation with discard recycle / once-only (Lost) handling.
# ---------------------------------------------------------------------------
Path("web/tower_runtime.js").write_text(r'''import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";

export const TOWER_DEFAULT_DECK_BY_EXAM_EFFECT = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "initial_deck-produce_default-parameter_buff",
  ProduceExamEffectType_ExamConcentration: "initial_deck-produce_default-concentration",
  ProduceExamEffectType_ExamLessonBuff: "initial_deck-produce_default-lesson_buff",
  ProduceExamEffectType_ExamReview: "initial_deck-produce_default-review",
  ProduceExamEffectType_ExamCardPlayAggressive: "initial_deck-produce_default-aggressive",
  ProduceExamEffectType_ExamFullPower: "initial_deck-produce_default-full_power",
});

export const TOWER_EXAM_EFFECT_LABELS = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "センス / 好調",
  ProduceExamEffectType_ExamConcentration: "センス / 集中",
  ProduceExamEffectType_ExamLessonBuff: "ロジック / やる気",
  ProduceExamEffectType_ExamReview: "ロジック / 好印象",
  ProduceExamEffectType_ExamCardPlayAggressive: "アノマリー / 強気",
  ProduceExamEffectType_ExamFullPower: "アノマリー / 全力",
});

export function resolveTowerDefaultDeck(idolCardId, idolCardById, initialDeckById) {
  const id = String(idolCardId ?? "").trim();
  if (!id) return null;
  const idol = idolCardById?.get?.(id);
  if (!idol) return null;
  const examEffectType = String(idol.examEffectType ?? "");
  const deckId = TOWER_DEFAULT_DECK_BY_EXAM_EFFECT[examEffectType];
  if (!deckId) return null;
  const deck = initialDeckById?.get?.(deckId);
  if (!deck) return null;
  return {
    idolCardId: id,
    examEffectType,
    label: TOWER_EXAM_EFFECT_LABELS[examEffectType] ?? examEffectType,
    deckId,
    cards: (deck.cards ?? []).map((card) => ({ ...card })),
  };
}

export function isOnceOnlyMove(value) {
  return String(value ?? "") === "ProduceCardMovePositionType_Lost";
}

export function isSupportedSimpleMove(value) {
  const move = String(value ?? "");
  return !move || move === "ProduceCardMovePositionType_Unknown" || move === "ProduceCardMovePositionType_Grave" || move === "ProduceCardMovePositionType_Lost";
}

function runtimeInstances(cards, cardById) {
  const seen = new Map();
  return (cards ?? []).map((raw, index) => {
    const card = normalizeProduceCard(raw, { source: raw?.source });
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    const master = cardById?.get?.(id) ?? {};
    const playMovePositionType = String(master.playMovePositionType ?? card.playMovePositionType ?? "");
    return {
      ...card,
      token: `${id}@@${ordinal}`,
      originalIndex: index,
      playMovePositionType,
      onceOnly: isOnceOnlyMove(playMovePositionType),
    };
  });
}

function shuffleObjectsWithState(input, stateInput) {
  const deck = input.map((item) => ({ ...item }));
  const rng = new XorShift32(Number(stateInput) >>> 0);
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
  }
  return { deck, randomState: rng.state >>> 0 };
}

export function createTowerTurnState(cards, seedInput, cardById = new Map()) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const instances = runtimeInstances(cards, cardById);
  if (!instances.length) throw new Error("デッキにカードがありません。");
  const initial = shuffleObjectsWithState(instances, seed);
  return {
    seed,
    randomState: initial.randomState,
    initialDeck: initial.deck.map((card) => ({ ...card })),
    deck: initial.deck.map((card) => ({ ...card })),
    discard: [],
    lost: [],
    hand: [],
    turn: 0,
    recycleCount: 0,
    history: [],
    lastRecycle: null,
  };
}

function recycleIfNeeded(state) {
  if (state.deck.length || !state.discard.length) return null;
  const source = state.discard.map((card) => ({ ...card }));
  const shuffled = shuffleObjectsWithState(state.discard, state.randomState);
  state.deck = shuffled.deck;
  state.discard = [];
  state.randomState = shuffled.randomState;
  state.recycleCount += 1;
  const event = {
    recycleCount: state.recycleCount,
    source,
    shuffled: state.deck.map((card) => ({ ...card })),
    randomState: state.randomState,
  };
  state.lastRecycle = event;
  return event;
}

export function drawTowerTurn(state, drawCount = 3) {
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  if (state.hand.length) throw new Error("現在の手札を処理してから次ターンへ進んでください。");
  state.turn += 1;
  const recycleEvents = [];
  for (let i = 0; i < count; i += 1) {
    if (!state.deck.length) {
      const event = recycleIfNeeded(state);
      if (event) recycleEvents.push(event);
    }
    if (!state.deck.length) break;
    state.hand.push(state.deck.shift());
  }
  return { turn: state.turn, hand: state.hand.map((card) => ({ ...card })), recycleEvents };
}

export function finishTowerTurn(state, action = { type: "skip" }) {
  if (!state.hand.length) throw new Error("処理する手札がありません。");
  const hand = state.hand.map((card) => ({ ...card }));
  const type = String(action?.type ?? "skip");
  let used = null;
  let onceOnly = false;

  if (type === "skip") {
    // Seed identification uses this exact rule: ResetHand sends the hand to
    // Grave in draw/hand order, with no played card branch.
    state.discard.push(...state.hand);
  } else if (type === "use") {
    const index = Number(action?.index);
    if (!Number.isInteger(index) || index < 0 || index >= state.hand.length) {
      throw new Error("使用するカード位置が不正です。");
    }
    const card = state.hand[index];
    if (!isSupportedSimpleMove(card.playMovePositionType)) {
      throw new Error(`${card.id}: 使用後移動先 ${card.playMovePositionType} は簡易カード循環シミュレーション未対応です。`);
    }
    used = { ...card };
    onceOnly = Boolean(card.onceOnly);
    if (onceOnly) state.lost.push(card);
    else state.discard.push(card);
    state.discard.push(...state.hand.filter((_, cardIndex) => cardIndex !== index));
  } else {
    throw new Error(`未知のターン操作です: ${type}`);
  }

  state.history.push({
    turn: state.turn,
    hand,
    action: type,
    used,
    onceOnly,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    lostCount: state.lost.length,
    recycleCount: state.recycleCount,
  });
  state.hand = [];
  return state.history[state.history.length - 1];
}
''')

# ---------------------------------------------------------------------------
# engine.js: load IdolCard master so the exact default deck subtype can be
# derived from the Main memory's P-idol.
# ---------------------------------------------------------------------------
replace_exact(
    "web/engine.js",
    '''export const DEFAULT_EXAM_INITIAL_DECK_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ExamInitialDeck.yaml";
''',
    '''export const DEFAULT_EXAM_INITIAL_DECK_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ExamInitialDeck.yaml";
export const DEFAULT_IDOL_CARD_CATALOG_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/IdolCard.yaml";
'''
)

replace_exact(
    "web/engine.js",
    '''export function parseExamInitialDeckYaml(text) {
''',
    '''export function parseIdolCardCatalogYaml(text) {
  const cards = [];
  let current = null;
  const flush = () => {
    if (current?.id) cards.push(current);
  };
  for (const line of String(text ?? "").split(/\\r?\\n/)) {
    let match = line.match(/^- id:\\s*(.+?)\\s*$/);
    if (match) {
      flush();
      current = { id: yamlScalar(match[1]) };
      continue;
    }
    if (!current) continue;
    match = line.match(/^  (characterId|name|planType|examEffectType|assetId):\\s*(.*?)\\s*$/);
    if (!match) continue;
    current[match[1]] = yamlScalar(match[2]);
  }
  flush();
  return cards;
}

export function parseExamInitialDeckYaml(text) {
'''
)

replace_exact(
    "web/engine.js",
    '''  const cardUrl = urls.produceCards ?? DEFAULT_PRODUCE_CARD_CATALOG_URL;
  const deckUrl = urls.initialDecks ?? DEFAULT_EXAM_INITIAL_DECK_URL;
  const [cardResponse, deckResponse] = await Promise.all([fetchImpl(cardUrl), fetchImpl(deckUrl)]);
  if (!cardResponse.ok) throw new Error(`カード名データの取得に失敗しました (${cardResponse.status})。`);
  if (!deckResponse.ok) throw new Error(`初期デッキデータの取得に失敗しました (${deckResponse.status})。`);
  const [cardText, deckText] = await Promise.all([cardResponse.text(), deckResponse.text()]);
  const cards = parseProduceCardCatalogYaml(cardText);
  const initialDecks = parseExamInitialDeckYaml(deckText);
  return {
    cards,
    cardById: new Map(cards.map((card) => [String(card.id), card])),
    initialDecks,
    initialDeckById: new Map(initialDecks.map((deck) => [String(deck.id), deck])),
  };
''',
    '''  const cardUrl = urls.produceCards ?? DEFAULT_PRODUCE_CARD_CATALOG_URL;
  const deckUrl = urls.initialDecks ?? DEFAULT_EXAM_INITIAL_DECK_URL;
  const idolUrl = urls.idolCards ?? DEFAULT_IDOL_CARD_CATALOG_URL;
  const [cardResponse, deckResponse, idolResponse] = await Promise.all([
    fetchImpl(cardUrl), fetchImpl(deckUrl), fetchImpl(idolUrl),
  ]);
  if (!cardResponse.ok) throw new Error(`カード名データの取得に失敗しました (${cardResponse.status})。`);
  if (!deckResponse.ok) throw new Error(`初期デッキデータの取得に失敗しました (${deckResponse.status})。`);
  if (!idolResponse.ok) throw new Error(`Pアイドルデータの取得に失敗しました (${idolResponse.status})。`);
  const [cardText, deckText, idolText] = await Promise.all([
    cardResponse.text(), deckResponse.text(), idolResponse.text(),
  ]);
  const cards = parseProduceCardCatalogYaml(cardText);
  const initialDecks = parseExamInitialDeckYaml(deckText);
  const idolCards = parseIdolCardCatalogYaml(idolText);
  return {
    cards,
    cardById: new Map(cards.map((card) => [String(card.id), card])),
    initialDecks,
    initialDeckById: new Map(initialDecks.map((deck) => [String(deck.id), deck])),
    idolCards,
    idolCardById: new Map(idolCards.map((idol) => [String(idol.id), idol])),
  };
'''
)

# catalog_v4.js: keep overlay catalog schema aligned.
replace_exact(
    "web/catalog_v4.js",
    '''    "planType",
    "assetId",
    "produceVocal",
''',
    '''    "planType",
    "examEffectType",
    "assetId",
    "produceVocal",
'''
)
replace_exact(
    "web/catalog_v4.js",
    '''    "noDeckDuplication",
    "isLimited",
  ])
''',
    '''    "noDeckDuplication",
    "isLimited",
    "playMovePositionType",
    "moveEffectTriggerType",
  ])
'''
)

# ---------------------------------------------------------------------------
# sim_v3.js seed identification: user always skips, so discard order is
# deterministic. Remove the incorrect played-card branching.
# ---------------------------------------------------------------------------
replace_re(
    "web/sim_v3.js",
    r'''function completedTurnDiscardOrders\(hand\) \{.*?\n\}\n\nfunction dedupeDrawBranches\(branches\) \{.*?\n\}\n\n''',
    '',
    re.S,
)
replace_exact(
    "web/sim_v3.js",
    '''export function simulateTurnRecycleDraws(cards, seed, drawCount, drawPerTurn = 3, playedIndexes = []) {
''',
    '''export function simulateTurnRecycleDraws(cards, seed, drawCount, drawPerTurn = 3) {
'''
)
replace_exact(
    "web/sim_v3.js",
    '''    if (hand.length === perTurn) {
      const requested = Number(playedIndexes?.[turnIndex] ?? 0);
      const used = Number.isInteger(requested) && requested >= 0 && requested < hand.length ? requested : 0;
      discard.push(hand[used], ...hand.filter((_, index) => index !== used));
      hand = [];
      turnIndex += 1;
    }
''',
    '''    if (hand.length === perTurn) {
      discard.push(...hand);
      hand = [];
      turnIndex += 1;
    }
'''
)
replace_re(
    "web/sim_v3.js",
    r'''export function seedMatchesObservedDraws\(seed, cards, observedIds, drawPerTurn = 3\) \{.*?\n\}\n\nexport function seedIntervalFromChoices''',
    r'''export function seedMatchesObservedDraws(seed, cards, observedIds, drawPerTurn = 3) {
  const perTurn = Number(drawPerTurn);
  const observed = (observedIds ?? []).map(String);
  const ids = makeCardInstances(cards).map((item) => item.id);
  if (!ids.length || !observed.length) return false;

  const initial = shuffleIdsWithState(ids, Number(seed) >>> 0);
  let deck = initial.deck.slice();
  let discard = [];
  let hand = [];
  let state = initial.state;

  for (const expected of observed) {
    if (!deck.length) {
      if (!discard.length) return false;
      const recycled = shuffleIdsWithState(discard, state);
      deck = recycled.deck;
      discard = [];
      state = recycled.state;
    }
    if (String(deck[0]) !== String(expected)) return false;
    hand.push(deck.shift());
    if (hand.length === perTurn) {
      // seed特定時は毎ターンスキップするため、使用カード分岐は存在しない。
      discard.push(...hand);
      hand = [];
    }
  }
  return true;
}

export function seedIntervalFromChoices''',
    re.S,
)
# turnIndex is no longer needed in simulateTurnRecycleDraws.
replace_exact("web/sim_v3.js", "  let turnIndex = 0;\n\n", "")
replace_exact("web/sim_v3.js", "      turnIndex += 1;\n", "")

# Worker mirrors deterministic skip semantics.
Path("web/seed_worker.js").write_text(r'''\'use strict\';

const UINT32_SPACE = 0x100000000;

function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

function matchesChoices(seed, choices) {
  let state = Number(seed) >>> 0;
  for (let i = 0; i < choices.length; i += 1) {
    const choice = choices[i];
    const mapped = Math.floor((state * choice.n) / UINT32_SPACE);
    if (mapped !== choice.j) return false;
    state = xorshift32(state);
  }
  return true;
}

function shuffleIds(inputIds, stateInput) {
  const deck = inputIds.slice();
  let state = Number(stateInput) >>> 0;
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = Math.floor((state * n) / UINT32_SPACE);
    const tmp = deck[j];
    deck[j] = deck[n - 1];
    deck[n - 1] = tmp;
    state = xorshift32(state);
  }
  return { deck, state };
}

function matchesObservedDraws(seed, deckIds, observedIds, drawPerTurn) {
  if (!observedIds.length) return true;
  const initial = shuffleIds(deckIds, Number(seed) >>> 0);
  let deck = initial.deck.slice();
  let discard = [];
  let hand = [];
  let state = initial.state;

  for (let observedIndex = 0; observedIndex < observedIds.length; observedIndex += 1) {
    const expected = String(observedIds[observedIndex]);
    if (!deck.length) {
      if (!discard.length) return false;
      const recycled = shuffleIds(discard, state);
      deck = recycled.deck;
      discard = [];
      state = recycled.state;
    }
    if (String(deck[0]) !== expected) return false;
    hand.push(deck.shift());
    if (hand.length === drawPerTurn) {
      discard.push(...hand);
      hand = [];
    }
  }
  return true;
}

function matches(seed, choices, deckIds, observedIds, drawPerTurn) {
  if (!matchesChoices(seed, choices)) return false;
  if (observedIds.length <= deckIds.length) return true;
  return matchesObservedDraws(seed, deckIds, observedIds, drawPerTurn);
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const choices = Array.isArray(message.choices) ? message.choices : [];
  const deckIds = Array.isArray(message.deckIds) ? message.deckIds.map(String) : [];
  const observedIds = Array.isArray(message.observedIds) ? message.observedIds.map(String) : [];
  const drawPerTurn = Math.max(1, Math.trunc(Number(message.drawPerTurn ?? 3)));
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const found = [];
  for (let candidate = start; candidate < end; candidate += 1) {
    if (matches(candidate, choices, deckIds, observedIds, drawPerTurn)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({ type: 'done', taskId: message.taskId, start, end, scanned: end - start, found });
};
'''.replace("\\'use strict\\';", "'use strict';"))

# ---------------------------------------------------------------------------
# app_v3.js: auto default cards, separate seed tab, name-based observation,
# and interactive 3-card turn simulation.
# ---------------------------------------------------------------------------
replace_exact(
    "web/app_v3.js",
    '''  resolveContestInitialDeck,
  simulateCards,
} from "./engine.js";
''',
    '''  resolveContestInitialDeck,
} from "./engine.js";
'''
)
replace_exact(
    "web/app_v3.js",
    '''import { createTowerPreset, parseTowerPreset } from "./tower_preset.js";
''',
    '''import { createTowerPreset, parseTowerPreset } from "./tower_preset.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  resolveTowerDefaultDeck,
} from "./tower_runtime.js";
'''
)
replace_exact(
    "web/app_v3.js",
    '''let catalogs = { cards: [], cardById: new Map(), initialDecks: [], initialDeckById: new Map() };
''',
    '''let catalogs = {
  cards: [], cardById: new Map(), initialDecks: [], initialDeckById: new Map(),
  idolCards: [], idolCardById: new Map(),
};
'''
)
replace_exact(
    "web/app_v3.js",
    '''let seedSearchCancelled = false;
''',
    '''let seedSearchCancelled = false;
let towerTurnState = null;
'''
)
replace_exact(
    "web/app_v3.js",
    '''  history.replaceState(null, "", `${location.pathname}?tab=${encodeURIComponent(name)}`);
}
''',
    '''  history.replaceState(null, "", `${location.pathname}?tab=${encodeURIComponent(name)}`);
  if (name === "seed") {
    renderObservationButtons();
    updateObservationCount();
  }
}
'''
)
replace_exact(
    "web/app_v3.js",
    '''    $("catalog-status").textContent = `カード名 ${catalogs.cards.length}件 / 初期デッキ ${catalogs.initialDecks.length}件`;
''',
    '''    $("catalog-status").textContent = `カード名 ${catalogs.cards.length}件 / 初期デッキ ${catalogs.initialDecks.length}件 / Pアイドル ${catalogs.idolCards.length}件`;
'''
)

replace_re(
    "web/app_v3.js",
    r'''function automaticBaseCards\(mode\) \{.*?\n\}\n\nfunction baseCards\(mode\) \{.*?\n\}\n''',
    r'''function towerDefaultDeckResolution() {
  const main = ensureSlots("tower")[0];
  if (!main?.memoryId) return null;
  const memory = memoryList.find((item) => item.userMemoryId === main.memoryId);
  if (!memory?.idolCardId) return null;
  return resolveTowerDefaultDeck(memory.idolCardId, catalogs.idolCardById, catalogs.initialDeckById);
}

function automaticBaseCards(mode) {
  if (mode === "tower") {
    const resolved = towerDefaultDeckResolution();
    return resolved ? resolved.cards.map((card) => ({ ...card, source: `tower default: ${resolved.deckId}` })) : [];
  }
  const ids = simIds(mode);
  const selectedId = $(ids.initialId)?.value.trim() ?? "";
  let deck = selectedId ? catalogs.initialDeckById.get(selectedId) : null;
  if (mode === "contest" && $("contest-initial-auto").checked) {
    const main = ensureSlots(mode)[0];
    const memory = main ? memoryList.find((item) => item.userMemoryId === main.memoryId) : null;
    if (memory?.idolCardId) deck = resolveContestInitialDeck(memory.idolCardId, catalogs.initialDeckById) ?? deck;
  }
  return deck ? deck.cards.map((card) => ({ ...card, source: `initial: ${deck.id}` })) : [];
}

function baseCards(mode) {
  if (mode === "tower") return automaticBaseCards(mode);
  return [...automaticBaseCards(mode), ...simState[mode].baseCards];
}
''',
    re.S,
)
replace_exact(
    "web/app_v3.js",
    '''  const manual = simState[mode].baseCards;
''',
    '''  const manual = mode === "tower" ? [] : simState[mode].baseCards;
'''
)
replace_exact(
    "web/app_v3.js",
    '''    hint.textContent = "初期/共通カード未設定";
''',
    '''    hint.textContent = mode === "tower" ? "MainのPアイドルを選択すると基本カードを自動追加します" : "初期/共通カード未設定";
'''
)
replace_exact(
    "web/app_v3.js",
    '''function buildComposition(mode) {
  return composeSelectedMemories(
    memoryList,
    selectedMemoryComposition(mode),
    baseCards(mode),
    mode === "tower" ? 4 : 3,
  );
}
''',
    '''function buildComposition(mode) {
  const selected = selectedMemoryComposition(mode);
  const extras = baseCards(mode);
  if (mode === "tower" && catalogs.idolCards.length && !extras.length) {
    const main = memoryList.find((item) => item.userMemoryId === selected[0]?.userMemoryId);
    throw new Error(`${main?.label ?? "Main"}: Pアイドルのタイプからドル道の基本カードを特定できません。`);
  }
  return composeSelectedMemories(
    memoryList,
    selected,
    extras,
    mode === "tower" ? 4 : 3,
  );
}
'''
)
replace_exact(
    "web/app_v3.js",
    '''  $(`${mode}-add-base`).addEventListener("click", () => addBaseCard(mode));
''',
    '''  $(`${mode}-add-base`)?.addEventListener("click", () => addBaseCard(mode));
'''
)
# Ignore legacy manually stored tower basic cards on import; current deck is derived.
replace_re(
    "web/app_v3.js",
    r'''  simState\.tower\.baseCards = preset\.baseCards\.map\(\(card\) => \(\{.*?\n  \}\)\);''',
    '''  simState.tower.baseCards = [];''',
    re.S,
)
# Export derived decks, not stale manual copies.
replace_exact(
    "web/app_v3.js",
    '''      baseCards: simState.tower.baseCards.map((card) => ({
        id: String(card.id),
        upgradeCount: Number(card.upgradeCount ?? 0),
        fixedDeckOrder: Number(card.fixedDeckOrder ?? 0),
        customizes: Array.isArray(card.customizes) ? card.customizes : [],
      })),
''',
    '''      baseCards: [],
'''
)

# Replace old static tower order preview with interactive turn simulator.
replace_re(
    "web/app_v3.js",
    r'''function renderTowerOrder\(result\) \{.*?\n\$\("tower-run"\)\.addEventListener\("click", \(\) => \{.*?\n\}\);\n\nfunction observedLines''',
    r'''function runtimeCardLabel(card) {
  return observationCardLabel(catalogName(card), Number(card?.upgradeCount ?? 0));
}

function renderTowerTurnState() {
  const box = $("tower-turn-result");
  if (!box) return;
  box.hidden = !towerTurnState;
  if (!towerTurnState) return;

  $("tower-turn-meta").textContent = `Turn ${towerTurnState.turn} · 山札 ${towerTurnState.deck.length} · 捨て札 ${towerTurnState.discard.length} · 除外 ${towerTurnState.lost.length} · 再シャッフル ${towerTurnState.recycleCount}回 · RNG ${asHex(towerTurnState.randomState)}`;
  const handBox = $("tower-turn-hand");
  handBox.innerHTML = "";
  towerTurnState.hand.forEach((card, index) => {
    const article = document.createElement("article");
    article.className = "tower-turn-card-v7";
    const title = document.createElement("strong");
    title.textContent = runtimeCardLabel(card);
    const detail = document.createElement("small");
    detail.textContent = card.onceOnly ? "レッスン中1回 · 使用すると除外" : "使用後は捨て札";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "secondary compact";
    use.textContent = "このカードを使用";
    use.addEventListener("click", () => advanceTowerTurn({ type: "use", index }));
    article.append(title, detail, use);
    handBox.append(article);
  });

  const history = $("tower-turn-history");
  history.innerHTML = "";
  for (const entry of [...towerTurnState.history].reverse()) {
    const li = document.createElement("li");
    const names = entry.hand.map(runtimeCardLabel).join(" / ");
    const action = entry.action === "skip"
      ? "スキップ"
      : `使用: ${runtimeCardLabel(entry.used)}${entry.onceOnly ? "（除外）" : ""}`;
    li.textContent = `Turn ${entry.turn}: ${names} → ${action}`;
    history.append(li);
  }
}

function advanceTowerTurn(action) {
  try {
    clearError();
    finishTowerTurn(towerTurnState, action);
    drawTowerTurn(towerTurnState, 3);
    renderTowerTurnState();
  } catch (error) {
    showError(error);
  }
}

$("tower-run").addEventListener("click", () => {
  try {
    clearError();
    const composition = buildComposition("tower");
    towerTurnState = createTowerTurnState(composition.cards, $("tower-seed").value, catalogs.cardById);
    drawTowerTurn(towerTurnState, 3);
    renderTowerTurnState();
  } catch (error) {
    towerTurnState = null;
    $("tower-turn-result").hidden = true;
    showError(error);
  }
});
$("tower-skip-turn").addEventListener("click", () => {
  if (towerTurnState) advanceTowerTurn({ type: "skip" });
});

function observedLines''',
    re.S,
)

# Name, not p_card ID, is written into the observation textarea.
replace_exact(
    "web/app_v3.js",
    '''      lines.push(instance.id);
''',
    '''      lines.push(observationCardName(instance.card));
'''
)

# Seed candidate selection now only fills the simulator seed field.
replace_re(
    "web/app_v3.js",
    r'''    button\.addEventListener\("click", \(\) => \{\n      \$\("tower-seed"\)\.value = String\(seed\);\n      try \{\n        renderTowerOrder\(simulateCards\(buildComposition\("tower"\)\.cards, seed, Number\(\$\("tower-draw-count"\)\.value\)\)\);\n      \} catch \(error\) \{ showError\(error\); \}\n    \}\);''',
    '''    button.addEventListener("click", () => {
      $("tower-seed").value = String(seed);
    });''',
)
replace_re(
    "web/app_v3.js",
    r'''    if \(complete && result\.length === 1\) \{\n      \$\("tower-seed"\)\.value = String\(result\[0\]\);\n      renderTowerOrder\(simulateCards\(composition\.cards, result\[0\], Number\(\$\("tower-draw-count"\)\.value\)\)\);\n    \}''',
    '''    if (complete && result.length === 1) {
      $("tower-seed").value = String(result[0]);
    }''',
)
replace_exact(
    "web/app_v3.js",
    '''activateTab(["memory", "contest", "tower"].includes(tabParam) ? tabParam : "memory");
''',
    '''activateTab(["memory", "cards", "items", "contest", "tower", "seed"].includes(tabParam) ? tabParam : "memory");
'''
)

# ---------------------------------------------------------------------------
# index.html: Seed identification gets its own tab. Tower base cards are
# automatic. Step 02 becomes interactive turn simulation.
# ---------------------------------------------------------------------------
replace_exact(
    "web/index.html",
    '''      <button type="button" class="app-tab" data-tab="tower">アイドルへの道シミュ</button>
''',
    '''      <button type="button" class="app-tab" data-tab="tower">アイドルへの道シミュ</button>
      <button type="button" class="app-tab" data-tab="seed">seed特定</button>
'''
)
replace_exact(
    "web/index.html",
    '''        <p class="hint">アイドルへの道のデッキは、選択したメモリーの採用カードと下で指定する基本カードだけで構成します。</p>
''',
    '''        <p class="hint">アイドルへの道のデッキは、選択メモリーの採用カード + MainのPアイドルのタイプに対応する公式初期デッキ8枚で構成します。</p>
'''
)
replace_re(
    "web/index.html",
    r'''        <div class="base-deck-box">\n          <h3>基本カード</h3>.*?        </div>''',
    '''        <div class="base-deck-box">
          <h3>自動追加される基本カード</h3>
          <div id="tower-base-list" class="chip-list"></div>
          <p class="hint">Pアイドルの examEffectType（好調 / 集中 / やる気 / 好印象 / 強気 / 全力）から公式の8枚初期デッキを自動選択します。</p>
        </div>''',
    re.S,
)
replace_re(
    "web/index.html",
    r'''      <section class="panel">\n        <div class="section-head"><div><p class="step">02</p><h2>seed指定でカード順を確認</h2>.*?      </section>''',
    '''      <section class="panel">
        <div class="section-head"><div><p class="step">02</p><h2>ターン単位カード循環シミュレーション</h2></div></div>
        <div class="sim-config-grid">
          <label><span>Seed</span><input id="tower-seed" value="0x12345678" inputmode="text" spellcheck="false"></label>
        </div>
        <p class="callout">毎ターン3枚を実際にドローし、カードを1枚使用するかスキップして次ターンへ進めます。通常カードは捨て札へ、「レッスン中1回」のカードは<strong>使用した場合だけ除外</strong>されます。山札が空なら、その時点の捨て札だけを同じ乱数状態の続きで再シャッフルします。カード効果そのものはこの画面では計算しません。</p>
        <button id="tower-run" type="button" class="primary">シミュレーション開始 / リセット</button>
        <div id="tower-turn-result" class="simulation-result" hidden>
          <p id="tower-turn-meta" class="hint"></p>
          <div id="tower-turn-hand" class="tower-turn-hand-v7"></div>
          <button id="tower-skip-turn" type="button" class="secondary">このターンをスキップ</button>
          <h3>履歴</h3>
          <ol id="tower-turn-history" class="tower-turn-history-v7"></ol>
        </div>
      </section>''',
    re.S,
)

# Extract seed panel from tower and reinsert as independent tab.
html_path = Path("web/index.html")
html = html_path.read_text()
seed_match = re.search(
    r'''      <section class="panel">\n        <div class="section-head"><div><p class="step">03</p><h2>実機の順番からseedを探索</h2>.*?      </section>\n(?=    </section>\n  </main>)''',
    html,
    re.S,
)
if not seed_match:
    raise SystemExit("seed panel not found in index.html")
seed_panel = seed_match.group(0)
html = html[:seed_match.start()] + html[seed_match.end():]
seed_panel = seed_panel.replace('<p class="step">03</p>', '<p class="step">SEED</p>', 1)
seed_panel = seed_panel.replace(
    '実機で見えた<strong>3枚ずつの連続ドロー順</strong>から32-bit seed候補を逆算します。最初のデッキ枚数分で初期シャッフルを特定し、それ以降は「山札が空の状態で次の1枚を引く瞬間に、その時点の捨て札だけをseedの続きで再シャッフルする」挙動を再現して候補を絞ります。使用カードが通常どおり捨て札へ行く場合は、各ターンで3枚のどれを使ったかも内部で候補分岐します。',
    'アイドルへの道シミュで設定した編成を使い、実機で見えた<strong>3枚ずつの連続ドロー順</strong>から32-bit seed候補を逆算します。seed特定時は毎ターンスキップする前提なので、3枚の手札はそのまま捨て札へ移動します。山札が空の状態で次の1枚を引く瞬間に、その時点の捨て札だけをseedの続きで再シャッフルします。',
)
seed_tab = '''\n    <section id="tab-seed" class="tab-panel section-stack" hidden>\n''' + seed_panel + '''    </section>\n'''
html = html.replace("  </main>\n", seed_tab + "  </main>\n", 1)
html_path.write_text(html)

# Styles for interactive turn cards.
Path("web/v7.css").write_text('''.tower-turn-hand-v7 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0;
}
.tower-turn-card-v7 {
  display: grid;
  gap: 9px;
  padding: 16px;
  border: 1px solid #e1e4e9;
  border-radius: 16px;
  background: #f7f8fa;
}
.tower-turn-card-v7 strong { overflow-wrap: anywhere; }
.tower-turn-card-v7 small { color: #737984; line-height: 1.5; }
.tower-turn-history-v7 { display: grid; gap: 7px; padding-inline-start: 24px; }
.tower-turn-history-v7 li { line-height: 1.6; }
@media (max-width: 760px) {
  .tower-turn-hand-v7 { grid-template-columns: 1fr; }
}
@media (prefers-color-scheme: dark) {
  .tower-turn-card-v7 { background: #20242b; border-color: #30353d; }
  .tower-turn-card-v7 small { color: #a9afb9; }
}
''')
replace_exact(
    "web/catalog_bootstrap.js",
    '''  for (const href of ["./v5.css", "./v6.css"]) {
''',
    '''  for (const href of ["./v5.css", "./v6.css", "./v7.css"]) {
'''
)

# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
replace_exact(
    "test_web.mjs",
    '''  parseExamInitialDeckYaml,
  parseMemoryExportText,
''',
    '''  parseExamInitialDeckYaml,
  parseIdolCardCatalogYaml,
  parseMemoryExportText,
'''
)
replace_exact(
    "test_web.mjs",
    '''const initialYaml = `- id: initial_deck-contest-i_card-test''',
    '''const idolYaml = `- id: i_card-test\n  characterId: hski\n  name: テストPアイドル\n  planType: ProducePlanType_Plan1\n  examEffectType: ProduceExamEffectType_ExamConcentration\n`;
const idolCatalog = parseIdolCardCatalogYaml(idolYaml);
assert.equal(idolCatalog[0].examEffectType, "ProduceExamEffectType_ExamConcentration");

const initialYaml = `- id: initial_deck-contest-i_card-test'''
)

# v3 seed tests: explicit skip semantics should match generated sequence.
replace_exact(
    "test_v3.mjs",
    '''// Seed 14 yields a case where the 12th draw is the same physical card ID as
// the 6th draw. This is only possible because draw #12 happens after the
// first recycle while draw #10/#11 are still the current hand and therefore
// are excluded from the recycle source.
''',
    '''// Seed identification always skips. Seed 14 yields a case where draw #12
// happens after recycling only the first three completed 3-card hands. The
// current hand's draw #10/#11 is not part of the recycle source.
'''
)

Path("test_tower_runtime.mjs").write_text(r'''import assert from "node:assert/strict";
import {
  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  isOnceOnlyMove,
  resolveTowerDefaultDeck,
} from "./web/tower_runtime.js";

const initialDeckById = new Map([
  ["initial_deck-produce_default-concentration", {
    id: "initial_deck-produce_default-concentration",
    cards: Array.from({ length: 8 }, (_, i) => ({ id: `B${i + 1}`, upgradeCount: 0 })),
  }],
]);
const idolCardById = new Map([["idol-1", {
  id: "idol-1",
  examEffectType: "ProduceExamEffectType_ExamConcentration",
}]]);
const resolved = resolveTowerDefaultDeck("idol-1", idolCardById, initialDeckById);
assert.equal(TOWER_DEFAULT_DECK_BY_EXAM_EFFECT.ProduceExamEffectType_ExamConcentration, "initial_deck-produce_default-concentration");
assert.equal(resolved.deckId, "initial_deck-produce_default-concentration");
assert.equal(resolved.cards.length, 8);

assert.equal(isOnceOnlyMove("ProduceCardMovePositionType_Lost"), true);
assert.equal(isOnceOnlyMove("ProduceCardMovePositionType_Grave"), false);

const cardById = new Map([
  ["ONCE", { id: "ONCE", playMovePositionType: "ProduceCardMovePositionType_Lost" }],
  ["A", { id: "A", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["B", { id: "B", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["C", { id: "C", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
const cards = ["ONCE", "A", "B", "C"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));

// When a once-only card is used, it leaves the recycle pool.
let state = createTowerTurnState(cards, 1, cardById);
drawTowerTurn(state, 3);
const onceIndex = state.hand.findIndex((card) => card.id === "ONCE");
if (onceIndex >= 0) {
  finishTowerTurn(state, { type: "use", index: onceIndex });
  assert.equal(state.lost.some((card) => card.id === "ONCE"), true);
  assert.equal(state.discard.some((card) => card.id === "ONCE"), false);
} else {
  finishTowerTurn(state, { type: "skip" });
  drawTowerTurn(state, 3);
  const nextOnce = state.hand.findIndex((card) => card.id === "ONCE");
  assert.ok(nextOnce >= 0);
  finishTowerTurn(state, { type: "use", index: nextOnce });
  assert.equal(state.lost.some((card) => card.id === "ONCE"), true);
}

// If the same once-only card is skipped, it goes to discard and can recycle.
state = createTowerTurnState(cards, 1, cardById);
let sawOnce = false;
for (let turn = 0; turn < 10 && !sawOnce; turn += 1) {
  drawTowerTurn(state, 3);
  if (state.hand.some((card) => card.id === "ONCE")) sawOnce = true;
  finishTowerTurn(state, { type: "skip" });
}
assert.equal(sawOnce, true);
assert.equal(state.lost.length, 0);
assert.equal(state.discard.some((card) => card.id === "ONCE") || state.deck.some((card) => card.id === "ONCE"), true);

console.log("tower runtime tests: ok");
''')

replace_exact(
    ".github/workflows/ci.yml",
    '''          node --check web/tower_preset.js
          node --check web/seed_worker.js
''',
    '''          node --check web/tower_preset.js
          node --check web/tower_runtime.js
          node --check web/seed_worker.js
'''
)
replace_exact(
    ".github/workflows/ci.yml",
    '''      - name: Tower preset tests
        run: node test_tower_preset.mjs
''',
    '''      - name: Tower preset tests
        run: node test_tower_preset.mjs
      - name: Tower runtime tests
        run: node test_tower_runtime.mjs
'''
)

# README only needs factual corrections; keep it compact.
readme = Path("README.md")
r = readme.read_text()
r = r.replace("Web版は次の3タブで構成しています。", "Web版はメモリー管理、カタログ、コンテスト、アイドルへの道シミュ、seed特定の各タブで構成しています。")
r = r.replace("メモリー2枚または3枚と初期/共通カードを指定し、seedからカード順を再現できます。\n\nアイドルへの道の初期デッキは自動推測せず、対象の初期デッキIDを入力するか、カードを手動追加します。", "メモリー2〜4枚を選択すると、MainのPアイドルの `examEffectType` に対応する公式初期デッキ8枚を自動追加します。seedを指定して毎ターン3枚を引き、使用カードまたはスキップを選びながらカード循環を確認できます。`PlayMovePositionType=Lost` の1回のみカードは、使用した場合だけ除外します。")
r = r.replace("通常カードについては、使用カードが先に捨て札へ移動し、残り手札が手札順で捨て札へ移る実装に合わせ、どの3枚を使用したか不明な場合は3通りを内部で分岐します。同一カードが複数ある場合の初期シャッフル割当も列挙します。", "seed特定では実機側で毎ターンスキップする運用を前提にし、3枚の手札をそのまま手札順で捨て札へ移します。使用カードの分岐は行いません。同一カードが複数ある場合の初期シャッフル割当は列挙します。")
readme.write_text(r)

# Static sanity checks.
html = Path("web/index.html").read_text()
assert 'data-tab="seed"' in html
assert 'id="tab-seed"' in html
assert 'id="tower-add-base"' not in html
assert 'id="tower-draw-count"' not in html
assert 'id="tower-turn-hand"' in html
app = Path("web/app_v3.js").read_text()
assert 'lines.push(observationCardName(instance.card));' in app
assert 'resolveTowerDefaultDeck' in app
assert 'simulateCards(' not in app
