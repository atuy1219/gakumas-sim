import { loadCatalogs } from "./engine.js";
import { observationCardLabel } from "./sim_v3.js";
import {
  buildDiscardBeforeFirstRecycle,
  filterSeedsByFirstRecycle,
  firstRecycleRelevantHands,
} from "./seed_recycle_v11.js";
import {
  normalizeSeedObservedName,
  resolveSeedBuilderCardRef,
  seedRefLabels,
} from "./seed_history_ref_v12.js";

const $ = (id) => document.getElementById(id);
const DRAW_PER_TURN = 3;

const state = {
  catalogs: null,
  signature: "",
  firstCycleCards: [],
  relevantHands: [],
  actions: [],
  secondCycle: [],
  slotCount: 6,
  pickerIndex: null,
  candidates: [],
  candidateCapped: false,
  candidateSearchComplete: false,
  observationButtonMap: new Map(),
  lastError: "",
};

function ensureStylesheet() {
  if (document.querySelector('link[href="./seed_history_v11.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./seed_history_v11.css";
  document.head.append(link);
}

function ensurePanel() {
  $("tower-seed-history-v11")?.remove();
  if ($("tower-seed-history-v12")) return;
  const observed = $("tower-observed");
  const anchor = observed?.closest("label");
  if (!anchor) return;

  const panel = document.createElement("section");
  panel.id = "tower-seed-history-v12";
  panel.className = "seed-history-v11";
  panel.innerHTML = `
    <div class="section-head compact-head">
      <div>
        <h3>Seed特定の追加絞り込み</h3>
        <p class="hint">1周目の並びだけで複数候補が残ったとき、カード使用履歴と最初の再シャッフル後の並びで候補を絞ります。</p>
      </div>
      <span id="seed-flow-status-v12" class="badge">準備中</span>
    </div>
    <div class="callout" id="seed-flow-guide-v12">
      <strong>使い方</strong><br>
      ① 上の観測カードを、実機で見えた順に山札1巡分タップする<br>
      ② 「Seed候補を探索」を実行する<br>
      ③ 下で1周目の各ターンに実際に使ったカード、またはSKIPを指定する<br>
      ④ 最初の再シャッフル後に見えたカードを順番に指定すると、候補が自動で絞られる
    </div>
    <p id="seed-deck-resolution-v12" class="hint"></p>

    <div class="section-head compact-head">
      <div>
        <h3>1周目の使用履歴</h3>
        <p class="hint">カードを使った順にタップしてください。何も使わなかったターンはSKIPです。</p>
      </div>
      <span id="seed-history-progress-v12" class="badge">1周目待ち</span>
    </div>
    <div id="seed-history-turns-v12" class="seed-history-turns-v11">
      <p class="hint">山札1巡分の観測が完了すると手札が表示されます。</p>
    </div>
    <div class="button-row seed-history-actions-v11">
      <button id="seed-history-all-skip-v12" type="button" class="secondary" disabled>全ターンSKIP</button>
      <button id="seed-history-clear-v12" type="button" class="ghost-button" disabled>使用履歴をクリア</button>
    </div>

    <div class="section-head compact-head">
      <div>
        <h3>再シャッフル後の観測</h3>
        <p class="hint">「2周目」ではなく、最初に捨て札が再シャッフルされた直後から見えたカードを入力します。</p>
      </div>
      <span id="seed-recycle-count-v12" class="badge">未入力</span>
    </div>
    <p id="seed-recycle-note-v12" class="callout">1周目のカード順と使用履歴を入力してください。</p>
    <div id="seed-recycle-slots-v12" class="seed-recycle-slots-v11"></div>
    <div id="seed-card-picker-v12" class="seed-card-picker-v11" hidden></div>
    <div class="button-row">
      <button id="seed-recycle-add-slots-v12" type="button" class="secondary" hidden>観測枠を3枚追加</button>
      <button id="seed-recycle-clear-v12" type="button" class="ghost-button" disabled>再シャッフル後をクリア</button>
    </div>
    <div id="seed-refined-results-v12" class="seed-refined-results-v11"></div>
  `;
  anchor.after(panel);

  $("seed-history-all-skip-v12")?.addEventListener("click", () => {
    state.actions = state.relevantHands.map(() => ({ type: "skip", usedIndices: [] }));
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-history-clear-v12")?.addEventListener("click", () => {
    state.actions = state.relevantHands.map(() => null);
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-recycle-clear-v12")?.addEventListener("click", () => {
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-recycle-add-slots-v12")?.addEventListener("click", () => {
    state.slotCount += 3;
    renderSecondCycle();
  });
}

function observedLines() {
  return String($("tower-observed")?.value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function captureObservationButtonMap() {
  const host = $("tower-observation-buttons");
  if (!host) return;
  const next = new Map();
  for (const button of host.querySelectorAll("button.observation-card")) {
    const id = String(button.title ?? "").trim();
    const name = normalizeSeedObservedName(button.textContent);
    if (!id || !name) continue;
    if (!next.has(name)) next.set(name, new Set());
    next.get(name).add(id);
  }
  state.observationButtonMap = next;
}

function selectedTowerDeckRefs() {
  const refs = [];
  const catalogCards = state.catalogs?.cards ?? [];

  for (const label of document.querySelectorAll("#tower-builder .card-check")) {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input?.checked) continue;
    const resolved = resolveSeedBuilderCardRef({
      datasetCardId: label.dataset.cardId,
      datasetUpgraded: label.dataset.upgraded,
      detailText: label.querySelector("small")?.textContent,
      visibleName: label.querySelector("strong")?.textContent,
    }, catalogCards);
    if (!resolved) continue;
    refs.push({
      ...resolved,
      visibleName: String(label.querySelector("strong")?.textContent ?? "").trim(),
      source: "memory",
    });
  }

  for (const chip of document.querySelectorAll("#tower-base-list .chip[title]")) {
    const id = String(chip.title ?? "").trim();
    if (!/^p_card-/.test(id)) continue;
    refs.push({
      id,
      upgradeCount: 0,
      visibleName: String(chip.firstChild?.textContent ?? chip.textContent ?? "").trim(),
      source: "base",
    });
  }
  return refs;
}

function masterForRef(ref) {
  const upgrade = Number(ref?.upgradeCount ?? 0) > 0 ? 1 : 0;
  return state.catalogs?.cardVariantByKey?.get?.(`${String(ref?.id ?? "")}@@${upgrade}`)
    ?? state.catalogs?.cardById?.get?.(String(ref?.id ?? ""))
    ?? {};
}

function labelsForRef(ref) {
  return seedRefLabels(
    ref,
    state.catalogs?.cardVariantByKey,
    state.catalogs?.cardById,
    observationCardLabel,
  );
}

function resolveFirstCycleCards(lines, refsInput = null) {
  const refs = (refsInput ?? selectedTowerDeckRefs()).map((ref, index) => ({ ...ref, occurrence: index }));
  if (!refs.length) throw new Error("ドル道の編成からカードを取得できません。メモリーと採用カードを確認してください。");
  if (lines.length < refs.length) {
    throw new Error(`1周目の観測が不足しています（${lines.length}/${refs.length}枚）。上の観測カードを実際に見えた順にタップしてください。`);
  }

  const remaining = refs.slice();
  const result = [];
  for (const rawLine of lines.slice(0, refs.length)) {
    const line = normalizeSeedObservedName(rawLine);
    const directId = line.match(/(?:^|—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
    let candidates = remaining.filter((ref) => directId ? ref.id === directId : labelsForRef(ref).has(line));

    const buttonIds = state.observationButtonMap.get(line);
    if (candidates.length > 1 && buttonIds?.size) {
      const narrowed = candidates.filter((ref) => buttonIds.has(ref.id));
      if (narrowed.length) candidates = narrowed;
    }

    if (!candidates.length) {
      const recognized = [...new Set(remaining.map((ref) => {
        const master = masterForRef(ref);
        return observationCardLabel(master.name ?? ref.visibleName ?? ref.id, ref.upgradeCount);
      }))].join(" / ");
      throw new Error(`観測カード「${rawLine}」を現在の編成に対応付けできません。現在認識している未観測カード: ${recognized || "なし"}`);
    }

    const distinctIds = new Set(candidates.map((ref) => ref.id));
    if (distinctIds.size > 1) {
      throw new Error(`観測カード「${rawLine}」が複数のカードIDに一致します。観測ボタンから入力し直してください。`);
    }

    const ref = candidates[0];
    const remainingIndex = remaining.findIndex((item) => item.occurrence === ref.occurrence);
    if (remainingIndex >= 0) remaining.splice(remainingIndex, 1);
    const master = masterForRef(ref);
    const playMovePositionType = String(master.playMovePositionType ?? "");
    result.push({
      id: ref.id,
      upgradeCount: Number(ref.upgradeCount ?? 0) > 0 ? 1 : 0,
      label: observationCardLabel(master.name ?? ref.visibleName ?? ref.id, ref.upgradeCount),
      isInitial: Boolean(master.isInitial),
      playMovePositionType,
      onceOnly: playMovePositionType === "ProduceCardMovePositionType_Lost",
    });
  }
  return result;
}

function actionComplete(action) {
  return action?.type === "skip"
    || (action?.type === "use" && Array.isArray(action.usedIndices) && action.usedIndices.length > 0);
}

function historyComplete() {
  return state.relevantHands.length > 0
    && state.actions.length === state.relevantHands.length
    && state.actions.every(actionComplete);
}

function resetForFirstCycle(cards) {
  const signature = cards.map((card) => `${card.id}@@${card.upgradeCount}`).join("|");
  if (signature === state.signature) {
    state.firstCycleCards = cards;
    state.relevantHands = firstRecycleRelevantHands(cards, DRAW_PER_TURN);
    return;
  }
  state.signature = signature;
  state.firstCycleCards = cards;
  state.relevantHands = firstRecycleRelevantHands(cards, DRAW_PER_TURN);
  state.actions = state.relevantHands.map(() => null);
  state.secondCycle = [];
  state.pickerIndex = null;
  state.slotCount = 6;
}

function clearCycleState() {
  state.signature = "";
  state.firstCycleCards = [];
  state.relevantHands = [];
  state.actions = [];
  state.secondCycle = [];
  state.pickerIndex = null;
}

function syncFirstCycle() {
  captureObservationButtonMap();
  if (!state.catalogs) return false;
  const refs = selectedTowerDeckRefs();
  const lines = observedLines();
  const status = $("seed-deck-resolution-v12");
  if (status) status.textContent = `現在の編成: ${refs.length}枚 / 1周目の観測: ${Math.min(lines.length, refs.length)}枚`;

  if (!refs.length || lines.length < refs.length) {
    clearCycleState();
    return false;
  }

  const cards = resolveFirstCycleCards(lines, refs);
  resetForFirstCycle(cards);
  return true;
}

function useCard(turnIndex, cardIndex) {
  const current = state.actions[turnIndex];
  const used = current?.type === "use" ? [...current.usedIndices] : [];
  const existing = used.indexOf(cardIndex);
  if (existing >= 0) used.splice(existing, 1);
  else used.push(cardIndex);
  state.actions[turnIndex] = used.length ? { type: "use", usedIndices: used } : null;
  state.secondCycle = [];
  state.pickerIndex = null;
  renderAll();
}

function skipTurn(turnIndex) {
  state.actions[turnIndex] = { type: "skip", usedIndices: [] };
  state.secondCycle = [];
  state.pickerIndex = null;
  renderAll();
}

function renderHistory() {
  const host = $("seed-history-turns-v12");
  const progress = $("seed-history-progress-v12");
  const allSkip = $("seed-history-all-skip-v12");
  const clear = $("seed-history-clear-v12");
  if (!host || !progress) return;
  host.replaceChildren();

  if (!state.catalogs) {
    host.innerHTML = '<p class="hint">カード情報を読み込み中…</p>';
    progress.textContent = "読込中";
    if (allSkip) allSkip.disabled = true;
    if (clear) clear.disabled = true;
    return;
  }
  if (!state.firstCycleCards.length) {
    host.innerHTML = `<p class="hint">${state.lastError || "山札1巡分の観測が完了すると、ここに各ターンの手札が表示されます。"}</p>`;
    progress.textContent = "1周目待ち";
    if (allSkip) allSkip.disabled = true;
    if (clear) clear.disabled = true;
    return;
  }

  const completed = state.actions.filter(actionComplete).length;
  progress.textContent = `${completed}/${state.relevantHands.length}ターン`;
  if (allSkip) allSkip.disabled = !state.relevantHands.length;
  if (clear) clear.disabled = !state.relevantHands.length;

  state.relevantHands.forEach((handInfo, turnIndex) => {
    const turn = document.createElement("section");
    turn.className = "seed-history-turn-v11";

    const head = document.createElement("div");
    head.className = "seed-history-turn-head-v11";
    const title = document.createElement("strong");
    const summary = document.createElement("small");
    title.textContent = `TURN ${handInfo.turn}`;
    const action = state.actions[turnIndex];
    if (action?.type === "skip") summary.textContent = "SKIP";
    else if (action?.type === "use") summary.textContent = `使用 ${action.usedIndices.length}枚`;
    else summary.textContent = "未入力";
    head.append(title, summary);

    const zone = document.createElement("div");
    zone.className = "seed-history-hand-zone-v11";
    const hand = document.createElement("div");
    hand.className = "m3e-battle-hand seed-history-hand-v11";

    handInfo.cards.forEach((card, cardIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "m3e-hand-card seed-history-card-v11";
      const useOrder = action?.type === "use" ? action.usedIndices.indexOf(cardIndex) : -1;
      button.classList.toggle("selected", useOrder >= 0);
      button.setAttribute("aria-pressed", String(useOrder >= 0));

      const name = document.createElement("strong");
      const detail = document.createElement("small");
      name.textContent = card.label;
      detail.textContent = card.onceOnly ? "使用すると除外" : "使用すると捨て札";
      button.append(name, detail);
      if (useOrder >= 0) {
        const badge = document.createElement("span");
        badge.className = "seed-use-order-v11";
        badge.textContent = `使用${useOrder + 1}`;
        button.append(badge);
      }
      button.addEventListener("click", () => useCard(turnIndex, cardIndex));
      hand.append(button);
    });

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "m3e-skip-button seed-history-skip-v11";
    skip.classList.toggle("selected", action?.type === "skip");
    skip.textContent = "SKIP";
    skip.addEventListener("click", () => skipTurn(turnIndex));

    zone.append(hand, skip);
    turn.append(head, zone);
    host.append(turn);
  });

  const remainder = state.firstCycleCards.length % DRAW_PER_TURN;
  if (remainder && state.firstCycleCards.length >= DRAW_PER_TURN) {
    const note = document.createElement("p");
    note.className = "hint seed-history-boundary-v11";
    note.textContent = `1周目の最後は${remainder}枚だけ残ります。その次の手札を埋める途中で最初の再シャッフルが起きるため、上に表示したTURNまでの使用履歴だけが最初の再シャッフル順に影響します。`;
    host.append(note);
  }
}

function recycleSource() {
  if (!historyComplete()) return null;
  return buildDiscardBeforeFirstRecycle(state.firstCycleCards, state.actions, DRAW_PER_TURN);
}

function displayNameForCard(card) {
  if (!card) return "";
  const master = masterForRef(card);
  return observationCardLabel(master.name ?? card.label ?? card.id, card.upgradeCount);
}

function selectedSecondIds() {
  const out = [];
  for (const value of state.secondCycle) {
    if (!value) break;
    out.push(value);
  }
  return out;
}

function chooseSecondCard(index, id) {
  if (!id) state.secondCycle = state.secondCycle.slice(0, index);
  else {
    state.secondCycle[index] = id;
    state.secondCycle.length = Math.max(state.secondCycle.length, index + 1);
  }
  state.pickerIndex = null;
  renderSecondCycle();
  renderRefinedResults();
}

function renderPicker(source) {
  const picker = $("seed-card-picker-v12");
  if (!picker) return;
  picker.replaceChildren();
  const index = state.pickerIndex;
  if (index === null || index === undefined) {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;

  const heading = document.createElement("strong");
  heading.textContent = `再シャッフル後 ${index + 1}枚目を選択`;
  picker.append(heading);

  const sourceCounts = new Map();
  const firstById = new Map();
  for (const card of source) {
    sourceCounts.set(card.id, (sourceCounts.get(card.id) ?? 0) + 1);
    if (!firstById.has(card.id)) firstById.set(card.id, card);
  }
  const usedBefore = new Map();
  for (const id of state.secondCycle.slice(0, index)) {
    if (id) usedBefore.set(id, (usedBefore.get(id) ?? 0) + 1);
  }

  const grid = document.createElement("div");
  grid.className = "seed-card-picker-grid-v11";
  for (const [id, count] of sourceCounts) {
    const remaining = count - (usedBefore.get(id) ?? 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    const label = displayNameForCard(firstById.get(id)) || id;
    button.textContent = `${label}${count > 1 ? ` ×残${remaining}` : ""}`;
    button.disabled = remaining <= 0;
    button.addEventListener("click", () => chooseSecondCard(index, id));
    grid.append(button);
  }
  picker.append(grid);

  if (state.secondCycle[index]) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ghost-button";
    clear.textContent = "この位置以降をクリア";
    clear.addEventListener("click", () => chooseSecondCard(index, null));
    picker.append(clear);
  }
}

function renderSecondCycle() {
  const slots = $("seed-recycle-slots-v12");
  const note = $("seed-recycle-note-v12");
  const badge = $("seed-recycle-count-v12");
  const add = $("seed-recycle-add-slots-v12");
  const clear = $("seed-recycle-clear-v12");
  if (!slots || !note || !badge) return;
  slots.replaceChildren();

  if (!state.firstCycleCards.length) {
    note.textContent = state.lastError || "まず1周目を山札1巡分観測してください。";
    badge.textContent = "1周目待ち";
    if (add) add.hidden = true;
    if (clear) clear.disabled = true;
    renderPicker([]);
    return;
  }
  if (!historyComplete()) {
    note.textContent = "上の全ターンで、実際に使用したカードまたはSKIPを指定してください。";
    badge.textContent = "履歴待ち";
    if (add) add.hidden = true;
    if (clear) clear.disabled = true;
    renderPicker([]);
    return;
  }

  let resolved;
  try {
    resolved = recycleSource();
  } catch (error) {
    note.textContent = error.message;
    badge.textContent = "エラー";
    renderPicker([]);
    return;
  }

  const source = resolved.discard;
  const lostCount = resolved.lost.length;
  const selected = selectedSecondIds();
  note.textContent = `最初の再シャッフル対象は${source.length}枚です${lostCount ? `。使用により除外されたカードは${lostCount}枚です` : ""}。再シャッフル後に実際に見えた順で入力してください。`;
  badge.textContent = `${selected.length}/${source.length}枚観測`;
  if (clear) clear.disabled = !selected.length;

  const visibleCount = Math.min(Math.max(1, state.slotCount), source.length);
  for (let index = 0; index < visibleCount; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-recycle-slot-v11";
    const id = state.secondCycle[index];
    button.classList.toggle("filled", Boolean(id));
    button.disabled = index > 0 && !state.secondCycle[index - 1] && !id;

    const small = document.createElement("small");
    const strong = document.createElement("strong");
    small.textContent = `再シャッフル後 ${index + 1}`;
    const sourceCard = source.find((card) => card.id === id);
    strong.textContent = id ? (displayNameForCard(sourceCard) || id) : "タップして選択";
    button.append(small, strong);
    button.addEventListener("click", () => {
      state.pickerIndex = state.pickerIndex === index ? null : index;
      renderSecondCycle();
    });
    slots.append(button);
  }

  if (add) add.hidden = visibleCount >= source.length;
  renderPicker(source);
}

function readCandidateSeeds() {
  const host = $("tower-seed-results");
  if (!host) return;
  const text = host.textContent ?? "";
  const seeds = [...host.querySelectorAll("button.seed-candidate")]
    .map((button) => Number(String(button.textContent ?? "").match(/^\s*(\d+)/)?.[1]))
    .filter((value) => Number.isInteger(value))
    .map((value) => value >>> 0);
  state.candidates = [...new Set(seeds)];
  state.candidateSearchComplete = /探索完了/.test(text);
  state.candidateCapped = /候補が100件/.test(text) || /表示を打ち切/.test(text);
  renderRefinedResults();
  renderFlowStatus();
}

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function renderRefinedResults() {
  const host = $("seed-refined-results-v12");
  if (!host) return;
  host.replaceChildren();

  if (!state.candidates.length) {
    host.innerHTML = '<p class="hint">1周目の観測後、「Seed候補を探索」を実行してください。</p>';
    return;
  }
  if (!state.candidateSearchComplete) {
    host.innerHTML = `<p class="hint">Seed探索中です。現在 ${state.candidates.length}候補を検出しています。</p>`;
    return;
  }
  if (!historyComplete()) {
    host.innerHTML = `<p class="hint">1周目で ${state.candidates.length}候補。使用履歴を完成させると追加絞り込みできます。</p>`;
    return;
  }

  const observed = selectedSecondIds();
  if (!observed.length) {
    host.innerHTML = `<p class="hint">1周目で ${state.candidates.length}候補。再シャッフル後のカードを1枚以上指定してください。</p>`;
    return;
  }

  let filtered;
  try {
    filtered = filterSeedsByFirstRecycle(
      state.candidates,
      state.firstCycleCards,
      state.actions,
      observed,
      {
        shuffledCardCount: state.firstCycleCards.filter((card) => !card.isInitial).length,
        drawPerTurn: DRAW_PER_TURN,
      },
    );
  } catch (error) {
    host.innerHTML = `<p class="error">${error.message}</p>`;
    return;
  }

  const summary = document.createElement("p");
  summary.className = filtered.length === 1 ? "seed-refine-summary-v11 success" : "seed-refine-summary-v11";
  summary.textContent = `追加絞り込み: ${state.candidates.length}候補 → ${filtered.length}候補（再シャッフル後 ${observed.length}枚観測）`;
  host.append(summary);

  if (state.candidateCapped) {
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = "最初の探索が100件で打ち切られているため、表示された候補だけを追加絞り込みしています。";
    host.append(warning);
  }
  if (!filtered.length) {
    const warning = document.createElement("p");
    warning.className = "error";
    warning.textContent = "一致候補がありません。使用したカード、SKIP、再シャッフル後の観測順を確認してください。";
    host.append(warning);
    return;
  }

  const list = document.createElement("div");
  list.className = "seed-refined-list-v11";
  for (const seed of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-candidate";
    button.textContent = `${seed} / ${asHex(seed)}`;
    button.addEventListener("click", () => {
      const input = $("tower-seed");
      if (input) input.value = String(seed);
    });
    list.append(button);
  }
  host.append(list);

  if (filtered.length === 1) {
    const input = $("tower-seed");
    if (input) input.value = String(filtered[0]);
    const done = document.createElement("p");
    done.className = "hint";
    done.textContent = "Seedを1つに特定したため、Seed入力欄へ自動反映しました。";
    host.append(done);
  }
}

function renderFlowStatus() {
  const badge = $("seed-flow-status-v12");
  if (!badge) return;
  const refs = selectedTowerDeckRefs();
  const observed = observedLines();
  if (!refs.length) {
    badge.textContent = "編成待ち";
    return;
  }
  if (observed.length < refs.length) {
    badge.textContent = `1周目 ${observed.length}/${refs.length}`;
    return;
  }
  if (!state.candidates.length || !state.candidateSearchComplete) {
    badge.textContent = "Seed探索待ち";
    return;
  }
  if (!historyComplete()) {
    badge.textContent = `候補${state.candidates.length}件・履歴待ち`;
    return;
  }
  if (!selectedSecondIds().length) {
    badge.textContent = `候補${state.candidates.length}件・再観測待ち`;
    return;
  }
  badge.textContent = "追加絞り込み中";
}

function renderAll() {
  state.lastError = "";
  try {
    syncFirstCycle();
  } catch (error) {
    state.lastError = error?.message ?? String(error);
    clearCycleState();
  }
  renderHistory();
  renderSecondCycle();
  renderRefinedResults();
  renderFlowStatus();
}

function observeElement(element, callback, options = { childList: true, subtree: true }) {
  if (!element) return;
  new MutationObserver(() => queueMicrotask(callback)).observe(element, options);
}

async function initialize() {
  ensureStylesheet();
  ensurePanel();

  const observed = $("tower-observed");
  observed?.addEventListener("input", () => queueMicrotask(renderAll));
  $("tower-reset-observation")?.addEventListener("click", () => setTimeout(renderAll));
  $("tower-undo-observation")?.addEventListener("click", () => setTimeout(renderAll));

  observeElement($("tower-observation-buttons"), () => {
    captureObservationButtonMap();
    renderAll();
  });
  observeElement($("tower-seed-results"), readCandidateSeeds, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  observeElement($("tower-builder"), renderAll);
  observeElement($("tower-base-list"), renderAll);

  try {
    state.catalogs = await loadCatalogs();
  } catch (error) {
    state.lastError = `カード情報を読み込めませんでした: ${error.message}`;
    renderAll();
    return;
  }

  captureObservationButtonMap();
  renderAll();
  readCandidateSeeds();
}

initialize().catch((error) => console.warn("seed use history UI v12 failed", error));
