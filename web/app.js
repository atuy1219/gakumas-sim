import {
  cardDisplayName,
  createManualMemory,
  extractMemories,
  extractStartPlayers,
  loadCatalogs,
  mergeMemoryLibraries,
  parseJson,
  parseMemoryExportText,
  resolveCardInput,
  resolveContestInitialDeck,
  simulateDistribution,
  simulateMemoryLibrary,
  simulateStartPlayer,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "gakumas-card-order-memory-library-v2";
const resultBox = $("result");
const errorBox = $("error");
const drawCountInput = $("draw-count");

let mode = "memory";
let catalogs = { cards: [], cardById: new Map(), initialDecks: [], initialDeckById: new Map() };
let memoryList = [];
let roleSelections = [];
let manualBaseCards = [];
let autoBaseCards = [];
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

function memoryToStored(memory) {
  return {
    userMemoryId: memory.userMemoryId,
    name: memory.label,
    idolCardId: memory.idolCardId ?? "",
    characterId: memory.characterId ?? "",
    planType: memory.planType ?? null,
    power: memory.power ?? 0,
    manualEntry: Boolean(memory.manual),
    examBattleProduceCards: memory.examBattleProduceCards.map((card) => ({
      id: card.id,
      upgradeCount: card.upgradeCount ?? 0,
      fixedDeckOrder: card.fixedDeckOrder ?? 0,
    })),
    activeProduceCardIds: memory.activeProduceCardIds ?? [],
  };
}

function persistLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryList.map(memoryToStored)));
  } catch {}
}

function restoreLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return;
    memoryList = extractMemories({ userMemoryList: raw });
  } catch {}
}

function catalogName(card) {
  return cardDisplayName(card, catalogs.cardById);
}

function renderCatalogOptions() {
  const datalist = $("produce-card-options");
  datalist.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const card of catalogs.cards) {
    const option = document.createElement("option");
    option.value = `${card.name} — ${card.id}`;
    option.label = `${card.name} (${card.id})`;
    fragment.append(option);
  }
  datalist.append(fragment);
}

async function initializeCatalogs() {
  try {
    catalogs = await loadCatalogs();
    $("catalog-dot").classList.add("ok");
    $("catalog-status").textContent = `カード名 ${catalogs.cards.length}件 / 初期デッキ ${catalogs.initialDecks.length}件`;
    renderCatalogOptions();
    renderMemoryLibrary();
    renderSelectedMemoryCards();
    refreshBaseDeck();
  } catch (error) {
    $("catalog-dot").classList.add("warn");
    $("catalog-status").textContent = "カード名データを取得できません。ID表示で続行します。";
    console.warn(error);
  }
}

function memoryCardText(memory) {
  const details = [];
  if (memory.power) details.push(`Power ${memory.power}`);
  if (memory.idolCardId) details.push(memory.idolCardId);
  details.push(`${memory.examBattleProduceCards.length} cards`);
  return details.join(" · ");
}

function renderMemoryLibrary() {
  const container = $("memory-library");
  $("memory-count-label").textContent = `${memoryList.length}件`;
  container.innerHTML = "";
  container.classList.toggle("empty-state", memoryList.length === 0);
  if (!memoryList.length) {
    container.textContent = "メモリーを読み込むか、下から手動追加してください。";
    renderMemorySelectors();
    return;
  }

  for (const memory of memoryList) {
    const article = document.createElement("article");
    article.className = "memory-card";
    const top = document.createElement("div");
    top.className = "memory-card-top";
    const meta = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = memory.label;
    const detail = document.createElement("small");
    detail.textContent = memoryCardText(memory);
    meta.append(title, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      memoryList = memoryList.filter((item) => item.userMemoryId !== memory.userMemoryId);
      persistLibrary();
      renderMemoryLibrary();
    });
    top.append(meta, remove);

    const chips = document.createElement("div");
    chips.className = "chip-list";
    for (const card of memory.examBattleProduceCards) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${catalogName(card)}${card.upgradeCount ? ` +${card.upgradeCount}` : ""}`;
      chip.title = card.id;
      chips.append(chip);
    }
    article.append(top, chips);
    container.append(article);
  }
  renderMemorySelectors();
}

function selectedMemoryIds() {
  return [...$("memory-selectors").querySelectorAll("select")].map((select) => select.value).filter(Boolean);
}

function memoryOptionText(memory) {
  return `${memory.label} · ${memory.examBattleProduceCards.length}枚`;
}

function renderMemorySelectors() {
  const container = $("memory-selectors");
  const count = Number($("memory-count").value);
  const previous = roleSelections.map((role) => role?.memoryId ?? null);
  container.innerHTML = "";
  const roles = count === 2 ? ["Main memory", "Sub memory"] : ["Main memory", "Sub memory 1", "Sub memory 2"];
  roleSelections.length = count;

  roles.forEach((role, index) => {
    const label = document.createElement("label");
    const title = document.createElement("span");
    title.textContent = role;
    const select = document.createElement("select");
    if (!memoryList.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "メモリーを読み込んでください";
      select.append(option);
      select.disabled = true;
      roleSelections[index] = null;
    } else {
      memoryList.forEach((memory, memoryIndex) => {
        const option = document.createElement("option");
        option.value = memory.userMemoryId;
        option.textContent = memoryOptionText(memory);
        if ((previous[index] && previous[index] === memory.userMemoryId) || (!previous[index] && memoryIndex === index)) option.selected = true;
        select.append(option);
      });
      const memory = memoryList.find((item) => item.userMemoryId === select.value) ?? memoryList[0];
      const same = roleSelections[index]?.memoryId === memory.userMemoryId;
      roleSelections[index] = {
        memoryId: memory.userMemoryId,
        activeIds: same ? roleSelections[index].activeIds : new Set(memory.activeProduceCardIds),
      };
    }
    select.addEventListener("change", () => {
      const memory = memoryList.find((item) => item.userMemoryId === select.value);
      roleSelections[index] = memory ? { memoryId: memory.userMemoryId, activeIds: new Set(memory.activeProduceCardIds) } : null;
      renderSelectedMemoryCards();
      refreshBaseDeck();
    });
    label.append(title, select);
    container.append(label);
  });
  renderSelectedMemoryCards();
  refreshBaseDeck();
}

function renderSelectedMemoryCards() {
  const container = $("selected-memory-cards");
  container.innerHTML = "";
  roleSelections.forEach((role, index) => {
    if (!role) return;
    const memory = memoryList.find((item) => item.userMemoryId === role.memoryId);
    if (!memory) return;
    const box = document.createElement("section");
    box.className = "active-card-box";
    const head = document.createElement("div");
    head.className = "active-card-head";
    const title = document.createElement("strong");
    title.textContent = `${index === 0 ? "Main" : `Sub ${index}`} · ${memory.label}`;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "ghost-button";
    all.textContent = "全選択/解除";
    all.addEventListener("click", () => {
      if (role.activeIds.size === memory.examBattleProduceCards.length) role.activeIds.clear();
      else role.activeIds = new Set(memory.examBattleProduceCards.map((card) => card.id));
      renderSelectedMemoryCards();
    });
    head.append(title, all);
    box.append(head);

    const cards = document.createElement("div");
    cards.className = "active-card-list";
    memory.examBattleProduceCards.forEach((card) => {
      const label = document.createElement("label");
      label.className = "card-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = role.activeIds.has(card.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) role.activeIds.add(card.id);
        else role.activeIds.delete(card.id);
      });
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = catalogName(card);
      const id = document.createElement("small");
      id.textContent = `${card.id}${card.upgradeCount ? ` · +${card.upgradeCount}` : ""}`;
      text.append(name, id);
      label.append(checkbox, text);
      cards.append(label);
    });
    if (!memory.examBattleProduceCards.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "このメモリーに ExamBattleProduceCards がありません。";
      cards.append(empty);
    }
    box.append(cards);
    container.append(box);
  });
}

function currentMainMemory() {
  const role = roleSelections[0];
  return role ? memoryList.find((memory) => memory.userMemoryId === role.memoryId) : null;
}

function refreshBaseDeck() {
  autoBaseCards = [];
  const main = currentMainMemory();
  const useAuto = $("auto-contest-deck").checked;
  if (useAuto && main?.idolCardId) {
    const deck = resolveContestInitialDeck(main.idolCardId, catalogs.initialDeckById);
    if (deck) {
      autoBaseCards = deck.cards.map((card) => ({ ...card, source: `initial: ${deck.id}` }));
      $("base-deck-status").textContent = `${deck.id} · ${autoBaseCards.length}枚を自動適用`;
    } else if (catalogs.initialDecks.length) {
      $("base-deck-status").textContent = `${main.idolCardId} に対応するコンテスト初期デッキがありません。必要なカードを手動追加してください。`;
    } else {
      $("base-deck-status").textContent = "初期デッキデータを読み込み中です。";
    }
  } else if (!main?.idolCardId) {
    $("base-deck-status").textContent = "MainメモリーのIdolCardIdがないため自動取得できません。必要なカードを手動追加してください。";
  } else {
    $("base-deck-status").textContent = "自動初期デッキは無効です。";
  }
  renderBaseCards();
}

function allBaseCards() {
  return [...autoBaseCards, ...manualBaseCards];
}

function renderBaseCards() {
  const container = $("base-card-list");
  container.innerHTML = "";
  for (const [index, card] of allBaseCards().entries()) {
    const chip = document.createElement("span");
    chip.className = `chip ${index < autoBaseCards.length ? "auto-chip" : ""}`;
    const label = document.createElement("span");
    label.textContent = catalogName(card);
    label.title = card.id;
    chip.append(label);
    if (index >= autoBaseCards.length) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "削除";
      remove.addEventListener("click", () => {
        manualBaseCards.splice(index - autoBaseCards.length, 1);
        renderBaseCards();
      });
      chip.append(remove);
    }
    container.append(chip);
  }
  if (!allBaseCards().length) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.textContent = "初期/共通カードなし";
    container.append(empty);
  }
}

function addManualCardRow(prefill = "", active = false) {
  const row = document.createElement("div");
  row.className = "manual-card-row";
  const input = document.createElement("input");
  input.setAttribute("list", "produce-card-options");
  input.placeholder = "カード名または p_card-...";
  input.value = prefill;
  const activeLabel = document.createElement("label");
  activeLabel.className = "inline-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = active;
  const text = document.createElement("span");
  text.textContent = "有効";
  activeLabel.append(checkbox, text);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost-button";
  remove.textContent = "削除";
  remove.addEventListener("click", () => row.remove());
  row.append(input, activeLabel, remove);
  $("manual-card-rows").append(row);
}

function readManualCardRows() {
  const cards = [];
  const activeIds = [];
  for (const row of $("manual-card-rows").querySelectorAll(".manual-card-row")) {
    const input = row.querySelector("input[list]");
    if (!input.value.trim()) continue;
    let resolved;
    if (catalogs.cards.length) resolved = resolveCardInput(input.value, catalogs.cards);
    else resolved = { id: input.value.trim(), name: input.value.trim(), upgradeCount: 0 };
    const card = { id: String(resolved.id), upgradeCount: Number(resolved.upgradeCount ?? 0), fixedDeckOrder: 0 };
    cards.push(card);
    if (row.querySelector('input[type="checkbox"]').checked) activeIds.push(card.id);
  }
  return { cards, activeIds };
}

async function importMemoryFiles(files) {
  clearError();
  const imported = [];
  for (const file of files) {
    const text = await file.text();
    const payload = parseMemoryExportText(text);
    imported.push(...extractMemories(payload));
  }
  if (!imported.length) throw new Error("所有メモリーを検出できませんでした。UserMemoryList を含むデータか確認してください。");
  memoryList = mergeMemoryLibraries(memoryList, imported);
  persistLibrary();
  renderMemoryLibrary();
}

$("memory-file").addEventListener("change", async () => {
  try {
    await importMemoryFiles([...( $("memory-file").files ?? [])]);
  } catch (error) {
    showError(error);
  } finally {
    $("memory-file").value = "";
  }
});

$("load-memory-text").addEventListener("click", () => {
  clearError();
  try {
    const payload = parseMemoryExportText($("memory-text").value);
    const imported = extractMemories(payload);
    if (!imported.length) throw new Error("所有メモリーを検出できませんでした。");
    memoryList = mergeMemoryLibraries(memoryList, imported);
    persistLibrary();
    renderMemoryLibrary();
  } catch (error) {
    showError(error);
  }
});

$("clear-memory-library").addEventListener("click", () => {
  memoryList = [];
  roleSelections = [];
  persistLibrary();
  renderMemoryLibrary();
});

$("add-manual-card-row").addEventListener("click", () => addManualCardRow());
$("add-manual-memory").addEventListener("click", () => {
  clearError();
  try {
    const { cards, activeIds } = readManualCardRows();
    if (!cards.length) throw new Error("メモリーのカードを1枚以上入力してください。");
    const memory = createManualMemory({
      userMemoryId: $("manual-memory-id").value.trim(),
      label: $("manual-memory-name").value.trim() || `手動メモリー ${memoryList.length + 1}`,
      idolCardId: $("manual-memory-idol").value.trim(),
      power: Number($("manual-memory-power").value || 0),
      cards,
      activeProduceCardIds: activeIds,
    });
    memoryList = mergeMemoryLibraries(memoryList, [memory]);
    persistLibrary();
    renderMemoryLibrary();
    $("manual-memory-name").value = "";
    $("manual-memory-id").value = "";
    $("manual-memory-idol").value = "";
    $("manual-memory-power").value = "0";
    $("manual-card-rows").innerHTML = "";
    for (let i = 0; i < 6; i += 1) addManualCardRow();
  } catch (error) {
    showError(error);
  }
});

$("memory-count").addEventListener("change", renderMemorySelectors);
$("auto-contest-deck").addEventListener("change", refreshBaseDeck);
$("add-base-card").addEventListener("click", () => {
  clearError();
  try {
    const text = $("base-card-input").value.trim();
    if (!text) return;
    const resolved = catalogs.cards.length ? resolveCardInput(text, catalogs.cards) : { id: text, upgradeCount: 0 };
    manualBaseCards.push({ id: String(resolved.id), upgradeCount: Number(resolved.upgradeCount ?? 0), fixedDeckOrder: 0, source: "manual base" });
    $("base-card-input").value = "";
    renderBaseCards();
  } catch (error) {
    showError(error);
  }
});

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
    $("player-select").innerHTML = "<option>開始データを読み込んでください</option>";
    $("player-select").disabled = true;
    showError(error);
  }
}

$("start-json").addEventListener("change", loadStartPayload);
$("start-file").addEventListener("change", async () => {
  const file = $("start-file").files?.[0];
  if (!file) return;
  try {
    $("start-json").value = await file.text();
    loadStartPayload();
  } catch (error) {
    showError(error);
  }
});

function renderResult(result, badge) {
  clearError();
  $("mode-badge").textContent = badge;
  $("seed-value").textContent = `${result.seed} / ${asHex(result.seed)}`;
  $("state-value").textContent = `${result.randomState} / ${asHex(result.randomState)}`;
  $("deck-count").textContent = `${result.initialDeck.length}枚`;
  $("draw-title").textContent = `先頭${result.draw.length}枚`;
  $("order-list").innerHTML = "";
  $("draw-list").innerHTML = "";

  result.initialDeck.forEach((card, index) => {
    const li = document.createElement("li");
    const number = document.createElement("span");
    const title = document.createElement("div");
    const name = document.createElement("strong");
    const id = document.createElement("small");
    const detail = document.createElement("small");
    number.textContent = String(index + 1);
    name.textContent = catalogName(card);
    id.textContent = card.id;
    title.append(name, id);
    const details = [];
    if (card.source) details.push(card.source);
    if (card.fixedDeckOrder) details.push(`order ${card.fixedDeckOrder}`);
    if (card.upgradeCount) details.push(`+${card.upgradeCount}`);
    detail.textContent = details.join(" · ");
    li.append(number, title, detail);
    $("order-list").append(li);
  });

  result.draw.forEach((card, index) => {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = `${index + 1}. ${catalogName(card)}`;
    detail.textContent = `${card.id}${card.source ? ` · ${card.source}` : ""}`;
    li.append(name, detail);
    $("draw-list").append(li);
  });
  resultBox.hidden = false;
}

$("run-memory").addEventListener("click", () => {
  clearError();
  try {
    const selections = roleSelections.map((role) => ({
      userMemoryId: role?.memoryId,
      activeProduceCardIds: [...(role?.activeIds ?? [])],
    }));
    if (selections.some((item) => !item.userMemoryId)) throw new Error("メモリーを2枚または3枚選択してください。");
    const result = simulateMemoryLibrary(memoryList, selections, allBaseCards(), $("memory-seed").value, drawCountInput.value);
    const base = result.composition.hasBaseCards ? ` + 初期${allBaseCards().length}枚` : "";
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

for (let i = 0; i < 6; i += 1) addManualCardRow();
restoreLibrary();
renderMemoryLibrary();
initializeCatalogs();
