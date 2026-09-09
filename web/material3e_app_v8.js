import { CATALOG_URLS, buildCanonicalCardCatalog, fetchTextWithFallback, parseCharacterCatalog, parseIdolCardCatalog, parseProduceCardCatalog, planLabel } from "./catalog_v4.js";
import { buildExamDeck, changeExamCardCount, filterExamCards, filterExamIdols } from "./exam_setup_v9.js";
import { deriveSeedChoiceVariants, makeCardInstances, seedIntervalFromChoices } from "./sim_v3.js";

const routeLabels = Object.freeze({ memory: "メモリー管理", cards: "P図鑑 · カード", items: "P図鑑 · Pアイテム", exam: "試験（オーディション）", contest: "コンテスト", tower: "ドル道" });
const MAX_SEED_VARIANTS = 64;
const MAX_SEED_MATCHES = 100;
const SEED_TASK_SIZE = 1_000_000;
const menuButton = document.getElementById("m3e-menu");
const drawer = document.getElementById("m3e-drawer");
const scrim = document.getElementById("m3e-scrim");
const currentPage = document.getElementById("m3e-current-page");

function setDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  menuButton.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  document.body.classList.toggle("m3e-drawer-open", open);
  if (open) drawer.querySelector("button")?.focus();
}

function markRoute(route) {
  currentPage.textContent = routeLabels[route] ?? routeLabels.memory;
  for (const button of drawer.querySelectorAll("[data-route]")) {
    button.classList.toggle("active", button.dataset.route === route);
    button.toggleAttribute("aria-current", button.dataset.route === route);
  }
}

function openRoute(route) {
  const tab = document.querySelector(`.app-tab[data-tab="${route}"]`);
  if (!tab) return;
  tab.click();
  markRoute(route);
  if (route === "exam") setSimulationStage(route, "setup");
  if (["contest", "tower"].includes(route)) setSimulationStage(route, "memory");
  setDrawer(false);
}

menuButton.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && drawer.classList.contains("open")) setDrawer(false); });
for (const button of drawer.querySelectorAll("[data-route]")) button.addEventListener("click", () => openRoute(button.dataset.route));

function addFlowNavigation(mode) {
  const panel = document.getElementById(`tab-${mode}`);
  if (!panel || panel.querySelector(".m3e-flow-nav")) return;
  panel.classList.add("m3e-simulator");
  const first = panel.querySelector(":scope > .input-panel");
  const allRest = [...panel.querySelectorAll(":scope > .panel")].filter((item) => item !== first);
  const rest = allRest.filter((item) => !item.classList.contains("simulation-result"));
  const results = allRest.filter((item) => item.classList.contains("simulation-result"));
  first?.setAttribute("data-sim-stage", "memory");
  rest.forEach((item) => item.setAttribute("data-sim-stage", "simulation"));
  results.forEach((item) => item.setAttribute("data-sim-result", ""));
  const flow = document.createElement("div");
  flow.className = "m3e-flow-nav";
  flow.innerHTML = '<span data-stage="memory">1&nbsp; メモリー選択</span><i></i><span data-stage="simulation">2&nbsp; シミュレーション</span>';
  panel.prepend(flow);
  const next = document.createElement("button");
  next.type = "button";
  next.className = "primary m3e-flow-next";
  next.textContent = "シミュレーション設定へ";
  next.addEventListener("click", () => setSimulationStage(mode, "simulation"));
  first?.append(next);
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary m3e-flow-back";
  back.textContent = "メモリー選択へ戻る";
  back.addEventListener("click", () => setSimulationStage(mode, "memory"));
  rest[0]?.prepend(back);
}

function setSimulationStage(mode, stage) {
  const panel = document.getElementById(`tab-${mode}`);
  if (!panel) return;
  for (const element of panel.querySelectorAll("[data-sim-stage]")) element.hidden = element.dataset.simStage !== stage;
  if (["memory", "setup"].includes(stage)) for (const result of panel.querySelectorAll("[data-sim-result]")) result.hidden = true;
  for (const chip of panel.querySelectorAll(".m3e-flow-nav [data-stage]")) chip.classList.toggle("active", chip.dataset.stage === stage);
  panel.dataset.stage = stage;
  window.scrollTo?.({ top: 0, behavior: "smooth" });
}

addFlowNavigation("contest");
addFlowNavigation("tower");
setSimulationStage("contest", "memory");
setSimulationStage("tower", "memory");
setSimulationStage("exam", "setup");

let examCharacters = [];
let examIdols = [];
let examCards = [];
let examCounts = new Map();
let examObserved = [];
let examSeedWorkers = [];
let examSearchCancelled = false;
const examCharacter = document.getElementById("exam-character");
const examPlan = document.getElementById("exam-plan");
const examIdol = document.getElementById("exam-idol");
const examCardSearch = document.getElementById("exam-card-search");
const examDeck = () => buildExamDeck(examCards, examCounts);

function showExamError(message) {
  const box = document.getElementById("global-error");
  box.textContent = message instanceof Error ? message.message : String(message);
  box.hidden = false;
}

function refreshExamIdols() {
  const selected = examIdol.value;
  const idols = filterExamIdols(examIdols, examCharacter.value, examPlan.value);
  examIdol.replaceChildren(new Option(idols.length ? "選択してください" : "対象のPアイドルがありません", ""));
  for (const idol of idols) examIdol.add(new Option(`${idol.name} · ${idol.rarity ?? ""}`, idol.id));
  if (idols.some((idol) => idol.id === selected)) examIdol.value = selected;
}

function updateExamSummary() {
  document.getElementById("exam-card-summary").textContent = `${examDeck().length}枚 · ${examCounts.size}種類選択`;
}

function renderExamCards() {
  const container = document.getElementById("exam-card-selection");
  const cards = filterExamCards(examCards, examPlan.value, examCardSearch.value);
  container.replaceChildren();
  if (!examPlan.value || !cards.length) {
    container.innerHTML = `<p class="hint">${examPlan.value ? "条件に一致するカードがありません。" : "プランを選択してください。"}</p>`;
    updateExamSummary();
    return;
  }
  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "m3e-select-card m3e-quantity-card";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    title.textContent = card.baseName ?? card.name;
    meta.textContent = `${planLabel(card.planType)} · ${card.category ?? "カード"}${card.noDeckDuplication ? " · デッキ内1枚まで" : ""}`;
    text.append(title, meta);
    const controls = document.createElement("span");
    controls.className = "quantity-controls";
    const minus = document.createElement("button");
    const count = document.createElement("b");
    const plus = document.createElement("button");
    minus.type = plus.type = "button";
    minus.textContent = "−";
    plus.textContent = "+";
    count.textContent = String(examCounts.get(card.id) ?? 0);
    minus.setAttribute("aria-label", `${title.textContent}を1枚減らす`);
    plus.setAttribute("aria-label", `${title.textContent}を1枚増やす`);
    minus.disabled = !examCounts.get(card.id);
    plus.disabled = card.noDeckDuplication && examCounts.get(card.id) === 1;
    minus.addEventListener("click", () => { examCounts = changeExamCardCount(examCounts, card, -1); renderExamCards(); });
    plus.addEventListener("click", () => { examCounts = changeExamCardCount(examCounts, card, 1); renderExamCards(); });
    controls.append(minus, count, plus);
    row.append(text, controls);
    container.append(row);
  }
  updateExamSummary();
}

function renderExamDeckSummary() {
  const container = document.getElementById("exam-deck-summary");
  container.replaceChildren();
  const grouped = new Map();
  for (const card of examDeck()) grouped.set(card.id, { card, count: (grouped.get(card.id)?.count ?? 0) + 1 });
  for (const { card, count } of grouped.values()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${card.name} ×${count}`;
    container.append(chip);
  }
}

function renderExamObservation() {
  const deck = examDeck();
  const instances = makeCardInstances(deck);
  const list = document.getElementById("exam-observed-list");
  const buttons = document.getElementById("exam-observation-buttons");
  const names = new Map(deck.map((card) => [String(card.id), card.name]));
  list.replaceChildren();
  if (!examObserved.length) list.innerHTML = '<span class="hint">まだカードがありません。</span>';
  examObserved.forEach((id, index) => {
    const chip = document.createElement("span");
    chip.className = "observed-card";
    chip.textContent = `${index + 1}. ${names.get(String(id)) ?? id}`;
    list.append(chip);
  });
  const complete = Boolean(deck.length) && examObserved.length === deck.length;
  document.getElementById("exam-observed-count").textContent = `${examObserved.length} / ${deck.length}枚${complete ? " · 入力完了" : ""}`;
  document.getElementById("exam-find-seed").disabled = !complete;
  buttons.replaceChildren();
  if (complete) {
    buttons.textContent = "山札1巡分の入力が完了しました。";
    return;
  }
  const used = new Map();
  const seen = new Map();
  const totals = new Map();
  for (const id of examObserved) used.set(String(id), (used.get(String(id)) ?? 0) + 1);
  for (const instance of instances) totals.set(instance.id, (totals.get(instance.id) ?? 0) + 1);
  for (const instance of instances) {
    const ordinal = (seen.get(instance.id) ?? 0) + 1;
    seen.set(instance.id, ordinal);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card";
    button.textContent = `${names.get(instance.id) ?? instance.id}${(totals.get(instance.id) ?? 0) > 1 ? ` #${ordinal}` : ""}`;
    button.disabled = ordinal <= (used.get(instance.id) ?? 0);
    button.addEventListener("click", () => { examObserved.push(instance.id); renderExamObservation(); });
    buttons.append(button);
  }
}

function cancelExamSeedSearch() {
  examSearchCancelled = true;
  for (const worker of examSeedWorkers) worker.terminate();
  examSeedWorkers = [];
  document.getElementById("exam-cancel-seed").hidden = true;
}

function resetExamObservation() {
  cancelExamSeedSearch();
  examObserved = [];
  document.getElementById("exam-seed-results").replaceChildren();
  renderExamObservation();
}

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function renderExamSeedCandidates(matches, scanned, total, complete, note = "") {
  const container = document.getElementById("exam-seed-results");
  container.replaceChildren();
  if (note) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = note;
    container.append(message);
  }
  if (!matches.length && complete) {
    const message = document.createElement("p");
    message.textContent = "一致するSeedがありません。編成と観測した順番を確認してください。";
    container.append(message);
  }
  for (const seed of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-candidate";
    button.textContent = `${seed} / ${asHex(seed)}`;
    button.title = "クリックしてSeedをコピー";
    button.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(String(seed));
      button.textContent = `${seed} / ${asHex(seed)} · コピー済み`;
    });
    container.append(button);
  }
  if (matches.length >= MAX_SEED_MATCHES) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = `候補が${MAX_SEED_MATCHES}件に達したため表示を打ち切りました。編成と入力順を確認してください。`;
    container.append(message);
  }
  if (!complete) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = `${scanned.toLocaleString()} / ${total.toLocaleString()}候補状態を検査中…`;
    container.append(message);
  }
}

async function startExamSeedSearch() {
  cancelExamSeedSearch();
  examSearchCancelled = false;
  const deck = examDeck();
  const { variants, truncated } = deriveSeedChoiceVariants(deck, examObserved, MAX_SEED_VARIANTS);
  if (truncated) throw new Error("同じカードの組み合わせが多すぎます。重複枚数を減らして再度お試しください。");
  const tasks = [];
  let total = 0;
  variants.forEach((choices, variantIndex) => {
    const interval = seedIntervalFromChoices(choices);
    total += interval.size;
    for (let start = interval.start; start < interval.end; start += SEED_TASK_SIZE) tasks.push({ variantIndex, start, end: Math.min(interval.end, start + SEED_TASK_SIZE) });
  });
  const progress = document.getElementById("exam-seed-progress");
  const findButton = document.getElementById("exam-find-seed");
  const cancelButton = document.getElementById("exam-cancel-seed");
  progress.hidden = false;
  progress.max = total;
  progress.value = 0;
  findButton.disabled = true;
  cancelButton.hidden = false;
  renderExamSeedCandidates([], 0, total, false, `山札${deck.length}枚の順番から探索します。`);
  let scanned = 0;
  const matches = new Set();
  let nextTask = 0;
  let active = 0;
  let finished = false;
  const concurrency = Math.max(1, Math.min(8, Number(navigator.hardwareConcurrency || 4)));
  try {
    await new Promise((resolve, reject) => {
      const maybeDone = () => {
        if (!finished && (examSearchCancelled || (nextTask >= tasks.length && active === 0))) {
          finished = true;
          resolve();
        }
      };
      const assign = (worker) => {
        if (examSearchCancelled || matches.size >= MAX_SEED_MATCHES || nextTask >= tasks.length) {
          worker.terminate();
          active -= 1;
          maybeDone();
          return;
        }
        const task = tasks[nextTask++];
        worker.postMessage({ type: "scan", taskId: nextTask, choices: variants[task.variantIndex], deckIds: deck.map((card) => String(card.id)), observedIds: examObserved, drawPerTurn: 3, start: task.start, end: task.end, maxMatches: MAX_SEED_MATCHES - matches.size });
      };
      for (let index = 0; index < Math.min(concurrency, tasks.length); index += 1) {
        const worker = new Worker("./seed_worker.js");
        examSeedWorkers.push(worker);
        active += 1;
        worker.onerror = (event) => reject(new Error(`Seed探索中にエラーが発生しました: ${event.message || "unknown"}`));
        worker.onmessage = (event) => {
          if (event.data?.type !== "done" || finished) return;
          scanned += Number(event.data.scanned ?? 0);
          for (const seed of event.data.found ?? []) matches.add(Number(seed) >>> 0);
          progress.value = Math.min(scanned, total);
          renderExamSeedCandidates([...matches].sort((a, b) => a - b), scanned, total, false);
          assign(worker);
        };
        assign(worker);
      }
    });
    const result = [...matches].sort((a, b) => a - b);
    const complete = !examSearchCancelled;
    renderExamSeedCandidates(result, scanned, total, complete, complete ? `探索完了: ${result.length}候補` : "探索を停止しました。");
  } finally {
    for (const worker of examSeedWorkers) worker.terminate();
    examSeedWorkers = [];
    progress.hidden = true;
    cancelButton.hidden = true;
    findButton.disabled = examObserved.length !== deck.length;
  }
}

async function initializeExamSetup() {
  try {
    const [characterText, idolText, cardText] = await Promise.all([
      fetchTextWithFallback(CATALOG_URLS.characters),
      fetchTextWithFallback(CATALOG_URLS.idolCards),
      fetchTextWithFallback(CATALOG_URLS.cardsPrimary, CATALOG_URLS.cardsFallback),
    ]);
    examCharacters = parseCharacterCatalog(characterText).filter((character) => character.isPlayable);
    examIdols = parseIdolCardCatalog(idolText);
    examCards = buildCanonicalCardCatalog(parseProduceCardCatalog(cardText));
    examCharacter.replaceChildren(new Option("選択してください", ""));
    for (const character of examCharacters) examCharacter.add(new Option(character.name, character.id));
    refreshExamIdols();
    renderExamCards();
  } catch (error) {
    document.getElementById("exam-card-selection").textContent = "カードカタログを読み込めませんでした。再読み込みしてください。";
    showExamError(error);
  }
}

examCharacter.addEventListener("change", () => { refreshExamIdols(); resetExamObservation(); });
examPlan.addEventListener("change", () => { examCounts = new Map(); refreshExamIdols(); renderExamCards(); resetExamObservation(); });
examCardSearch.addEventListener("input", renderExamCards);
document.getElementById("exam-next").addEventListener("click", () => {
  if (!examCharacter.value || !examPlan.value || !examIdol.value) return showExamError("キャラクター、プラン、Pアイドルを選択してください。");
  if (!examDeck().length) return showExamError("使用するカードを1枚以上追加してください。");
  document.getElementById("global-error").hidden = true;
  resetExamObservation();
  renderExamDeckSummary();
  setSimulationStage("exam", "simulation");
});
document.querySelector("#tab-exam .m3e-flow-back").addEventListener("click", () => setSimulationStage("exam", "setup"));
document.getElementById("exam-undo-observation").addEventListener("click", () => { examObserved.pop(); renderExamObservation(); });
document.getElementById("exam-reset-observation").addEventListener("click", resetExamObservation);
document.getElementById("exam-cancel-seed").addEventListener("click", cancelExamSeedSearch);
document.getElementById("exam-find-seed").addEventListener("click", () => startExamSeedSearch().catch(showExamError));

const initialRoute = new URLSearchParams(location.search).get("tab") || "memory";
markRoute(routeLabels[initialRoute] ? initialRoute : "memory");
initializeExamSetup();
