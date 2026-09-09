from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:300]}")
    p.write_text(text.replace(old, new, 1))


# sim_v3.js: multi-round observation helpers and canonical observation labels.
p = Path("web/sim_v3.js")
text = p.read_text()
needle = '''export function seedIntervalFromChoices(choices) {
'''
insert = '''export function observationCardLabel(name, upgradeCount = 0) {
  const raw = String(name ?? "").trim();
  const base = raw.replace(/\\s*\\++\\s*$/, "").trim() || raw;
  return `${base}${Number(upgradeCount ?? 0) > 0 ? "+" : ""}`;
}

export function splitObservedRounds(observedIds, deckCount) {
  const count = Number(deckCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("デッキ枚数が不正です。");
  const ids = (observedIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const rounds = [];
  for (let offset = 0; offset < ids.length; offset += count) {
    rounds.push(ids.slice(offset, offset + count));
  }
  return rounds;
}

export function validateObservedRounds(cards, observedIds) {
  const deckIds = makeCardInstances(cards).map((item) => item.id);
  if (!deckIds.length) throw new Error("デッキにカードがありません。");
  const rounds = splitObservedRounds(observedIds, deckIds.length);
  if (!rounds.length || rounds[0].length !== deckIds.length) {
    const current = rounds[0]?.length ?? 0;
    throw new Error(`1周目はデッキ全${deckIds.length}枚を入力してください（現在${current}枚）。`);
  }

  const allowed = multisetCounts(deckIds);
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const counts = multisetCounts(round);
    for (const [id, count] of counts) {
      if (count > (allowed.get(id) ?? 0)) {
        throw new Error(`${roundIndex + 1}周目のカード構成が現在のデッキと一致しません。重複枚数も確認してください。`);
      }
    }
    if (round.length === deckIds.length && !sameMultiset(deckIds, round)) {
      throw new Error(`${roundIndex + 1}周目のカード構成が現在のデッキと一致しません。`);
    }
  }
  return rounds;
}

export function shuffleIdsWithState(inputIds, stateInput) {
  const deck = (inputIds ?? []).map(String);
  let state = Number(stateInput) >>> 0;
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = Math.floor((state * n) / UINT32_SPACE);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
    state = xorshift32(state);
  }
  return { deck, state };
}

export function simulateShuffleRounds(cards, seed, roundCount = 1) {
  const count = Number(roundCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("周回数は1以上の整数で指定してください。");
  let deck = makeCardInstances(cards).map((item) => item.id);
  if (!deck.length) throw new Error("デッキにカードがありません。");
  let state = Number(seed) >>> 0;
  const rounds = [];
  for (let round = 0; round < count; round += 1) {
    const shuffled = shuffleIdsWithState(deck, state);
    rounds.push(shuffled.deck);
    deck = shuffled.deck;
    state = shuffled.state;
  }
  return { rounds, randomState: state };
}

export function seedMatchesObservedRounds(seed, cards, observedRounds) {
  const rounds = observedRounds ?? [];
  if (!rounds.length) return false;
  let deck = makeCardInstances(cards).map((item) => item.id);
  let state = Number(seed) >>> 0;
  for (const observed of rounds) {
    const shuffled = shuffleIdsWithState(deck, state);
    for (let index = 0; index < observed.length; index += 1) {
      if (String(shuffled.deck[index]) !== String(observed[index])) return false;
    }
    deck = shuffled.deck;
    state = shuffled.state;
  }
  return true;
}

export function seedIntervalFromChoices(choices) {
'''
if needle not in text:
    raise SystemExit("sim_v3 insertion target not found")
p.write_text(text.replace(needle, insert, 1))

# seed_worker.js: after the fast first-round Fisher-Yates check, validate later rounds
# against the continuing XorShift32 state. Each reshuffle starts from the previous
# round's observed/shuffled deck order.
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

function matchesObservedRounds(seed, deckIds, observedRounds) {
  if (!Array.isArray(observedRounds) || !observedRounds.length) return true;
  let deck = deckIds.slice();
  let state = Number(seed) >>> 0;
  for (let roundIndex = 0; roundIndex < observedRounds.length; roundIndex += 1) {
    const observed = observedRounds[roundIndex] ?? [];
    const shuffled = shuffleIds(deck, state);
    for (let index = 0; index < observed.length; index += 1) {
      if (String(shuffled.deck[index]) !== String(observed[index])) return false;
    }
    deck = shuffled.deck;
    state = shuffled.state;
  }
  return true;
}

function matches(seed, choices, deckIds, observedRounds) {
  return matchesChoices(seed, choices) && matchesObservedRounds(seed, deckIds, observedRounds);
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const choices = Array.isArray(message.choices) ? message.choices : [];
  const deckIds = Array.isArray(message.deckIds) ? message.deckIds.map(String) : [];
  const observedRounds = Array.isArray(message.observedRounds)
    ? message.observedRounds.map((round) => Array.isArray(round) ? round.map(String) : [])
    : [];
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const found = [];
  for (let candidate = start; candidate < end; candidate += 1) {
    if (matches(candidate, choices, deckIds, observedRounds)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({
    type: 'done',
    taskId: message.taskId,
    start,
    end,
    scanned: end - start,
    found,
  });
};
'''.replace("\\'use strict\\';", "'use strict';"))

# app_v3 imports.
replace_exact(
    "web/app_v3.js",
    '''import {
  deriveSeedChoiceVariants,
  makeCardInstances,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
} from "./sim_v3.js";
''',
    '''import {
  deriveSeedChoiceVariants,
  makeCardInstances,
  observationCardLabel,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
  validateObservedRounds,
} from "./sim_v3.js";
''',
)

# Replace observation parsing/rendering with multi-round aware implementation.
replace_exact(
    "web/app_v3.js",
    '''function observedLines() {
  return $("tower-observed").value.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
}

function deckNameToIds(composition) {
  const byName = new Map();
  for (const card of composition.cards) {
    const name = catalogName(card);
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(card.id);
  }
  return byName;
}

function parseObservedIds(composition) {
  const ids = new Set(composition.cards.map((card) => card.id));
  const byName = deckNameToIds(composition);
  return observedLines().map((line) => {
    if (ids.has(line)) return line;
    const suffix = line.match(/(?:—|\\||\\[)\\s*(p_card-[^\\]\\s]+)\\]?\\s*$/)?.[1];
    if (suffix && ids.has(suffix)) return suffix;
    const names = byName.get(line);
    if (names?.size === 1) return [...names][0];
    throw new Error(`観測カード「${line}」を現在のデッキに対応付けできません。カードIDで入力してください。`);
  });
}

function renderObservationButtons() {
  const container = $("tower-observation-buttons");
  if (!container) return;
  container.innerHTML = "";
  let composition;
  try {
    composition = buildComposition("tower");
  } catch {
    container.textContent = "メモリーと採用カードを設定すると、観測入力ボタンが表示されます。";
    return;
  }
  const instances = makeCardInstances(composition.cards);
  const used = new Map();
  for (const id of observedLines()) used.set(id, (used.get(id) ?? 0) + 1);
  const seen = new Map();
  for (const instance of instances) {
    const ordinal = (seen.get(instance.id) ?? 0) + 1;
    seen.set(instance.id, ordinal);
    const total = instances.filter((item) => item.id === instance.id).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card";
    button.textContent = `${catalogName(instance.card)}${total > 1 ? ` #${ordinal}` : ""}`;
    button.title = instance.id;
    button.disabled = ordinal <= (used.get(instance.id) ?? 0);
    button.addEventListener("click", () => {
      const lines = observedLines();
      lines.push(instance.id);
      $("tower-observed").value = lines.join("\\n");
      renderObservationButtons();
      updateObservationCount();
    });
    container.append(button);
  }
  updateObservationCount(instances.length);
}

function updateObservationCount(deckCount = null) {
  if (deckCount === null) {
    try { deckCount = buildComposition("tower").cards.length; } catch { deckCount = 0; }
  }
  $("tower-observed-count").textContent = `${observedLines().length} / ${deckCount}枚`;
}
''',
    '''function observedLines() {
  return $("tower-observed").value.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
}

function observationCardName(card) {
  return observationCardLabel(catalogName(card), Number(card?.upgradeCount ?? 0));
}

function deckNameToIds(composition) {
  const byName = new Map();
  for (const card of composition.cards) {
    const baseName = observationCardLabel(catalogName(card), 0);
    const displayName = observationCardName(card);
    for (const name of new Set([baseName, displayName])) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(card.id);
    }
  }
  return byName;
}

function parseObservedIds(composition) {
  const ids = new Set(composition.cards.map((card) => card.id));
  const byName = deckNameToIds(composition);
  return observedLines().map((line) => {
    if (ids.has(line)) return line;
    const suffix = line.match(/(?:—|\\||\\[)\\s*(p_card-[^\\]\\s]+)\\]?\\s*$/)?.[1];
    if (suffix && ids.has(suffix)) return suffix;
    const normalizedLine = line.replace(/\\+{2,}$/, "+");
    const names = byName.get(line) ?? byName.get(normalizedLine) ?? byName.get(line.replace(/\\++$/, ""));
    if (names?.size === 1) return [...names][0];
    throw new Error(`観測カード「${line}」を現在のデッキに対応付けできません。カードIDで入力してください。`);
  });
}

function parseObservedRounds(composition) {
  return validateObservedRounds(composition.cards, parseObservedIds(composition));
}

function renderObservationButtons() {
  const container = $("tower-observation-buttons");
  if (!container) return;
  container.innerHTML = "";
  let composition;
  try {
    composition = buildComposition("tower");
  } catch {
    container.textContent = "メモリーと採用カードを設定すると、観測入力ボタンが表示されます。";
    return;
  }
  const instances = makeCardInstances(composition.cards);
  const deckCount = instances.length;
  const rawLines = observedLines();
  const currentRoundOffset = deckCount ? Math.floor(rawLines.length / deckCount) * deckCount : 0;
  let currentRoundIds = rawLines.slice(currentRoundOffset);
  try {
    currentRoundIds = parseObservedIds(composition).slice(currentRoundOffset);
  } catch {}

  const used = new Map();
  for (const id of currentRoundIds) used.set(id, (used.get(id) ?? 0) + 1);
  const seen = new Map();
  const totals = new Map();
  for (const instance of instances) totals.set(instance.id, (totals.get(instance.id) ?? 0) + 1);
  for (const instance of instances) {
    const ordinal = (seen.get(instance.id) ?? 0) + 1;
    seen.set(instance.id, ordinal);
    const total = totals.get(instance.id) ?? 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card";
    button.textContent = `${observationCardName(instance.card)}${total > 1 ? ` #${ordinal}` : ""}`;
    button.title = instance.id;
    button.disabled = ordinal <= (used.get(instance.id) ?? 0);
    button.addEventListener("click", () => {
      const lines = observedLines();
      lines.push(instance.id);
      $("tower-observed").value = lines.join("\\n");
      renderObservationButtons();
      updateObservationCount();
    });
    container.append(button);
  }
  updateObservationCount(deckCount);
}

function updateObservationCount(deckCount = null) {
  if (deckCount === null) {
    try { deckCount = buildComposition("tower").cards.length; } catch { deckCount = 0; }
  }
  const total = observedLines().length;
  if (!deckCount) {
    $("tower-observed-count").textContent = "0 / 0枚";
    return;
  }
  const completed = Math.floor(total / deckCount);
  const within = total % deckCount;
  if (within === 0 && completed > 0) {
    $("tower-observed-count").textContent = `${completed}周完了 · ${completed + 1}周目 0 / ${deckCount}枚`;
  } else {
    $("tower-observed-count").textContent = `${completed + 1}周目 ${within} / ${deckCount}枚${total ? ` · 累計${total}枚` : ""}`;
  }
}
''',
)

# Remove raw catalog +++ from the seed/order display too; actual memory upgrade is represented by one +.
replace_exact(
    "web/app_v3.js",
    '''    strong.textContent = `${index + 1}. ${catalogName(card)}`;
''',
    '''    strong.textContent = `${index + 1}. ${observationCardName(card)}`;
''',
)

# Seed search: first full round derives the interval; every later full/partial round filters candidates.
replace_exact(
    "web/app_v3.js",
    '''    const composition = buildComposition("tower");
    const observed = parseObservedIds(composition);
    const { variants, truncated } = deriveSeedChoiceVariants(composition.cards, observed, MAX_SEED_VARIANTS);
''',
    '''    const composition = buildComposition("tower");
    const observedRounds = parseObservedRounds(composition);
    const firstRound = observedRounds[0];
    const { variants, truncated } = deriveSeedChoiceVariants(composition.cards, firstRound, MAX_SEED_VARIANTS);
''',
)

replace_exact(
    "web/app_v3.js",
    '''    const tasks = [];
    let total = 0;
''',
    '''    const lastRound = observedRounds[observedRounds.length - 1];
    const deckCount = composition.cards.length;
    const observationSummary = lastRound.length === deckCount
      ? `${observedRounds.length}周分`
      : `${observedRounds.length - 1}周 + ${lastRound.length}/${deckCount}枚`;

    const tasks = [];
    let total = 0;
''',
)

replace_exact(
    "web/app_v3.js",
    '''    renderSeedCandidates([], 0, total, false, `${variants.length}通りの重複割当を考慮。探索対象 ${total.toLocaleString()}状態。`);
''',
    '''    renderSeedCandidates([], 0, total, false, `${observationSummary}を使用。${variants.length}通りの重複割当を考慮。探索対象 ${total.toLocaleString()}状態。`);
''',
)

replace_exact(
    "web/app_v3.js",
    '''          choices: variants[task.variantIndex],
          start: task.start,
          end: task.end,
          maxMatches: MAX_SEED_MATCHES - matches.size,
''',
    '''          choices: variants[task.variantIndex],
          deckIds: composition.cards.map((card) => String(card.id)),
          observedRounds,
          start: task.start,
          end: task.end,
          maxMatches: MAX_SEED_MATCHES - matches.size,
''',
)

# Index copy: explain multi-round input and partial later rounds.
replace_exact(
    "web/index.html",
    '''        <p class="callout">Fridaを使わず、実機で確認した<strong>シャッフル後の山札全順序</strong>から32-bit seed候補を逆算します。デッキの全カードが必要です。同一カードが複数ある場合も候補割当を考慮します。</p>
''',
    '''        <p class="callout">Fridaを使わず、実機で確認した<strong>1周目と2周目以降の山札順</strong>から32-bit seed候補を逆算します。1周目はデッキ全カードが必要です。1周で候補が複数残る場合は、そのまま2周目・3周目…を続けて入力でき、2周目以降は途中まででも候補絞り込みに使えます。同一カードが複数ある場合も候補割当を考慮します。</p>
''',
)
replace_exact(
    "web/index.html",
    '''        <label class="wide-label"><span>観測した順番（上から1枚目）</span><textarea id="tower-observed" rows="10" spellcheck="false" placeholder="カードボタンを順に押すか、カード名を1行1枚で入力"></textarea></label>
''',
    '''        <label class="wide-label"><span>観測した順番（1周目→2周目→…）</span><textarea id="tower-observed" rows="12" spellcheck="false" placeholder="カードボタンを順に押すか、カード名を1行1枚で入力。1周分入力すると自動で次の周に進みます"></textarea></label>
''',
)

# test_v3: regression tests for +++ normalization and multi-round continuation.
replace_exact(
    "test_v3.mjs",
    '''  deriveSeedChoiceVariants,
  runOrderMonteCarlo,
  scanSeedRange,
  seedIntervalFromChoices,
  seedMatchesChoices,
''',
    '''  deriveSeedChoiceVariants,
  observationCardLabel,
  runOrderMonteCarlo,
  scanSeedRange,
  seedIntervalFromChoices,
  seedMatchesChoices,
  seedMatchesObservedRounds,
  simulateShuffleRounds,
  validateObservedRounds,
''',
)

replace_exact(
    "test_v3.mjs",
    '''const duplicateCards = ["A", "A", "B", "C", "D"].map((id) => ({ id, fixedDeckOrder: 0, upgradeCount: 0 }));
''',
    '''assert.equal(observationCardLabel("集中+++", 0), "集中");
assert.equal(observationCardLabel("集中+++", 1), "集中+");
assert.equal(observationCardLabel("集中", 1), "集中+");

const multi = simulateShuffleRounds(cards, seed, 3);
assert.equal(multi.rounds[0].join(""), known.initialDeck.map((card) => card.id).join(""));
const multiObserved = [...multi.rounds[0], ...multi.rounds[1].slice(0, 4)];
const multiRounds = validateObservedRounds(cards, multiObserved);
assert.equal(multiRounds.length, 2);
assert.equal(multiRounds[1].length, 4);
assert.equal(seedMatchesObservedRounds(seed, cards, multiRounds), true);
assert.equal(seedMatchesObservedRounds((seed + 1) >>> 0, cards, multiRounds), false);
assert.throws(() => validateObservedRounds(cards, multi.rounds[0].slice(0, 7)), /1周目/);

const duplicateCards = ["A", "A", "B", "C", "D"].map((id) => ({ id, fixedDeckOrder: 0, upgradeCount: 0 }));
''',
)
