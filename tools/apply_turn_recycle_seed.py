from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:240]}")
    p.write_text(text.replace(old, new, 1))


# --- sim_v3.js: replace the incorrect whole-deck 'round' model with turn-aware draw/recycle logic.
p = Path("web/sim_v3.js")
text = p.read_text()
start = text.index("export function splitObservedRounds")
end = text.index("export function seedIntervalFromChoices")
new_block = r'''export function splitObservedTurns(observedIds, drawPerTurn = 3) {
  const count = Number(drawPerTurn);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const ids = (observedIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const turns = [];
  for (let offset = 0; offset < ids.length; offset += count) {
    turns.push(ids.slice(offset, offset + count));
  }
  return turns;
}

export function validateObservedDraws(cards, observedIds, drawPerTurn = 3) {
  const deckIds = makeCardInstances(cards).map((item) => item.id);
  if (!deckIds.length) throw new Error("デッキにカードがありません。");
  const observed = (observedIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (observed.length < deckIds.length) {
    throw new Error(`seed探索には最初の${deckIds.length}ドローを入力してください（現在${observed.length}枚）。`);
  }

  const firstDeck = observed.slice(0, deckIds.length);
  if (!sameMultiset(deckIds, firstDeck)) {
    throw new Error("最初のデッキ1巡分のカード構成が現在のデッキと一致しません。重複枚数も確認してください。");
  }

  const allowed = multisetCounts(deckIds);
  for (const [turnIndex, turn] of splitObservedTurns(observed, drawPerTurn).entries()) {
    const counts = multisetCounts(turn);
    for (const [id, count] of counts) {
      if (!allowed.has(id)) {
        throw new Error(`${turnIndex + 1}ターン目に現在のデッキにないカード ${id} があります。`);
      }
      if (count > allowed.get(id)) {
        throw new Error(`${turnIndex + 1}ターン目でカード ${id} の枚数がデッキ内枚数を超えています。`);
      }
    }
  }
  return observed;
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

function completedTurnDiscardOrders(hand) {
  const cards = hand.map(String);
  if (!cards.length) return [[]];
  // ExamCardMoveController.MovePlayCard sends the used normal card to Grave
  // before ResetHand appends the remaining hand in hand order. The observed
  // draw log does not tell us which of the three cards was used, so keep every
  // possible normal-card ordering. "skip turn" is identical to using the
  // first card for Grave ordering and therefore needs no extra branch.
  const out = [];
  const seen = new Set();
  for (let used = 0; used < cards.length; used += 1) {
    const order = [cards[used], ...cards.filter((_, index) => index !== used)];
    const key = order.join("\u001f");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(order);
  }
  return out;
}

function dedupeDrawBranches(branches) {
  const out = [];
  const seen = new Set();
  for (const branch of branches) {
    const key = `${branch.state}|${branch.deck.join("\u001f")}|${branch.discard.join("\u001f")}|${branch.hand.join("\u001f")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(branch);
  }
  return out;
}

export function simulateTurnRecycleDraws(cards, seed, drawCount, drawPerTurn = 3, playedIndexes = []) {
  const count = Number(drawCount);
  const perTurn = Number(drawPerTurn);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で指定してください。");
  if (!Number.isInteger(perTurn) || perTurn < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const ids = makeCardInstances(cards).map((item) => item.id);
  if (!ids.length) throw new Error("デッキにカードがありません。");

  let state = Number(seed) >>> 0;
  const initial = shuffleIdsWithState(ids, state);
  let deck = initial.deck.slice();
  state = initial.state;
  let discard = [];
  let hand = [];
  const draws = [];
  const recycleEvents = [];
  let turnIndex = 0;

  for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
    if (!deck.length) {
      if (!discard.length) break;
      const source = discard.slice();
      const recycled = shuffleIdsWithState(discard, state);
      deck = recycled.deck.slice();
      discard = [];
      state = recycled.state;
      recycleEvents.push({ drawIndex, source, shuffled: deck.slice(), randomState: state });
    }

    const card = deck.shift();
    draws.push(card);
    hand.push(card);
    if (hand.length === perTurn) {
      const requested = Number(playedIndexes?.[turnIndex] ?? 0);
      const used = Number.isInteger(requested) && requested >= 0 && requested < hand.length ? requested : 0;
      discard.push(hand[used], ...hand.filter((_, index) => index !== used));
      hand = [];
      turnIndex += 1;
    }
  }

  return {
    seed: Number(seed) >>> 0,
    initialDeck: initial.deck,
    draws,
    remainingDeck: deck,
    discard,
    hand,
    recycleEvents,
    randomState: state,
  };
}

export function seedMatchesObservedDraws(seed, cards, observedIds, drawPerTurn = 3) {
  const perTurn = Number(drawPerTurn);
  const observed = (observedIds ?? []).map(String);
  const ids = makeCardInstances(cards).map((item) => item.id);
  if (!ids.length || !observed.length) return false;

  const initial = shuffleIdsWithState(ids, Number(seed) >>> 0);
  let branches = [{
    deck: initial.deck.slice(),
    discard: [],
    hand: [],
    state: initial.state,
  }];

  for (const expected of observed) {
    const next = [];
    for (const original of branches) {
      let branch = original;
      if (!branch.deck.length) {
        if (!branch.discard.length) continue;
        const recycled = shuffleIdsWithState(branch.discard, branch.state);
        branch = {
          deck: recycled.deck,
          discard: [],
          hand: branch.hand.slice(),
          state: recycled.state,
        };
      }
      if (String(branch.deck[0]) !== String(expected)) continue;
      const deck = branch.deck.slice(1);
      const hand = [...branch.hand, branch.deck[0]];
      if (hand.length < perTurn) {
        next.push({ deck, discard: branch.discard.slice(), hand, state: branch.state });
        continue;
      }
      for (const order of completedTurnDiscardOrders(hand)) {
        next.push({
          deck: deck.slice(),
          discard: [...branch.discard, ...order],
          hand: [],
          state: branch.state,
        });
      }
    }
    branches = dedupeDrawBranches(next);
    if (!branches.length) return false;
  }
  return true;
}

'''
p.write_text(text[:start] + new_block + text[end:])


# --- seed worker: same turn-aware model, while retaining the fast first-shuffle choice filter.
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

function completedTurnDiscardOrders(hand) {
  const out = [];
  const seen = new Set();
  for (let used = 0; used < hand.length; used += 1) {
    const order = [hand[used], ...hand.filter((_, index) => index !== used)];
    const key = order.join('\u001f');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(order);
  }
  return out;
}

function dedupeBranches(branches) {
  const out = [];
  const seen = new Set();
  for (const branch of branches) {
    const key = `${branch.state}|${branch.deck.join('\u001f')}|${branch.discard.join('\u001f')}|${branch.hand.join('\u001f')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(branch);
  }
  return out;
}

function matchesObservedDraws(seed, deckIds, observedIds, drawPerTurn) {
  if (!observedIds.length) return true;
  const initial = shuffleIds(deckIds, Number(seed) >>> 0);
  let branches = [{ deck: initial.deck, discard: [], hand: [], state: initial.state }];

  for (let observedIndex = 0; observedIndex < observedIds.length; observedIndex += 1) {
    const expected = String(observedIds[observedIndex]);
    const next = [];
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      let branch = branches[branchIndex];
      if (!branch.deck.length) {
        if (!branch.discard.length) continue;
        const recycled = shuffleIds(branch.discard, branch.state);
        branch = { deck: recycled.deck, discard: [], hand: branch.hand.slice(), state: recycled.state };
      }
      if (String(branch.deck[0]) !== expected) continue;
      const drawn = branch.deck[0];
      const deck = branch.deck.slice(1);
      const hand = branch.hand.concat(drawn);
      if (hand.length < drawPerTurn) {
        next.push({ deck, discard: branch.discard.slice(), hand, state: branch.state });
      } else {
        const orders = completedTurnDiscardOrders(hand);
        for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
          next.push({
            deck: deck.slice(),
            discard: branch.discard.concat(orders[orderIndex]),
            hand: [],
            state: branch.state,
          });
        }
      }
    }
    branches = dedupeBranches(next);
    if (!branches.length) return false;
  }
  return true;
}

function matches(seed, choices, deckIds, observedIds, drawPerTurn) {
  if (!matchesChoices(seed, choices)) return false;
  // The choice sequence already proves the first complete initial deck order.
  // Only invoke the more expensive turn/discard branching when observations
  // actually extend beyond that first deck.
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


# --- app_v3.js imports and observation UI/search.
replace_once(
    "web/app_v3.js",
    '''  runOrderMonteCarlo,\n  seedIntervalFromChoices,\n  validateObservedRounds,\n} from "./sim_v3.js";''',
    '''  runOrderMonteCarlo,\n  seedIntervalFromChoices,\n  validateObservedDraws,\n} from "./sim_v3.js";''',
)

replace_once(
    "web/app_v3.js",
    '''function parseObservedRounds(composition) {\n  return validateObservedRounds(composition.cards, parseObservedIds(composition));\n}\n''',
    '''function parseObservedDraws(composition) {\n  return validateObservedDraws(composition.cards, parseObservedIds(composition), 3);\n}\n''',
)

p = Path("web/app_v3.js")
text = p.read_text()
start = text.index("function renderObservationButtons()")
end = text.index('$("tower-observed").addEventListener("input"')
new_ui = r'''function renderObservationButtons() {
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
  const rawLines = observedLines();
  const currentTurnOffset = Math.floor(rawLines.length / 3) * 3;
  let currentTurnIds = rawLines.slice(currentTurnOffset);
  try {
    currentTurnIds = parseObservedIds(composition).slice(currentTurnOffset);
  } catch {}

  const used = new Map();
  for (const id of currentTurnIds) used.set(id, (used.get(id) ?? 0) + 1);
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
      $("tower-observed").value = lines.join("\n");
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
  const total = observedLines().length;
  if (!deckCount) {
    $("tower-observed-count").textContent = "0枚";
    return;
  }
  const completedTurns = Math.floor(total / 3);
  const inTurn = total % 3;
  const turnText = inTurn === 0 && total > 0
    ? `${completedTurns}ターン完了`
    : `${completedTurns + 1}ターン目 ${inTurn} / 3枚`;
  const need = Math.max(0, deckCount - total);
  $("tower-observed-count").textContent = `${turnText} · 累計${total}枚${need ? ` · seed探索まであと${need}枚` : ""}`;
}

'''
p.write_text(text[:start] + new_ui + text[end:])

# startSeedSearch: continuous draw sequence, first deck for inverse Fisher-Yates, continuation for recycle filtering.
replace_once(
    "web/app_v3.js",
    '''    const composition = buildComposition("tower");\n    const observedRounds = parseObservedRounds(composition);\n    const firstRound = observedRounds[0];\n    const { variants, truncated } = deriveSeedChoiceVariants(composition.cards, firstRound, MAX_SEED_VARIANTS);''',
    '''    const composition = buildComposition("tower");\n    const observed = parseObservedDraws(composition);\n    const deckCount = composition.cards.length;\n    const firstDeck = observed.slice(0, deckCount);\n    const { variants, truncated } = deriveSeedChoiceVariants(composition.cards, firstDeck, MAX_SEED_VARIANTS);''',
)

replace_once(
    "web/app_v3.js",
    '''    const lastRound = observedRounds[observedRounds.length - 1];\n    const deckCount = composition.cards.length;\n    const observationSummary = lastRound.length === deckCount\n      ? `${observedRounds.length}周分`\n      : `${observedRounds.length - 1}周 + ${lastRound.length}/${deckCount}枚`;''',
    '''    const completeTurns = Math.floor(observed.length / 3);\n    const inTurn = observed.length % 3;\n    const observationSummary = inTurn\n      ? `${completeTurns}ターン完了 + ${completeTurns + 1}ターン目 ${inTurn}/3枚（累計${observed.length}ドロー）`\n      : `${completeTurns}ターン分（累計${observed.length}ドロー）`;''',
)

replace_once(
    "web/app_v3.js",
    '''          deckIds: composition.cards.map((card) => String(card.id)),\n          observedRounds,\n          start: task.start,''',
    '''          deckIds: composition.cards.map((card) => String(card.id)),\n          observedIds: observed,\n          drawPerTurn: 3,\n          start: task.start,''',
)

replace_once(
    "web/app_v3.js",
    '''    p.textContent = "一致するseedがありません。観測順・採用カード・初期デッキを確認してください。";''',
    '''    p.textContent = "一致するseedがありません。観測した3枚ずつのドロー順・採用カード・通常の捨て札挙動を確認してください。";''',
)


# --- index.html copy: remove the incorrect concept of whole-deck rounds.
replace_once(
    "web/index.html",
    '''        <p class="callout">Fridaを使わず、実機で確認した<strong>1周目と2周目以降の山札順</strong>から32-bit seed候補を逆算します。1周目はデッキ全カードが必要です。1周で候補が複数残る場合は、そのまま2周目・3周目…を続けて入力でき、2周目以降は途中まででも候補絞り込みに使えます。同一カードが複数ある場合も候補割当を考慮します。</p>''',
    '''        <p class="callout">実機で見えた<strong>3枚ずつの連続ドロー順</strong>から32-bit seed候補を逆算します。最初のデッキ枚数分で初期シャッフルを特定し、それ以降は「山札が空の状態で次の1枚を引く瞬間に、その時点の捨て札だけをseedの続きで再シャッフルする」挙動を再現して候補を絞ります。使用カードが通常どおり捨て札へ行く場合は、各ターンで3枚のどれを使ったかも内部で候補分岐します。</p>''',
)
replace_once(
    "web/index.html",
    '''        <label class="wide-label"><span>観測した順番（1周目→2周目→…）</span><textarea id="tower-observed" rows="12" spellcheck="false" placeholder="カードボタンを順に押すか、カード名を1行1枚で入力。1周分入力すると自動で次の周に進みます"></textarea></label>''',
    '''        <label class="wide-label"><span>観測したドロー順（3枚 = 1ターン）</span><textarea id="tower-observed" rows="14" spellcheck="false" placeholder="カードボタンを実機のドロー順に押すか、カード名を1行1枚で入力。ターンを跨いでそのまま続けてください"></textarea></label>''',
)


# --- engine.js: retain the master play destination when it exists; harmless for old/fallback data.
replace_once(
    "web/engine.js",
    '''    match = line.match(/^  (upgradeCount|name|planType|category|rarity|assetId):\\s*(.*?)\\s*$/);''',
    '''    match = line.match(/^  (upgradeCount|name|planType|category|rarity|assetId|playMovePositionType|moveEffectTriggerType):\\s*(.*?)\\s*$/);''',
)


# --- tests: replace whole-deck-round regression with the 3-card turn/recycle behavior.
p = Path("test_v3.mjs")
text = p.read_text()
text = text.replace(
    '''  seedMatchesObservedRounds,\n  simulateShuffleRounds,\n  validateObservedRounds,''',
    '''  seedMatchesObservedDraws,\n  simulateTurnRecycleDraws,\n  validateObservedDraws,''',
)
old_start = text.index('const multi = simulateShuffleRounds(cards, seed, 3);')
old_end = text.index('const duplicateCards =', old_start)
new_tests = r'''const elevenCards = Array.from({ length: 11 }, (_, index) => ({
  id: String(index + 1),
  fixedDeckOrder: 0,
  upgradeCount: 0,
}));
// Seed 14 yields a case where the 12th draw is the same physical card ID as
// the 6th draw. This is only possible because draw #12 happens after the
// first recycle while draw #10/#11 are still the current hand and therefore
// are excluded from the recycle source.
const recycleRun = simulateTurnRecycleDraws(elevenCards, 14, 12, 3);
assert.equal(recycleRun.draws.length, 12);
assert.equal(recycleRun.recycleEvents.length, 1);
assert.equal(recycleRun.recycleEvents[0].drawIndex, 11);
assert.deepEqual(
  [...recycleRun.recycleEvents[0].source].sort(),
  [...recycleRun.initialDeck.slice(0, 9)].sort(),
);
assert.equal(recycleRun.recycleEvents[0].source.includes(recycleRun.initialDeck[9]), false);
assert.equal(recycleRun.recycleEvents[0].source.includes(recycleRun.initialDeck[10]), false);
assert.equal(recycleRun.draws[11], recycleRun.draws[5]);

const recycleObserved = validateObservedDraws(elevenCards, recycleRun.draws, 3);
assert.equal(recycleObserved.length, 12);
assert.equal(seedMatchesObservedDraws(14, elevenCards, recycleObserved, 3), true);
assert.equal(seedMatchesObservedDraws(15, elevenCards, recycleObserved, 3), false);
assert.throws(
  () => validateObservedDraws(elevenCards, recycleRun.draws.slice(0, 10), 3),
  /最初の11ドロー/,
);

'''
p.write_text(text[:old_start] + new_tests + text[old_end:])


# README: document the actual continuous draw/recycle model.
p = Path("README.md")
text = p.read_text()
old = '''Fridaを使わず、実機で確認したシャッフル後の山札全順序から32-bit seed候補を探索できます。\n\n1. Webで実際のメモリーと採用カードを設定\n2. 実機で同じ編成を使用\n3. 山札の順番を上から最後まで記録\n4. 「seed候補を探索」を実行\n\nFisher–Yatesの交換列を観測順から復元し、最初の交換条件で32-bit空間を区間に絞ったうえで、Web Workerで候補を検査します。同一カードが複数ある場合はカード個体の割り当ても列挙します。候補割当が64通りを超える場合は、完全な探索結果と誤認しないよう停止します。\n\nデッキ全順序が必要です。観測情報が不足する場合や同一カードを区別できない場合は、seedが複数候補になることがあります。'''
new = '''Fridaを使わず、実機で確認した3枚ずつの連続ドロー順から32-bit seed候補を探索できます。\n\n1. Webで実際のメモリーと採用カードを設定\n2. 実機で同じ編成を使用\n3. 各ターンの3枚を、見えた順にそのまま続けて記録\n4. 最初のデッキ枚数分まで入力したら「seed候補を探索」を実行\n5. 候補が複数なら、そのまま次ターン以降のドローを追加入力して再探索\n\n最初のデッキ枚数分はFisher–Yatesの交換列を復元して32-bit空間を絞ります。その後は3枚単位の手札と捨て札を追跡し、山札が空の状態で次の1枚を引く瞬間に、その時点の捨て札だけを同じ乱数状態の続きでシャッフルしてドローを続行します。したがって、デッキ枚数が3の倍数でない場合、再シャッフル直後のカードが一部カードの2回目より先に出る挙動も再現します。\n\n通常カードについては、使用カードが先に捨て札へ移動し、残り手札が手札順で捨て札へ移る実装に合わせ、どの3枚を使用したか不明な場合は3通りを内部で分岐します。同一カードが複数ある場合の初期シャッフル割当も列挙します。保留・除外・カード生成・追加ドローなどで通常のカード移動から外れる場合は、その観測区間は別途状態入力が必要です。'''
if old in text:
    text = text.replace(old, new, 1)
else:
    print("README seed paragraph target not found; leaving README unchanged")
p.write_text(text)
