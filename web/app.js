import {
  extractMemories,
  extractStartPlayers,
  parseJson,
  simulateDistribution,
  simulateMemorySelection,
  simulateStartPlayer,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const resultBox = $("result");
const modeBadge = $("mode-badge");
const seedValue = $("seed-value");
const stateValue = $("state-value");
const deckCount = $("deck-count");
const orderList = $("order-list");
const drawList = $("draw-list");
const drawTitle = $("draw-title");
const drawCountInput = $("draw-count");
const errorBox = $("error");
let mode = "memory";
let memoryPayload = null;
let memoryList = [];
let startPayload = null;
let startPlayers = [];

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function showError(error) {
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll(".mode-tab").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  ["memory", "start", "manual"].forEach((name) => { $(`${name}-mode`).hidden = name !== mode; });
  clearError();
}

document.querySelectorAll(".mode-tab").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

function readFileInto(fileInput, textarea, after) {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    textarea.value = String(reader.result ?? "");
    after();
  };
  reader.onerror = () => showError("ファイルを読み取れませんでした。");
  reader.readAsText(file);
}

function memoryOptionText(memory) {
  const active = memory.hasActiveProduceCardIds ? `${memory.activeProduceCardIds.length} cards` : "Active IDなし";
  return `${memory.label} (${active})`;
}

function selectedMemoryIds() {
  return [...$("memory-selectors").querySelectorAll("select")].map((select) => select.value).filter(Boolean);
}

function renderMemorySelectors() {
  const container = $("memory-selectors");
  const count = Number($("memory-count").value);
  const old = selectedMemoryIds();
  container.innerHTML = "";
  const roles = count === 2 ? ["Main memory", "Sub memory"] : ["Main memory", "Sub memory 1", "Sub memory 2"];
  roles.forEach((role, index) => {
    const label = document.createElement("label");
    const title = document.createElement("span");
    title.textContent = role;
    const select = document.createElement("select");
    if (!memoryList.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "メモリーデータを読み込んでください";
      select.append(option);
      select.disabled = true;
    } else {
      memoryList.forEach((memory, memoryIndex) => {
        const option = document.createElement("option");
        option.value = memory.userMemoryId;
        option.textContent = memoryOptionText(memory);
        if ((old[index] && old[index] === memory.userMemoryId) || (!old[index] && memoryIndex === index)) option.selected = true;
        select.append(option);
      });
    }
    select.addEventListener("change", updateMemorySummary);
    label.append(title, select);
    container.append(label);
  });
  updateMemorySummary();
}

function updateMemorySummary() {
  const summary = $("memory-summary");
  if (!memoryList.length) {
    summary.hidden = true;
    return;
  }
  const selected = selectedMemoryIds().map((id) => memoryList.find((memory) => memory.userMemoryId === id)).filter(Boolean);
  const rows = selected.map((memory, index) => {
    const role = index === 0 ? "Main" : `Sub ${index}`;
    const count = memory.hasActiveProduceCardIds ? `${memory.activeProduceCardIds.length}枚` : "ActiveProduceCardIdsなし";
    return `${role}: ${memory.label} — ${count}`;
  });
  summary.textContent = rows.join("\n");
  summary.hidden = false;
}

function loadMemories() {
  clearError();
  try {
    memoryPayload = parseJson($("memory-json").value);
    memoryList = extractMemories(memoryPayload);
    if (!memoryList.length) throw new Error("userMemoryId を持つメモリーが見つかりません。");
    renderMemorySelectors();
  } catch (error) {
    memoryPayload = null;
    memoryList = [];
    renderMemorySelectors();
    showError(error);
  }
}

$("memory-json").addEventListener("change", loadMemories);
$("memory-count").addEventListener("change", renderMemorySelectors);
$("memory-file").addEventListener("change", () => readFileInto($("memory-file"), $("memory-json"), loadMemories));

function playerText(player) {
  const side = player.side === "self" ? "Self" : "Rival";
  const idol = player.idolCardId ? ` · ${player.idolCardId}` : "";
  return `${side} / Stage ${player.stageIndex + 1} / Section ${player.sectionIndex + 1}${idol} · ${player.cards.length} cards · ${asHex(player.seed)}`;
}

function loadStartPayload() {
  clearError();
  try {
    startPayload = parseJson($("start-json").value);
    startPlayers = extractStartPlayers(startPayload);
    const select = $("player-select");
    select.innerHTML = "";
    startPlayers.forEach((player) => {
      const option = document.createElement("option");
      option.value = player.key;
      option.textContent = playerText(player);
      select.append(option);
    });
    select.disabled = false;
  } catch (error) {
    startPayload = null;
    startPlayers = [];
    const select = $("player-select");
    select.innerHTML = "<option>JSONを読み込んでください</option>";
    select.disabled = true;
    showError(error);
  }
}

$("start-json").addEventListener("change", loadStartPayload);
$("start-file").addEventListener("change", () => readFileInto($("start-file"), $("start-json"), loadStartPayload));

function renderResult(result, badge) {
  clearError();
  modeBadge.textContent = badge;
  seedValue.textContent = `${result.seed} / ${asHex(result.seed)}`;
  stateValue.textContent = `${result.randomState} / ${asHex(result.randomState)}`;
  deckCount.textContent = `${result.initialDeck.length}枚`;
  drawTitle.textContent = `先頭${result.draw.length}枚`;
  orderList.innerHTML = "";
  drawList.innerHTML = "";

  result.initialDeck.forEach((card, index) => {
    const li = document.createElement("li");
    const number = document.createElement("span");
    const id = document.createElement("strong");
    const detail = document.createElement("small");
    number.textContent = String(index + 1);
    id.textContent = card.id;
    const details = [];
    if (card.source) details.push(card.source);
    if (card.fixedDeckOrder) details.push(`order ${card.fixedDeckOrder}`);
    if (card.upgradeCount) details.push(`+${card.upgradeCount}`);
    detail.textContent = details.join(" · ");
    li.append(number, id, detail);
    orderList.append(li);
  });

  result.draw.forEach((card, index) => {
    const li = document.createElement("li");
    const id = document.createElement("strong");
    const detail = document.createElement("small");
    id.textContent = `${index + 1}. ${card.id}`;
    detail.textContent = card.source ?? "";
    li.append(id, detail);
    drawList.append(li);
  });
  resultBox.hidden = false;
}

$("run-memory").addEventListener("click", () => {
  clearError();
  try {
    if (!memoryPayload) loadMemories();
    if (!memoryPayload) return;
    const result = simulateMemorySelection(memoryPayload, selectedMemoryIds(), $("memory-seed").value, drawCountInput.value);
    const base = result.composition.hasBaseCards ? " + base" : "";
    renderResult(result, `${result.composition.memories.length} memories${base}`);
    updateUrl();
  } catch (error) {
    resultBox.hidden = true;
    showError(error);
  }
});

$("run-start").addEventListener("click", () => {
  clearError();
  try {
    if (!startPayload) loadStartPayload();
    if (!startPayload) return;
    const result = simulateStartPlayer(startPayload, $("player-select").value, drawCountInput.value);
    renderResult(result, `${result.player.side} start data`);
  } catch (error) {
    resultBox.hidden = true;
    showError(error);
  }
});

$("run-manual").addEventListener("click", () => {
  clearError();
  try {
    const result = simulateDistribution($("manual-deck").value, $("manual-seed").value, drawCountInput.value);
    renderResult(result, result.fixedOrder ? "FixedDeckOrder" : "Seeded shuffle");
    updateUrl();
  } catch (error) {
    resultBox.hidden = true;
    showError(error);
  }
});

function updateUrl() {
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("draw", drawCountInput.value);
  if (mode === "manual") {
    params.set("seed", $("manual-seed").value.trim());
    params.set("deck", $("manual-deck").value);
  } else if (mode === "memory") {
    params.set("seed", $("memory-seed").value.trim());
  }
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

$("copy-link").addEventListener("click", async () => {
  updateUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    $("copy-link").textContent = "コピー済み";
    setTimeout(() => { $("copy-link").textContent = "再現リンクをコピー"; }, 1400);
  } catch {
    $("copy-link").textContent = "URL欄からコピーしてください";
  }
});

const params = new URLSearchParams(location.search);
if (["memory", "start", "manual"].includes(params.get("mode"))) setMode(params.get("mode"));
if (params.has("draw")) drawCountInput.value = params.get("draw");
if (params.has("seed")) {
  $("manual-seed").value = params.get("seed");
  $("memory-seed").value = params.get("seed");
}
if (params.has("deck")) $("manual-deck").value = params.get("deck");
renderMemorySelectors();
