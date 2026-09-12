import { loadCatalogs } from "./engine.js";
import { observationCardLabel } from "./sim_v3.js";
import {
  evaluateTowerSeedCandidates,
  replayHandUnion,
} from "./seed_runtime_replay_v13.js";
import {
  normalizeSeedObservedName,
  resolveSeedBuilderCardRef,
  seedRefLabels,
} from "./seed_history_ref_v12.js";

const $ = (id) => document.getElementById(id);
const DRAW_PER_TURN = 3;

const state = {
  catalogs: null,
  deckRefs: [],
  expectedInitialOrder: [],
  deckSignature: "",
  candidates: [],
  turnScript: [],
  observedAfterRecycle: [],
  observationButtonMap: new Map(),
  pickerIndex: null,
  evaluation: null,
  lastError: "",
};

function ensureStylesheets() {
  for (const href of ["./seed_history_v11.css", "./seed_runtime_replay_v13.css"]) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

function ensurePanel() {
  $("tower-seed-history-v11")?.remove();
  $("tower-seed-history-v12")?.remove();
  if ($("tower-seed-history-v13")) return;
  const observed = $("tower-observed");
  const anchor = observed?.closest("label");
  if (!anchor) return;

  const panel = document.createElement("section");
  panel.id = "tower-seed-history-v13";
  panel.className = "seed-history-v11 seed-runtime-replay-v13";
  panel.innerHTML = `
    <div class="section-head compact-head">
      <div>
        <h3>Seed特定・操作リプレイ</h3>
        <p class="hint">1周目の並びで残ったSeed候補を、実際のカード使用と同じランタイムで再生して絞ります。</p>
      </div>
      <span id="seed-replay-status-v13" class="badge">準備中</span>
    </div>

    <div class="callout seed-replay-guide-v13">
      <strong>使い方</strong><br>
      ① 上で山札1巡分を実際に引いた順に入力し、「Seed候補を探索」する<br>
      ② 下の手札で、実機で使用したカードを使用順にタップする<br>
      ③ そのターンでこれ以上使わなければ「ターン終了 / SKIP」を押す<br>
      ④ 追加ドロー・仕切り直しもカード効果として再生される。最初の再シャッフル後に見えたカードを観測欄へ入力する
    </div>

    <p id="seed-replay-deck-status-v13" class="hint"></p>

    <div class="section-head compact-head">
      <div>
        <h3>実機操作をリプレイ</h3>
        <p class="hint">点線のカードは現在の候補から予測された手札です。実機で使ったカードだけをタップしてください。</p>
      </div>
      <span id="seed-replay-turn-v13" class="badge">TURN -</span>
    </div>

    <div id="seed-replay-hand-v13" class="m3e-battle-hand seed-history-hand-v11 seed-replay-hand-v13">
      <p class="hint">Seed候補の探索が完了すると手札を再現します。</p>
    </div>
    <p id="seed-replay-effect-v13" class="hint seed-replay-effect-v13"></p>
    <div class="button-row seed-replay-controls-v13">
      <button id="seed-replay-end-turn-v13" type="button" class="secondary" disabled>ターン終了 / SKIP</button>
      <button id="seed-replay-undo-v13" type="button" class="ghost-button" disabled>1操作戻す</button>
      <button id="seed-replay-reset-v13" type="button" class="ghost-button" disabled>操作履歴をクリア</button>
    </div>
    <div id="seed-replay-log-v13" class="seed-replay-log-v13"></div>

    <div class="section-head compact-head">
      <div>
        <h3>最初の再シャッフル後の観測</h3>
        <p class="hint">再シャッフルが発生した瞬間以降に新しく引いたカードを、見えた順に入力します。</p>
      </div>
      <span id="seed-replay-observed-count-v13" class="badge">0枚</span>
    </div>
    <p id="seed-replay-recycle-note-v13" class="callout">操作リプレイを再シャッフル発生地点まで進めてください。</p>
    <div id="seed-replay-observation-slots-v13" class="seed-recycle-slots-v11"></div>
    <div id="seed-replay-picker-v13" class="seed-card-picker-v11" hidden></div>
    <div class="button-row">
      <button id="seed-replay-observation-clear-v13" type="button" class="ghost-button" disabled>再シャッフル後の観測をクリア</button>
    </div>

    <div class="section-head compact-head seed-replay-result-head-v13">
      <div><h3>絞り込み結果</h3></div>
      <span id="seed-replay-result-count-v13" class="badge">未計算</span>
    </div>
    <div id="seed-replay-results-v13" class="seed-refined-results-v11"></div>
  `;
  anchor.after(panel);

  $("seed-replay-end-turn-v13")?.addEventListener("click", endCurrentTurn);
  $("seed-replay-undo-v13")?.addEventListener("click", undoLastAction);
  $("seed-replay-reset-v13")?.addEventListener("click", () => {
    state.turnScript = [];
    state.observedAfterRecycle = [];
    state.pickerIndex = null;
    renderAll();
  });
  $("seed-replay-observation-clear-v13")?.addEventListener("click", () => {
    state.observedAfterRecycle = [];
    state.pickerIndex = null;
    renderAll();
  });
}

function captureObservationButtonMap() {
  const host = $("tower-observation-buttons");
  const map = new Map();
  if (host) {
    for (const button of host.querySelectorAll("button.observation-card")) {
      const id = String(button.title ?? "").trim();
      const label = normalizeSeedObservedName(button.textContent);
      if (!id || !label) continue;
      if (!map.has(label)) map.set(label, new Set());
      map.get(label).add(id);
    }
  }
  state.observationButtonMap = map;
}

function observedLines() {
  return String($("tower-observed")?.value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
      source: "memory",
      visibleName: String(label.querySelector("strong")?.textContent ?? "").trim(),
    });
  }

  for (const chip of document.querySelectorAll("#tower-base-list .chip[title]")) {
    const id = String(chip.title ?? "").trim();
    if (!/^p_card-/.test(id)) continue;
    refs.push({
      id,
      upgradeCount: 0,
      source: "base",
      visibleName: String(chip.firstChild?.textContent ?? chip.textContent ?? "").trim(),
    });
  }
  return refs;
}

function masterFor(ref) {
  const id = String(ref?.id ?? "");
  const upgrade = Number(ref?.upgradeCount ?? 0);
  return state.catalogs?.cardVariantByKey?.get?.(`${id}@@${upgrade}`)
    ?? state.catalogs?.cardVariantByKey?.get?.(`${id}@@${upgrade > 0 ? 1 : 0}`)
    ?? state.catalogs?.cardById?.get?.(id)
    ?? {};
}

function cardLabel(card) {
  const master = masterFor(card);
  const rawName = String(master?.name ?? card?.visibleName ?? card?.id ?? "");
  return observationCardLabel(rawName, Number(card?.upgradeCount ?? 0));
}

function labelsForRef(ref) {
  return seedRefLabels(
    ref,
    state.catalogs?.cardVariantByKey,
    state.catalogs?.cardById,
    observationCardLabel,
  );
}

function resolveInitialOrder(lines, refsInput) {
  const refs = refsInput.map((ref, index) => ({ ...ref, occurrence: index }));
  if (!refs.length) throw new Error("ドル道の編成からカードを取得できません。");
  if (lines.length < refs.length) {
    throw new Error(`1周目の観測が不足しています（${lines.length}/${refs.length}枚）。`);
  }

  const remaining = refs.slice();
  const order = [];
  for (const rawLine of lines.slice(0, refs.length)) {
    const line = normalizeSeedObservedName(rawLine);
    const directId = line.match(/(?:^|—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
    let matches = remaining.filter((ref) => directId ? ref.id === directId : labelsForRef(ref).has(line));
    const buttonIds = state.observationButtonMap.get(line);
    if (matches.length > 1 && buttonIds?.size) {
      const narrowed = matches.filter((ref) => buttonIds.has(ref.id));
      if (narrowed.length) matches = narrowed;
    }
    if (!matches.length) throw new Error(`観測カード「${rawLine}」を現在の編成に対応付けできません。`);
    if (new Set(matches.map((ref) => ref.id)).size > 1) {
      throw new Error(`観測カード「${rawLine}」が複数カードに一致します。観測ボタンから入力してください。`);
    }
    const ref = matches[0];
    remaining.splice(remaining.findIndex((item) => item.occurrence === ref.occurrence), 1);
    order.push({ id: ref.id, upgradeCount: Number(ref.upgradeCount ?? 0), label: cardLabel(ref) });
  }
  return order;
}

function readCandidateSeeds() {
  const host = $("tower-seed-results");
  if (!host) return;
  const seeds = [];
  for (const button of host.querySelectorAll("button.seed-candidate")) {
    const match = String(button.textContent ?? "").match(/^\s*(\d+)/);
    if (match) seeds.push(Number(match[1]) >>> 0);
  }
  state.candidates = [...new Set(seeds)];
}

function syncDeckModel() {
  captureObservationButtonMap();
  const refs = selectedTowerDeckRefs();
  const lines = observedLines();
  state.deckRefs = refs;
  state.lastError = "";

  const status = $("seed-replay-deck-status-v13");
  if (status) status.textContent = `現在の編成 ${refs.length}枚 / 1周目の観測 ${Math.min(lines.length, refs.length)}枚 / Seed候補 ${state.candidates.length}件`;

  if (!refs.length || lines.length < refs.length) {
    state.expectedInitialOrder = [];
    return false;
  }

  try {
    const order = resolveInitialOrder(lines, refs);
    const signature = `${refs.map((ref) => `${ref.id}@@${ref.upgradeCount}`).join("|")}::${order.map((card) => `${card.id}@@${card.upgradeCount}`).join("|")}`;
    if (signature !== state.deckSignature) {
      state.deckSignature = signature;
      state.turnScript = [];
      state.observedAfterRecycle = [];
      state.pickerIndex = null;
    }
    state.expectedInitialOrder = order;
    return true;
  } catch (error) {
    state.expectedInitialOrder = [];
    state.lastError = String(error?.message ?? error);
    return false;
  }
}

function replayOptions() {
  return {
    cardById: state.catalogs?.cardById ?? new Map(),
    cardVariantByKey: state.catalogs?.cardVariantByKey ?? new Map(),
    expectedInitialOrder: state.expectedInitialOrder,
    drawPerTurn: DRAW_PER_TURN,
    stamina: 9999,
    targetScore: 0,
  };
}

function recalculate() {
  if (!state.catalogs || !state.candidates.length || !state.expectedInitialOrder.length || !state.deckRefs.length) {
    state.evaluation = null;
    return null;
  }
  state.evaluation = evaluateTowerSeedCandidates(
    state.candidates,
    state.deckRefs.map((ref) => ({
      id: ref.id,
      upgradeCount: Number(ref.upgradeCount ?? 0),
      fixedDeckOrder: 0,
      source: ref.source,
    })),
    state.turnScript,
    state.observedAfterRecycle,
    replayOptions(),
  );
  return state.evaluation;
}

function ensureCurrentScriptTurn() {
  const last = state.turnScript.at(-1);
  if (!last || last.ended) {
    const next = { plays: [], ended: false };
    state.turnScript.push(next);
    return next;
  }
  return last;
}

function playObservedCard(entry) {
  const step = ensureCurrentScriptTurn();
  step.plays.push({
    id: entry.id,
    upgradeCount: Number(entry.upgradeCount ?? 0),
    occurrence: Number(entry.occurrence ?? 0),
  });
  state.pickerIndex = null;
  renderAll();
}

function endCurrentTurn() {
  const last = state.turnScript.at(-1);
  if (!last || last.ended) state.turnScript.push({ plays: [], ended: true });
  else last.ended = true;
  state.pickerIndex = null;
  renderAll();
}

function undoLastAction() {
  const last = state.turnScript.at(-1);
  if (!last) return;
  if (last.ended) last.ended = false;
  else if (last.plays.length) last.plays.pop();
  else state.turnScript.pop();
  state.pickerIndex = null;
  renderAll();
}

function renderReplayHand() {
  const host = $("seed-replay-hand-v13");
  const turnBadge = $("seed-replay-turn-v13");
  const endButton = $("seed-replay-end-turn-v13");
  const undo = $("seed-replay-undo-v13");
  const reset = $("seed-replay-reset-v13");
  const effect = $("seed-replay-effect-v13");
  if (!host || !turnBadge) return;
  host.replaceChildren();

  const evaluation = state.evaluation;
  if (!evaluation) {
    host.innerHTML = `<p class="hint">${state.lastError || (state.candidates.length ? "山札1巡分の観測を入力してください。" : "まず上の「Seed候補を探索」を実行してください。")}</p>`;
    turnBadge.textContent = "TURN -";
    if (endButton) endButton.disabled = true;
    if (undo) undo.disabled = !state.turnScript.length;
    if (reset) reset.disabled = !state.turnScript.length && !state.observedAfterRecycle.length;
    if (effect) effect.textContent = "";
    return;
  }

  const survivors = evaluation.survivors;
  const union = replayHandUnion(survivors);
  const turns = [...new Set(survivors.map((result) => Number(result.currentTurn ?? 0)).filter(Boolean))];
  turnBadge.textContent = turns.length === 1 ? `TURN ${turns[0]}` : turns.length ? "TURN 分岐" : "TURN -";

  if (!survivors.length) {
    host.innerHTML = '<p class="hint error">操作履歴と一致する候補がありません。1操作戻して確認してください。</p>';
  } else if (!union.length) {
    host.innerHTML = '<p class="hint">現在表示できる手札がありません。</p>';
  } else {
    const total = survivors.length;
    for (const entry of union) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "m3e-hand-card seed-history-card-v11 seed-replay-card-v13";
      const name = document.createElement("strong");
      name.textContent = cardLabel(entry);
      const detail = document.createElement("small");
      detail.textContent = entry.candidateCount === total
        ? `全${total}候補で手札に存在`
        : `${entry.candidateCount}/${total}候補で手札に存在`;
      button.append(name, detail);
      button.addEventListener("click", () => playObservedCard(entry));
      host.append(button);
    }
  }

  const playableSomewhere = survivors.some((result) => Number(result.playsRemaining ?? 0) > 0);
  if (endButton) endButton.disabled = !survivors.length;
  for (const card of host.querySelectorAll("button.seed-replay-card-v13")) card.disabled = !playableSomewhere;
  if (undo) undo.disabled = !state.turnScript.length;
  if (reset) reset.disabled = !state.turnScript.length && !state.observedAfterRecycle.length;

  if (effect) {
    const representative = evaluation.certain[0] ?? evaluation.survivors[0];
    const lastPlay = [...(representative?.trace ?? [])].reverse().find((entry) => entry.type === "play");
    const parts = [];
    if (lastPlay?.effects?.length) parts.push(`直前の効果: ${lastPlay.effects.join(" / ")}`);
    if (lastPlay?.drawn?.length) parts.push(`追加ドロー: ${lastPlay.drawn.map(cardLabel).join(" / ")}`);
    if (evaluation.uncertain.length) parts.push(`未対応効果などで判定保留 ${evaluation.uncertain.length}候補`);
    effect.textContent = parts.join(" · ");
  }
}

function actionLabel(selector) {
  return cardLabel(selector);
}

function renderReplayLog() {
  const host = $("seed-replay-log-v13");
  if (!host) return;
  host.replaceChildren();
  if (!state.turnScript.length) {
    host.innerHTML = '<p class="hint">操作履歴: まだ入力されていません。</p>';
    return;
  }
  state.turnScript.forEach((step, index) => {
    const row = document.createElement("div");
    row.className = "seed-replay-log-row-v13";
    const title = document.createElement("strong");
    title.textContent = `TURN ${index + 1}`;
    const text = document.createElement("span");
    const plays = (step.plays ?? []).map(actionLabel);
    text.textContent = plays.length ? `使用: ${plays.join(" → ")}${step.ended ? " → ターン終了" : ""}` : step.ended ? "SKIP" : "未確定";
    row.append(title, text);
    host.append(row);
  });
}

function observationOptions() {
  const byId = new Map();
  for (const ref of state.deckRefs) if (!byId.has(ref.id)) byId.set(ref.id, ref);
  for (const result of state.evaluation?.survivors ?? []) {
    for (const card of [...(result.postRecycleDraws ?? []), ...(result.currentHand ?? [])]) {
      if (!byId.has(card.id)) byId.set(card.id, card);
    }
  }
  return [...byId.values()].sort((a, b) => cardLabel(a).localeCompare(cardLabel(b), "ja"));
}

function chooseObservedCard(index, card) {
  state.observedAfterRecycle.length = index;
  state.observedAfterRecycle.push(String(card.id));
  state.pickerIndex = null;
  renderAll();
}

function renderObservationPicker(index) {
  const host = $("seed-replay-picker-v13");
  if (!host) return;
  host.replaceChildren();
  if (index === null || index === undefined) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const title = document.createElement("strong");
  title.textContent = `再シャッフル後 ${index + 1}枚目を選択`;
  const grid = document.createElement("div");
  grid.className = "seed-card-picker-grid-v11";
  for (const card of observationOptions()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary compact";
    button.textContent = cardLabel(card);
    button.addEventListener("click", () => chooseObservedCard(index, card));
    grid.append(button);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost-button";
  cancel.textContent = "閉じる";
  cancel.addEventListener("click", () => {
    state.pickerIndex = null;
    renderObservationPicker(null);
  });
  host.append(title, grid, cancel);
}

function renderRecycleObservation() {
  const slots = $("seed-replay-observation-slots-v13");
  const note = $("seed-replay-recycle-note-v13");
  const badge = $("seed-replay-observed-count-v13");
  const clear = $("seed-replay-observation-clear-v13");
  if (!slots || !note || !badge) return;
  slots.replaceChildren();

  const evaluation = state.evaluation;
  const recycleSeen = evaluation?.survivors.some((result) => result.recycleSeen) ?? false;
  const count = state.observedAfterRecycle.length;
  badge.textContent = `${count}枚`;
  if (clear) clear.disabled = count === 0;

  if (!evaluation) note.textContent = "Seed候補と1周目の観測を準備してください。";
  else if (!recycleSeen) note.textContent = "まだ最初の再シャッフルに到達していません。実機と同じ操作を続けてください。";
  else if (!count) note.textContent = "再シャッフルが発生しました。実機で新しく引いたカードを1枚目から指定してください。";
  else note.textContent = `${count}枚の観測でSeed候補を再評価しています。`;

  const slotCount = Math.max(6, count + 3);
  for (let index = 0; index < slotCount; index += 1) {
    const id = state.observedAfterRecycle[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `seed-recycle-slot-v11${id ? " filled" : ""}`;
    const small = document.createElement("small");
    small.textContent = `${index + 1}枚目`;
    const strong = document.createElement("strong");
    const card = id ? observationOptions().find((entry) => String(entry.id) === String(id)) : null;
    strong.textContent = card ? cardLabel(card) : "+ カードを選択";
    button.append(small, strong);
    const firstEmpty = count;
    button.disabled = !recycleSeen || index > firstEmpty;
    button.addEventListener("click", () => {
      if (id) state.observedAfterRecycle.length = index;
      state.pickerIndex = index;
      renderAll();
    });
    slots.append(button);
  }
  renderObservationPicker(state.pickerIndex);
}

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function renderResults() {
  const host = $("seed-replay-results-v13");
  const badge = $("seed-replay-result-count-v13");
  const status = $("seed-replay-status-v13");
  if (!host || !badge || !status) return;
  host.replaceChildren();

  const evaluation = state.evaluation;
  if (!evaluation) {
    badge.textContent = "未計算";
    status.textContent = state.lastError ? "入力エラー" : state.candidates.length ? "1周目待ち" : "Seed探索待ち";
    if (state.lastError) {
      const error = document.createElement("p");
      error.className = "callout error";
      error.textContent = state.lastError;
      host.append(error);
    }
    return;
  }

  const before = state.candidates.length;
  const after = evaluation.survivors.length;
  badge.textContent = `${before} → ${after}候補`;
  status.textContent = evaluation.uncertain.length ? `判定保留 ${evaluation.uncertain.length}` : after === 1 ? "Seed特定" : "操作入力中";

  const summary = document.createElement("p");
  summary.className = `seed-refine-summary-v11${after === 1 && !evaluation.uncertain.length ? " success" : ""}`;
  summary.textContent = evaluation.uncertain.length
    ? `${after}候補が残っています。このうち${evaluation.uncertain.length}候補は未対応効果・条件のため安全側で保留しています。`
    : `${before}候補から${after}候補まで絞り込みました。`;
  host.append(summary);

  if (!after) {
    const warning = document.createElement("p");
    warning.className = "callout error";
    warning.textContent = "一致候補が0件です。使用カードまたは再シャッフル後の観測を1つ戻して確認してください。";
    host.append(warning);
    return;
  }

  const list = document.createElement("div");
  list.className = "seed-refined-list-v11";
  for (const result of evaluation.survivors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-candidate";
    button.textContent = `${result.seed} / ${asHex(result.seed)}${result.status === "uncertain" ? " · 保留" : ""}`;
    button.addEventListener("click", () => {
      const input = $("tower-seed");
      if (input) input.value = String(result.seed);
    });
    list.append(button);
  }
  host.append(list);

  if (after === 1 && !evaluation.uncertain.length) {
    const seed = evaluation.survivors[0].seed;
    const input = $("tower-seed");
    if (input) input.value = String(seed);
  }
}

function renderAll() {
  ensurePanel();
  readCandidateSeeds();
  syncDeckModel();
  recalculate();
  renderReplayHand();
  renderReplayLog();
  renderRecycleObservation();
  renderResults();
}

function observeElement(element, callback, options) {
  if (!element) return;
  new MutationObserver(() => queueMicrotask(callback)).observe(element, options);
}

async function initialize() {
  ensureStylesheets();
  ensurePanel();
  try {
    state.catalogs = await loadCatalogs();
  } catch (error) {
    state.lastError = `カード情報を読み込めませんでした: ${error?.message ?? error}`;
  }

  $("tower-observed")?.addEventListener("input", () => queueMicrotask(renderAll));
  $("tower-observed")?.addEventListener("change", () => queueMicrotask(renderAll));
  observeElement($("tower-seed-results"), renderAll, { childList: true, subtree: true, characterData: true });
  observeElement($("tower-builder"), renderAll, { childList: true, subtree: true, characterData: true, attributes: true });
  observeElement($("tower-base-list"), renderAll, { childList: true, subtree: true, characterData: true, attributes: true });
  observeElement($("tower-observation-buttons"), () => {
    captureObservationButtonMap();
  }, { childList: true, subtree: true, characterData: true, attributes: true });
  renderAll();
}

initialize().catch((error) => {
  console.warn("runtime seed replay UI failed", error);
});
