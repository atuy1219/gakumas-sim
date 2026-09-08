import {
  CATALOG_URLS,
  buildCanonicalCardCatalog,
  buildUniqueNameIndex,
  fetchTextWithFallback,
  gradeLabel,
  parseCharacterCatalog,
  parseGradeCatalog,
  parseIdolCardCatalog,
  parseProduceCardCatalog,
  parseProduceItemCatalog,
  planLabel,
} from "./catalog_v4.js";

const $ = (id) => document.getElementById(id);
const CUSTOM_STORE_KEY = "gakumas-sim-custom-count-v4";
const CATALOG_PAGE_SIZE = 160;

const state = {
  characters: [],
  characterById: new Map(),
  idolCards: [],
  idolById: new Map(),
  grades: [],
  cards: [],
  cardById: new Map(),
  cardByName: new Map(),
  items: [],
  itemById: new Map(),
  itemByName: new Map(),
  cardVisible: CATALOG_PAGE_SIZE,
  itemVisible: CATALOG_PAGE_SIZE,
};

let customizeStore = loadCustomizeStore();
let repaintQueued = false;

function loadCustomizeStore() {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_STORE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveCustomizeStore() {
  try {
    localStorage.setItem(CUSTOM_STORE_KEY, JSON.stringify(customizeStore));
  } catch {}
}

function textOption(value, label) {
  const option = document.createElement("option");
  option.value = String(value ?? "");
  option.textContent = String(label ?? value ?? "");
  return option;
}

function replaceEditorInputWithSelect(id) {
  const old = $(id);
  if (!old || old.tagName === "SELECT") return old;
  const select = document.createElement("select");
  select.id = id;
  select.className = old.className;
  select.disabled = old.disabled;
  select.value = old.value;
  old.replaceWith(select);
  return select;
}

function setLabelText(id, text) {
  const input = $(id);
  const label = input?.closest("label");
  const span = label?.querySelector(":scope > span");
  if (span) span.textContent = text;
}

function configureStaticEditorUi() {
  setLabelText("edit-power", "総合力");
  setLabelText("edit-stamina", "体力");
  setLabelText("edit-character", "アイドル");
  setLabelText("edit-idol", "Pアイドル");
  setLabelText("edit-plan", "プラン");
  setLabelText("edit-grade", "評価");

  const idField = $("edit-id")?.closest("label");
  if (idField) {
    idField.classList.add("machine-field");
    const span = idField.querySelector(":scope > span");
    if (span) span.textContent = "UserMemoryId（内部値）";
  }
  const pitemField = $("edit-pitems")?.closest("label");
  if (pitemField) pitemField.classList.add("machine-field");
}

function ensureLegacyOption(select, value, label = null) {
  const text = String(value ?? "");
  if (!text || [...select.options].some((option) => option.value === text)) return;
  select.append(textOption(text, label ?? text));
}

function renderCharacterOptions(preserve = $("edit-character")?.value ?? "") {
  const select = $("edit-character");
  if (!select) return;
  select.innerHTML = "";
  select.append(textOption("", "未指定"));
  for (const character of state.characters.filter((entry) => entry.isPlayable)) {
    select.append(textOption(character.id, character.name));
  }
  ensureLegacyOption(select, preserve);
  select.value = preserve;
}

function idolOptionLabel(card) {
  const character = state.characterById.get(String(card.characterId ?? ""));
  const parts = [card.name];
  if (character?.name) parts.push(character.name);
  const plan = planLabel(card.planType);
  if (plan && plan !== "未指定") parts.push(plan);
  return parts.join(" · ");
}

function renderIdolOptions(characterId = $("edit-character")?.value ?? "", preserve = $("edit-idol")?.value ?? "") {
  const select = $("edit-idol");
  if (!select) return;
  const character = String(characterId ?? "");
  select.innerHTML = "";
  select.append(textOption("", "未指定"));
  const rows = character ? state.idolCards.filter((card) => String(card.characterId ?? "") === character) : state.idolCards;
  for (const card of rows) select.append(textOption(card.id, idolOptionLabel(card)));
  const legacy = state.idolById.get(String(preserve));
  ensureLegacyOption(select, preserve, legacy ? idolOptionLabel(legacy) : preserve);
  select.value = preserve;
}

function renderPlanOptions(preserve = $("edit-plan")?.value ?? "") {
  const select = $("edit-plan");
  if (!select) return;
  const values = [
    "ProducePlanType_Unknown",
    "ProducePlanType_Common",
    "ProducePlanType_Plan1",
    "ProducePlanType_Plan2",
    "ProducePlanType_Plan3",
  ];
  select.innerHTML = "";
  select.append(textOption("", "未指定"));
  for (const value of values.slice(1)) select.append(textOption(value, planLabel(value)));
  ensureLegacyOption(select, preserve, planLabel(preserve));
  select.value = preserve;
}

function renderGradeOptions(preserve = $("edit-grade")?.value ?? "") {
  const select = $("edit-grade");
  if (!select) return;
  select.innerHTML = "";
  select.append(textOption("", "未指定"));
  for (const grade of state.grades) select.append(textOption(grade, gradeLabel(grade)));
  ensureLegacyOption(select, preserve, gradeLabel(preserve));
  select.value = preserve;
}

function configureEditorSelects() {
  const current = {
    character: $("edit-character")?.value ?? "",
    idol: $("edit-idol")?.value ?? "",
    plan: $("edit-plan")?.value ?? "",
    grade: $("edit-grade")?.value ?? "",
  };
  replaceEditorInputWithSelect("edit-character");
  replaceEditorInputWithSelect("edit-idol");
  replaceEditorInputWithSelect("edit-plan");
  replaceEditorInputWithSelect("edit-grade");
  configureStaticEditorUi();
  renderCharacterOptions(current.character);
  renderIdolOptions(current.character, current.idol);
  renderPlanOptions(current.plan);
  renderGradeOptions(current.grade);

  $("edit-character")?.addEventListener("change", () => {
    renderIdolOptions($("edit-character").value, "");
  });
  $("edit-idol")?.addEventListener("change", () => {
    const card = state.idolById.get($("edit-idol").value);
    if (!card) return;
    if (card.characterId) {
      renderCharacterOptions(String(card.characterId));
      $("edit-character").value = String(card.characterId);
    }
    if (card.planType) {
      renderPlanOptions(String(card.planType));
      $("edit-plan").value = String(card.planType);
    }
  });
}

function syncEditorSelectsAfterOpen() {
  const character = $("edit-character")?.value ?? "";
  const idol = $("edit-idol")?.value ?? "";
  const plan = $("edit-plan")?.value ?? "";
  const grade = $("edit-grade")?.value ?? "";
  renderCharacterOptions(character);
  renderIdolOptions(character, idol);
  renderPlanOptions(plan);
  renderGradeOptions(grade);
  renderPitemEditor();
  decorateAllCardRows();
}

function normalizeCardVisibleText(value) {
  const text = String(value ?? "").trim();
  const id = text.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1] ?? (state.cardById.has(text) ? text : null);
  if (id && state.cardById.has(id)) return state.cardById.get(id).baseName;
  const withoutId = text.replace(/\s*(?:—|\|)\s*p_card-\S+\s*$/, "").trim();
  return withoutId.replace(/\++$/, "").trim();
}

function resolveCardVisible(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (state.cardById.has(text)) return state.cardById.get(text);
  const suffix = text.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
  if (suffix && state.cardById.has(suffix)) return state.cardById.get(suffix);
  return state.cardByName.get(normalizeCardVisibleText(text)) ?? null;
}

function rewriteCardDatalist() {
  const datalist = $("produce-card-options");
  if (!datalist || !state.cards.length) return;
  datalist.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const card of state.cards) {
    const option = document.createElement("option");
    option.value = card.baseName;
    fragment.append(option);
  }
  datalist.append(fragment);
}

function importedCustomizeCount(card) {
  if (!Array.isArray(card?.customizes)) return 0;
  return Math.min(3, card.customizes.reduce((sum, customize) => {
    if (customize && typeof customize === "object") return sum + Math.max(0, Number(customize.customizeCount ?? 1));
    return sum + 1;
  }, 0));
}

function editorMemoryId() {
  const input = $("edit-id");
  if (!input) return "manual";
  if (!input.value.trim()) {
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    input.value = `manual-${uuid}`;
  }
  return input.value.trim();
}

function customizeKey(memoryId, cardId, occurrence) {
  return `${memoryId}::${cardId}::${occurrence}`;
}

function decorateCardRow(row) {
  if (!row || row.dataset.v4Decorated === "1") return;
  const inputs = row.querySelectorAll("input");
  if (inputs.length < 3) return;
  row.dataset.v4Decorated = "1";
  const [cardInput, upgradeInput, fixedInput] = inputs;
  cardInput.placeholder = "カード名を入力または選択";
  cardInput.setAttribute("list", "produce-card-options");
  cardInput.value = normalizeCardVisibleText(cardInput.value);
  cardInput.classList.add("card-name-input-v4");

  upgradeInput.type = "hidden";
  fixedInput.type = "hidden";

  const upgradeLabel = document.createElement("label");
  upgradeLabel.className = "compact-control-v4";
  const upgradeTitle = document.createElement("span");
  upgradeTitle.textContent = "強化";
  const upgradeSelect = document.createElement("select");
  upgradeSelect.className = "card-upgrade-select-v4";
  upgradeSelect.append(textOption("0", "無印"), textOption("1", "+"));
  upgradeSelect.value = Number(upgradeInput.value || 0) > 0 ? "1" : "0";
  upgradeSelect.addEventListener("change", () => { upgradeInput.value = upgradeSelect.value; });
  upgradeLabel.append(upgradeTitle, upgradeSelect);

  const customizeLabel = document.createElement("label");
  customizeLabel.className = "compact-control-v4";
  const customizeTitle = document.createElement("span");
  customizeTitle.textContent = "カスタム";
  const customizeSelect = document.createElement("select");
  customizeSelect.className = "card-customize-select-v4";
  for (let count = 0; count <= 3; count += 1) customizeSelect.append(textOption(String(count), `${count}回`));
  customizeSelect.value = String(importedCustomizeCount(row.__originalCard));
  customizeLabel.append(customizeTitle, customizeSelect);

  const note = document.createElement("small");
  note.className = "card-row-note-v4";
  note.textContent = "強化とカスタムは別管理";
  row.insertBefore(upgradeLabel, row.lastElementChild);
  row.insertBefore(customizeLabel, row.lastElementChild);
  row.insertBefore(note, row.lastElementChild);
}

function decorateAllCardRows() {
  document.querySelectorAll("#edit-card-rows .edit-card-row").forEach(decorateCardRow);
}

function captureCardEditorMetadata() {
  const memoryId = editorMemoryId();
  const occurrences = new Map();
  for (const row of document.querySelectorAll("#edit-card-rows .edit-card-row")) {
    const cardInput = row.querySelector("input.card-name-input-v4") ?? row.querySelector("input");
    if (!cardInput?.value.trim()) continue;
    const resolved = resolveCardVisible(cardInput.value);
    const cardId = resolved?.id ?? cardInput.value.trim();
    if (resolved) cardInput.value = resolved.id;
    const occurrence = (occurrences.get(cardId) ?? 0) + 1;
    occurrences.set(cardId, occurrence);
    const count = Number(row.querySelector(".card-customize-select-v4")?.value ?? importedCustomizeCount(row.__originalCard));
    customizeStore[customizeKey(memoryId, cardId, occurrence)] = Math.max(0, Math.min(3, count));
  }
  saveCustomizeStore();
}

function restoreCustomizeSelections() {
  const memoryId = $("edit-id")?.value.trim();
  if (!memoryId) return;
  const occurrences = new Map();
  for (const row of document.querySelectorAll("#edit-card-rows .edit-card-row")) {
    const input = row.querySelector("input.card-name-input-v4") ?? row.querySelector("input");
    const card = resolveCardVisible(input?.value);
    const cardId = card?.id ?? row.__originalCard?.id;
    if (!cardId) continue;
    const occurrence = (occurrences.get(cardId) ?? 0) + 1;
    occurrences.set(cardId, occurrence);
    const stored = customizeStore[customizeKey(memoryId, cardId, occurrence)];
    const select = row.querySelector(".card-customize-select-v4");
    if (select && stored !== undefined) select.value = String(stored);
  }
}

function ensurePitemEditor() {
  const textarea = $("edit-pitems");
  if (!textarea || $("pitem-editor-v4")) return;
  const host = document.createElement("div");
  host.id = "pitem-editor-v4";
  host.className = "pitem-editor-v4 wide";
  host.innerHTML = `
    <span class="field-title-v4">Pアイテム</span>
    <div id="pitem-selected-v4" class="chip-list"></div>
    <div class="inline-add">
      <input id="pitem-input-v4" list="pitem-options-v4" placeholder="Pアイテム名を入力または選択">
      <button id="pitem-add-v4" type="button" class="secondary compact">追加</button>
    </div>
    <small id="pitem-error-v4" class="hint"></small>`;
  textarea.closest("label")?.after(host);
  const datalist = document.createElement("datalist");
  datalist.id = "pitem-options-v4";
  document.body.append(datalist);
  $("pitem-add-v4")?.addEventListener("click", addPitemFromPicker);
  $("pitem-input-v4")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addPitemFromPicker();
  });
}

function rewritePitemDatalist() {
  const datalist = $("pitem-options-v4");
  if (!datalist) return;
  datalist.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of state.items) {
    const option = document.createElement("option");
    option.value = item.name;
    fragment.append(option);
  }
  datalist.append(fragment);
}

function currentPitemIds() {
  return $("edit-pitems")?.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
}

function resolvePitem(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (state.itemById.has(text)) return state.itemById.get(text);
  const suffix = text.match(/(?:—|\||\[)\s*(pitem_[^\]\s]+)\]?\s*$/)?.[1];
  if (suffix && state.itemById.has(suffix)) return state.itemById.get(suffix);
  return state.itemByName.get(text) ?? null;
}

function setPitemIds(ids) {
  const textarea = $("edit-pitems");
  if (textarea) textarea.value = [...new Set(ids.map(String))].join("\n");
  renderPitemEditor();
}

function addPitemFromPicker() {
  const input = $("pitem-input-v4");
  const error = $("pitem-error-v4");
  if (!input) return;
  const item = resolvePitem(input.value);
  if (!item) {
    if (error) error.textContent = "名称が一致するPアイテムを選択してください。";
    return;
  }
  setPitemIds([...currentPitemIds(), item.id]);
  input.value = "";
  if (error) error.textContent = "";
}

function renderPitemEditor() {
  ensurePitemEditor();
  const container = $("pitem-selected-v4");
  if (!container) return;
  container.innerHTML = "";
  const ids = currentPitemIds();
  for (const [index, id] of ids.entries()) {
    const item = state.itemById.get(String(id));
    const chip = document.createElement("span");
    chip.className = "chip removable-chip-v4";
    chip.title = String(id);
    chip.append(document.createTextNode(item?.name ?? String(id)));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${item?.name ?? id}を削除`);
    remove.addEventListener("click", () => setPitemIds(ids.filter((_, i) => i !== index)));
    chip.append(remove);
    container.append(chip);
  }
  if (!ids.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "なし";
    container.append(hint);
  }
}

function replaceTextIds(text) {
  let result = String(text ?? "").replace(/\bPower\s+/g, "総合力 ");
  for (const [id, character] of state.characterById) result = result.replaceAll(id, character.name);
  for (const [id, card] of state.idolById) result = result.replaceAll(id, card.name);
  for (const [id, item] of state.itemById) result = result.replaceAll(id, item.name);
  result = result
    .replaceAll("ProducePlanType_Plan1", "センス")
    .replaceAll("ProducePlanType_Plan2", "ロジック")
    .replaceAll("ProducePlanType_Plan3", "アノマリー")
    .replaceAll("ProducePlanType_Common", "共通");
  return result;
}

function setLeadingText(element, text) {
  const first = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
  if (first) {
    if (first.nodeValue !== text) first.nodeValue = text;
  } else {
    element.prepend(document.createTextNode(text));
  }
}

function applyVisibleNames() {
  for (const subtitle of document.querySelectorAll("#memory-list .memory-card-v3-head small, #memory-list .muted-line")) {
    const next = replaceTextIds(subtitle.textContent);
    if (subtitle.textContent !== next) subtitle.textContent = next;
  }

  for (const chip of document.querySelectorAll("#memory-list .chip[title^='p_card-']")) {
    const card = state.cardById.get(chip.title);
    if (!card) continue;
    const upgraded = /\s\+1\s*$/.test(chip.textContent);
    const next = `${card.baseName}${upgraded ? "+" : ""}`;
    if (chip.textContent !== next) chip.textContent = next;
  }

  for (const label of document.querySelectorAll(".card-check")) {
    const small = label.querySelector("small");
    const strong = label.querySelector("strong");
    if (!small || !strong) continue;
    const id = label.dataset.cardId || small.textContent.match(/p_card-[^\s·]+/)?.[0];
    if (!id) continue;
    label.dataset.cardId = id;
    const card = state.cardById.get(id);
    if (!card) continue;
    const upgraded = label.dataset.upgraded === "1" || /\+1/.test(small.textContent);
    label.dataset.upgraded = upgraded ? "1" : "0";
    const title = `${card.baseName}${upgraded ? "+" : ""}`;
    if (strong.textContent !== title) strong.textContent = title;
    const detail = upgraded ? "強化: +" : "強化: 無印";
    if (small.textContent !== detail) small.textContent = detail;
  }

  for (const chip of document.querySelectorAll("#contest-base-list .chip[title^='p_card-'], #tower-base-list .chip[title^='p_card-']")) {
    const card = state.cardById.get(chip.title);
    if (card) setLeadingText(chip, card.baseName);
  }

  for (const chip of document.querySelectorAll("#contest-pitems .chip, #tower-pitems .chip")) {
    const id = chip.title || (state.itemById.has(chip.textContent) ? chip.textContent : null);
    if (!id) continue;
    const item = state.itemById.get(id);
    if (!item) continue;
    chip.title = id;
    if (chip.textContent !== item.name) chip.textContent = item.name;
  }

  for (const li of document.querySelectorAll("#tower-order-list li")) {
    const small = li.querySelector("small");
    const strong = li.querySelector("strong");
    if (!small || !strong) continue;
    const id = li.dataset.cardId || small.textContent.match(/p_card-[^\s·]+/)?.[0];
    if (!id) continue;
    li.dataset.cardId = id;
    const card = state.cardById.get(id);
    if (!card) continue;
    const upgraded = li.dataset.upgraded === "1" || /\+1/.test(small.textContent);
    li.dataset.upgraded = upgraded ? "1" : "0";
    const prefix = strong.textContent.match(/^\d+\.\s*/)?.[0] ?? "";
    const next = `${prefix}${card.baseName}${upgraded ? "+" : ""}`;
    if (strong.textContent !== next) strong.textContent = next;
    const detail = upgraded ? "強化: +" : "強化: 無印";
    if (small.textContent !== detail) small.textContent = detail;
  }
}

function queueVisibleNameRefresh() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    applyVisibleNames();
  });
}

function friendlyCategory(value) {
  return String(value ?? "").replace(/^ProduceCardCategory_/, "").replace("ActiveSkill", "アクティブ").replace("MentalSkill", "メンタル").replace("Trouble", "トラブル") || "-";
}

function catalogCardElement(card) {
  const article = document.createElement("article");
  article.className = "catalog-entry-v4";
  const title = document.createElement("strong");
  title.textContent = card.baseName;
  const meta = document.createElement("div");
  meta.className = "catalog-meta-v4";
  meta.textContent = `${planLabel(card.planType)} · ${friendlyCategory(card.category)}`;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "内部情報";
  const code = document.createElement("code");
  code.textContent = card.id;
  details.append(summary, code);
  article.append(title, meta, details);
  return article;
}

function catalogItemElement(item) {
  const article = document.createElement("article");
  article.className = "catalog-entry-v4";
  const title = document.createElement("strong");
  title.textContent = item.name;
  const meta = document.createElement("div");
  meta.className = "catalog-meta-v4";
  meta.textContent = planLabel(item.planType);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "内部情報";
  const code = document.createElement("code");
  code.textContent = item.id;
  details.append(summary, code);
  article.append(title, meta, details);
  return article;
}

function renderCardCatalog() {
  const list = $("card-catalog-list");
  if (!list) return;
  const query = $("card-catalog-search")?.value.trim().toLowerCase() ?? "";
  const rows = state.cards.filter((card) => !query || [card.baseName, card.id, planLabel(card.planType), friendlyCategory(card.category)].join(" ").toLowerCase().includes(query));
  list.innerHTML = "";
  for (const card of rows.slice(0, state.cardVisible)) list.append(catalogCardElement(card));
  if ($("card-catalog-count")) $("card-catalog-count").textContent = `${rows.length}種類`;
  const more = $("card-catalog-more");
  if (more) {
    more.hidden = rows.length <= state.cardVisible;
    more.textContent = `さらに表示 (${Math.min(CATALOG_PAGE_SIZE, rows.length - state.cardVisible)}件)`;
  }
}

function renderItemCatalog() {
  const list = $("item-catalog-list");
  if (!list) return;
  const query = $("item-catalog-search")?.value.trim().toLowerCase() ?? "";
  const rows = state.items.filter((item) => !query || [item.name, item.id, planLabel(item.planType)].join(" ").toLowerCase().includes(query));
  list.innerHTML = "";
  for (const item of rows.slice(0, state.itemVisible)) list.append(catalogItemElement(item));
  if ($("item-catalog-count")) $("item-catalog-count").textContent = `${rows.length}種類`;
  const more = $("item-catalog-more");
  if (more) {
    more.hidden = rows.length <= state.itemVisible;
    more.textContent = `さらに表示 (${Math.min(CATALOG_PAGE_SIZE, rows.length - state.itemVisible)}件)`;
  }
}

function attachUiEvents() {
  $("card-catalog-search")?.addEventListener("input", () => {
    state.cardVisible = CATALOG_PAGE_SIZE;
    renderCardCatalog();
  });
  $("item-catalog-search")?.addEventListener("input", () => {
    state.itemVisible = CATALOG_PAGE_SIZE;
    renderItemCatalog();
  });
  $("card-catalog-more")?.addEventListener("click", () => {
    state.cardVisible += CATALOG_PAGE_SIZE;
    renderCardCatalog();
  });
  $("item-catalog-more")?.addEventListener("click", () => {
    state.itemVisible += CATALOG_PAGE_SIZE;
    renderItemCatalog();
  });
  $("edit-save")?.addEventListener("click", captureCardEditorMetadata, { capture: true });
}

function observeDynamicUi() {
  const rows = $("edit-card-rows");
  if (rows) new MutationObserver(() => {
    decorateAllCardRows();
    restoreCustomizeSelections();
  }).observe(rows, { childList: true });

  const editor = $("memory-editor");
  if (editor) new MutationObserver(() => {
    if (editor.hidden) return;
    queueMicrotask(() => {
      syncEditorSelectsAfterOpen();
      restoreCustomizeSelections();
    });
  }).observe(editor, { attributes: true, attributeFilter: ["hidden"] });

  new MutationObserver(queueVisibleNameRefresh).observe(document.body, { childList: true, subtree: true });
}

async function loadCatalogUi() {
  const [characterText, idolText, gradeText, cardText, itemText] = await Promise.all([
    fetchTextWithFallback(CATALOG_URLS.characters),
    fetchTextWithFallback(CATALOG_URLS.idolCards),
    fetchTextWithFallback(CATALOG_URLS.grades),
    fetchTextWithFallback(CATALOG_URLS.cardsPrimary, CATALOG_URLS.cardsFallback),
    fetchTextWithFallback(CATALOG_URLS.itemsPrimary, CATALOG_URLS.itemsFallback),
  ]);

  state.characters = parseCharacterCatalog(characterText);
  state.characterById = new Map(state.characters.map((entry) => [String(entry.id), entry]));
  state.idolCards = parseIdolCardCatalog(idolText);
  state.idolById = new Map(state.idolCards.map((entry) => [String(entry.id), entry]));
  state.grades = parseGradeCatalog(gradeText);
  state.cards = buildCanonicalCardCatalog(parseProduceCardCatalog(cardText));
  state.cardById = new Map(state.cards.map((entry) => [String(entry.id), entry]));
  state.cardByName = buildUniqueNameIndex(state.cards, "baseName");
  state.items = parseProduceItemCatalog(itemText);
  state.itemById = new Map(state.items.map((entry) => [String(entry.id), entry]));
  state.itemByName = buildUniqueNameIndex(state.items, "name");

  configureEditorSelects();
  ensurePitemEditor();
  rewriteCardDatalist();
  rewritePitemDatalist();
  renderCardCatalog();
  renderItemCatalog();
  renderPitemEditor();
  decorateAllCardRows();
  restoreCustomizeSelections();
  applyVisibleNames();

  const status = $("catalog-status");
  if (status) status.textContent = `カード ${state.cards.length}種類 / Pアイテム ${state.items.length}種類 / アイドル ${state.characters.filter((entry) => entry.isPlayable).length}人`;
}

configureStaticEditorUi();
attachUiEvents();
observeDynamicUi();
loadCatalogUi().catch((error) => {
  console.warn("v4 catalog UI initialization failed", error);
  const status = $("catalog-status");
  if (status) status.textContent += " / 名称カタログの一部を取得できませんでした";
});
