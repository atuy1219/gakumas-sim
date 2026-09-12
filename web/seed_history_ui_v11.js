import { loadCatalogs } from "./engine.js";
import { observationCardLabel } from "./sim_v3.js";
import {
  buildDiscardBeforeFirstRecycle,
  filterSeedsByFirstRecycle,
  firstRecycleRelevantHands,
} from "./seed_recycle_v11.js";

const $ = (id) => document.getElementById(id);
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
  candidateSearchComplete: false,
  candidateCapped: false,
  buttonNameToIds: new Map(),
};

function ensureStylesheet() {
  if (document.querySelector('link[href="./seed_history_v11.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./seed_history_v11.css";
  document.head.append(link);
}

function ensurePanel() {
  if ($("tower-seed-history-v11")) return;
  const observed = $("tower-observed");
  const anchor = observed?.closest("label");
  if (!anchor) return;
  const panel = document.createElement("section");
  panel.id = "tower-seed-history-v11";
  panel.className = "seed-history-v11";
  panel.innerHTML = `
    <div class="section-head compact-head">
      <div><h3>1周目の使用履歴</h3><p class="hint">実際に使用したカードを使用順にタップしてください。使わなかったターンはSKIPを選択します。</p></div>
      <span id="seed-history-progress-v11" class="badge">1周目待ち</span>
    </div>
    <div id="seed-history-turns-v11" class="seed-history-turns-v11"><p class="hint">山札1巡分の観測が完了すると手札が表示されます。</p></div>
    <div class="button-row seed-history-actions-v11">
      <button id="seed-history-all-skip-v11" type="button" class="secondary" disabled>全ターンSKIP</button>
      <button id="seed-history-clear-v11" type="button" class="ghost-button" disabled>使用履歴をクリア</button>
    </div>
    <div class="section-head compact-head">
      <div><h3>2周目でSeedを絞り込む</h3><p class="hint">1周目の使用履歴から実際の捨て札を再現し、再シャッフル後に見えたカードを順番に指定します。</p></div>
      <span id="seed-recycle-count-v11" class="badge">未入力</span>
    </div>
    <p id="seed-recycle-note-v11" class="callout">1周目のカード順と使用履歴を入力してください。</p>
    <div id="seed-recycle-slots-v11" class="seed-recycle-slots-v11"></div>
    <div id="seed-card-picker-v11" class="seed-card-picker-v11" hidden></div>
    <div class="button-row">
      <button id="seed-recycle-add-slots-v11" type="button" class="secondary" hidden>観測枠を3枚追加</button>
      <button id="seed-recycle-clear-v11" type="button" class="ghost-button" disabled>2周目をクリア</button>
    </div>
    <div id="seed-refined-results-v11" class="seed-refined-results-v11"></div>
  `;
  anchor.after(panel);

  $("seed-history-all-skip-v11").addEventListener("click", () => {
    state.actions = state.relevantHands.map(() => ({ type: "skip", usedIndices: [] }));
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-history-clear-v11").addEventListener("click", () => {
    state.actions = state.relevantHands.map(() => null);
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-recycle-clear-v11").addEventListener("click", () => {
    state.secondCycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-recycle-add-slots-v11").addEventListener("click", () => {
    state.slotCount += 3;
    renderSecondCycle();
  });
}

function normalizeObservedName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#\d+$/, "")
    .replace(/\+{2,}$/, "+");
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
  for (const button of host.querySelectorAll("button.observation-card")) {
    const id = String(button.title ?? "").trim();
    const name = normalizeObservedName(button.textContent);
    if (!id || !name) continue;
    if (!state.buttonNameToIds.has(name)) state.buttonNameToIds.set(name, new Set());
    state.buttonNameToIds.get(name).add(id);
  }
}

function selectedTowerDeckRefs() {
  const refs = [];
  for (const label of document.querySelectorAll("#tower-builder .card-check")) {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input?.checked) continue;
    const detail = String(label.querySelector("small")?.textContent ?? "");
    const id = detail.match(/p_card-[^\s·]+/)?.[0];
    if (!id) continue;
    const upgradeCount = Number(detail.match(/\+(\d+)/)?.[1] ?? 0);
    refs.push({ id, upgradeCount });
  }
  for (const chip of document.querySelectorAll("#tower-base-list .chip[title]")) {
    const id = String(chip.title ?? "").trim();
    if (id) refs.push({ id, upgradeCount: 0 });
  }
  return refs;
}

function masterForRef(ref) {
  return state.catalogs?.cardVariantByKey?.get?.(`${ref.id}@@${Number(ref.upgradeCount ?? 0)}`)
    ?? state.catalogs?.cardById?.get?.(ref.id)
    ?? {};
}

function labelsForRef(ref) {
  const master = masterForRef(ref);
  const rawName = String(master.name ?? ref.id);
  return new Set([
    normalizeObservedName(rawName),
    normalizeObservedName(observationCardLabel(rawName, Number(ref.upgradeCount ?? 0))),
    normalizeObservedName(observationCardLabel(rawName, 0)),
    normalizeObservedName(ref.id),
  ]);
}

function resolveFirstCycleCards(lines) {
  const refs = selectedTowerDeckRefs().map((ref, index) => ({ ...ref, occurrence: index }));
  if (!refs.length) throw new Error("ドル道の編成からカードを取得できません。");
  if (lines.length < refs.length) throw new Error(`1周目は全${refs.length}枚を入力してください。`);
  const remaining = refs.slice();
  const result = [];

  for (const rawLine of lines.slice(0, refs.length)) {
    const line = normalizeObservedName(rawLine);
    const directId = line.match(/(?:^|—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
    let candidates = remaining.filter((ref) => directId ? ref.id === directId : labelsForRef(ref).has(line));
    const cachedIds = state.buttonNameToIds.get(line);
    if (candidates.length > 1 && cachedIds?.size) {
      const narrowed = candidates.filter((ref) => cachedIds.has(ref.id));
      if (narrowed.length) candidates = narrowed;
    }
    if (!candidates.length) throw new Error(`観測カード「${rawLine}」を現在の編成に対応付けできません。`);
    const distinctIds = new Set(candidates.map((ref) => ref.id));
    if (distinctIds.size > 1) throw new Error(`観測カード「${rawLine}」が複数カードに一致します。カードIDで入力してください。`);

    const ref = candidates[0];
    remaining.splice(remaining.findIndex((item) => item.occurrence === ref.occurrence), 1);
    const master = masterForRef(ref);
    const playMovePositionType = String(master.playMovePositionType ?? "");
    result.push({
      id: ref.id,
      upgradeCount: Number(ref.upgradeCount ?? 0),
      label: rawLine,
      isInitial: Boolean(master.isInitial),
      playMovePositionType,
      onceOnly: playMovePositionType === "ProduceCardMovePositionType_Lost",
    });
  }
  return result;
}

function actionComplete(action) {
  return action?.type === "skip" || (action?.type === "use" && Array.isArray(action.usedIndices) && action.usedIndices.length > 0);
}

function historyComplete() {
  return state.relevantHands.length > 0 && state.actions.length === state.relevantHands.length && state.actions.every(actionComplete);
}

function resetForFirstCycle(cards) {
  const signature = cards.map((card) => `${card.id}@@${card.upgradeCount}`).join("|");
  if (signature === state.signature) {
    state.firstCycleCards = cards;
    state.relevantHands = firstRecycleRelevantHands(cards, 3);
    return;
  }
  state.signature = signature;
  state.firstCycleCards = cards;
  state.relevantHands = firstRecycleRelevantHands(cards, 3);
  state.actions = state.relevantHands.map(() => null);
  state.secondCycle = [];
  state.pickerIndex = null;
}

function syncFirstCycle() {
  ensurePanel();
  captureObservationButtonMap();
  if (!state.catalogs) return false;
  const refs = selectedTowerDeckRefs();
  const lines = observedLines();
  if (!refs.length || lines.length < refs.length) {
    state.signature = "";
    state.firstCycleCards = [];
    state.relevantHands = [];
    state.actions = [];
    state.secondCycle = [];
    state.pickerIndex = null;
    return false;
  }
  const cards = resolveFirstCycleCards(lines);
  resetForFirstCycle(cards);
  return true;
}

function useCard(turnIndex, cardIndex) {
  const current = state.actions[turnIndex];
  let used = current?.type === "use" ? [...current.usedIndices] : [];
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
  const host = $("seed-history-turns-v11");
  const progress = $("seed-history-progress-v11");
  const allSkip = $("seed-history-all-skip-v11");
  const clear = $("seed-history-clear-v11");
  if (!host || !progress) return;
  host.replaceChildren();

  if (!state.catalogs) {
    host.innerHTML = '<p class="hint">カード情報を読み込み中…</p>';
    progress.textContent = "読込中";
    return;
  }
  if (!state.firstCycleCards.length) {
    host.innerHTML = '<p class="hint">山札1巡分の観測が完了すると手札が表示されます。</p>';
    progress.textContent = "1周目待ち";
    allSkip.disabled = true;
    clear.disabled = true;
    return;
  }

  const completed = state.actions.filter(actionComplete).length;
  progress.textContent = `${completed} / ${state.relevantHands.length}ターン`;
  allSkip.disabled = !state.relevantHands.length;
  clear.disabled = !state.relevantHands.length;

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
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = card.label;
      detail.textContent = card.onceOnly ? "使用後に除外" : "使用後に捨て札";
      button.append(title, detail);
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

  const remainder = state.firstCycleCards.length % 3;
  if (remainder && state.firstCycleCards.length >= 3) {
    const note = document.createElement("p");
    note.className = "hint seed-history-boundary-v11";
    note.textContent = `1周目の残り${remainder}枚を次ターンで引いた直後に再シャッフルが始まるため、そのターンのカード使用は最初の再シャッフル順には影響しません。`;
    host.append(note);
  }
}

function recycleSource() {
  if (!historyComplete()) return null;
  return buildDiscardBeforeFirstRecycle(state.firstCycleCards, state.actions, 3);
}

function labelForId(id) {
  const card = state.firstCycleCards.find((item) => item.id === id);
  if (card?.label) return card.label;
  return String(state.catalogs?.cardById?.get?.(id)?.name ?? id);
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
  const picker = $("seed-card-picker-v11");
  if (!picker) return;
  picker.replaceChildren();
  const index = state.pickerIndex;
  if (index === null || index === undefined) {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = `2周目 ${index + 1}枚目を選択`;
  picker.append(heading);

  const sourceCounts = new Map();
  for (const card of source) sourceCounts.set(card.id, (sourceCounts.get(card.id) ?? 0) + 1);
  const usedBefore = new Map();
  for (const id of state.secondCycle.slice(0, index)) if (id) usedBefore.set(id, (usedBefore.get(id) ?? 0) + 1);
  const grid = document.createElement("div");
  grid.className = "seed-card-picker-grid-v11";
  for (const [id, count] of sourceCounts) {
    const remaining = count - (usedBefore.get(id) ?? 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = `${labelForId(id)}${count > 1 ? ` ×${remaining}` : ""}`;
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
  const slots = $("seed-recycle-slots-v11");
  const note = $("seed-recycle-note-v11");
  const countBadge = $("seed-recycle-count-v11");
  const add = $("seed-recycle-add-slots-v11");
  const clear = $("seed-recycle-clear-v11");
  if (!slots || !note) return;
  slots.replaceChildren();

  if (!state.firstCycleCards.length) {
    note.textContent = "1周目のカード順を入力してください。";
    countBadge.textContent = "未入力";
    add.hidden = true;
    clear.disabled = true;
    renderPicker([]);
    return;
  }
  if (!historyComplete()) {
    note.textContent = "再シャッフルを正しく再現するため、上の全ターンで使用カードまたはSKIPを指定してください。";
    countBadge.textContent = "履歴待ち";
    add.hidden = true;
    clear.disabled = true;
    renderPicker([]);
    return;
  }

  let resolved;
  try {
    resolved = recycleSource();
  } catch (error) {
    note.textContent = error.message;
    countBadge.textContent = "エラー";
    return;
  }
  const source = resolved.discard;
  const lostCount = resolved.lost.length;
  note.textContent = `最初の再シャッフル対象は${source.length}枚${lostCount ? `（使用後に除外 ${lostCount}枚）` : ""}です。2周目で実際に見えた順にカード枠をタップしてください。`;
  const selected = selectedSecondIds();
  countBadge.textContent = `${selected.length} / ${source.length}枚観測`;
  clear.disabled = !selected.length;

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
    small.textContent = `2周目 ${index + 1}`;
    strong.textContent = id ? labelForId(id) : "タップして選択";
    button.append(small, strong);
    button.addEventListener("click", () => {
      state.pickerIndex = state.pickerIndex === index ? null : index;
      renderSecondCycle();
    });
    slots.append(button);
  }
  add.hidden = visibleCount >= source.length;
  renderPicker(source);
}

function readCandidateSeeds() {
  const resultHost = $("tower-seed-results");
  if (!resultHost) return;
  const text = resultHost.textContent ?? "";
  const seeds = [...resultHost.querySelectorAll("button.seed-candidate")]
    .map((button) => Number(String(button.textContent ?? "").match(/^\s*(\d+)/)?.[1]))
    .filter((value) => Number.isInteger(value))
    .map((value) => value >>> 0);
  state.candidates = [...new Set(seeds)];
  state.candidateSearchComplete = /探索完了/.test(text);
  state.candidateCapped = /候補が100件/.test(text) || /表示を打ち切/.test(text);
  renderRefinedResults();
}

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function renderRefinedResults() {
  const host = $("seed-refined-results-v11");
  if (!host) return;
  host.replaceChildren();
  if (!state.candidates.length) {
    host.innerHTML = '<p class="hint">まず「Seed候補を探索」を実行してください。</p>';
    return;
  }
  if (!historyComplete()) {
    host.innerHTML = `<p class="hint">初期候補 ${state.candidates.length}件。使用履歴を完成させると2周目で絞り込めます。</p>`;
    return;
  }
  const observed = selectedSecondIds();
  if (!observed.length) {
    host.innerHTML = `<p class="hint">初期候補 ${state.candidates.length}件。2周目のカードを1枚以上指定してください。</p>`;
    return;
  }

  let filtered;
  try {
    filtered = filterSeedsByFirstRecycle(
      state.candidates,
      state.firstCycleCards,
      state.actions,
      observed,
      { shuffledCardCount: state.firstCycleCards.filter((card) => !card.isInitial).length, drawPerTurn: 3 },
    );
  } catch (error) {
    host.innerHTML = `<p class="error">${error.message}</p>`;
    return;
  }

  const summary = document.createElement("p");
  summary.className = filtered.length === 1 ? "seed-refine-summary-v11 success" : "seed-refine-summary-v11";
  summary.textContent = `2周目 ${observed.length}枚で絞り込み: ${state.candidates.length}候補 → ${filtered.length}候補`;
  host.append(summary);
  if (state.candidateCapped) {
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = "初期探索が100件で打ち切られているため、ここでの絞り込みは表示された100候補のみが対象です。";
    host.append(warning);
  }
  if (!filtered.length) {
    const warning = document.createElement("p");
    warning.className = "error";
    warning.textContent = "一致候補がありません。1周目の使用履歴・2周目のカード順・除外カードを確認してください。";
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
    button.addEventListener("click", () => { $("tower-seed").value = String(seed); });
    list.append(button);
  }
  host.append(list);
  if (filtered.length === 1) {
    $("tower-seed").value = String(filtered[0]);
    const done = document.createElement("p");
    done.className = "hint";
    done.textContent = "候補を1つに特定したため、Seed入力欄へ自動反映しました。";
    host.append(done);
  }
}

function renderAll() {
  try {
    syncFirstCycle();
    renderHistory();
    renderSecondCycle();
    renderRefinedResults();
  } catch (error) {
    renderHistory();
    const note = $("seed-recycle-note-v11");
    if (note) note.textContent = error.message;
  }
}

async function initialize() {
  ensureStylesheet();
  ensurePanel();
  captureObservationButtonMap();

  const observationHost = $("tower-observation-buttons");
  if (observationHost) new MutationObserver(() => {
    captureObservationButtonMap();
    queueMicrotask(renderAll);
  }).observe(observationHost, { childList: true, subtree: true });

  $("tower-observed")?.addEventListener("input", () => queueMicrotask(renderAll));
  $("tower-reset-observation")?.addEventListener("click", () => setTimeout(renderAll));
  $("tower-undo-observation")?.addEventListener("click", () => setTimeout(renderAll));

  const seedResults = $("tower-seed-results");
  if (seedResults) new MutationObserver(() => queueMicrotask(readCandidateSeeds)).observe(seedResults, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const builder = $("tower-builder");
  if (builder) new MutationObserver(() => queueMicrotask(renderAll)).observe(builder, { childList: true, subtree: true });
  const base = $("tower-base-list");
  if (base) new MutationObserver(() => queueMicrotask(renderAll)).observe(base, { childList: true, subtree: true });

  try {
    state.catalogs = await loadCatalogs();
  } catch (error) {
    const note = $("seed-recycle-note-v11");
    if (note) note.textContent = `カード情報を読み込めませんでした: ${error.message}`;
    return;
  }
  renderAll();
  readCandidateSeeds();
}

initialize().catch((error) => console.warn("seed use history UI failed", error));
