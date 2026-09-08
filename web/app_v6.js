import {
  CATALOG_URLS,
  buildCanonicalCardCatalog,
  buildUniqueNameIndex,
  fetchTextWithFallback,
  gradeLabel,
  parseIdolCardCatalog,
  parseProduceCardCatalog,
  parseProduceItemCatalog,
} from "./catalog_v4.js";

const MEMORY_STORAGE_KEY = "gakumas-sim-memory-library-v3";

const state = {
  idols: [],
  idolById: new Map(),
  items: [],
  itemById: new Map(),
  cards: [],
  cardById: new Map(),
  cardByName: new Map(),
};

let memorySnapshot = null;
let memoryCache = [];
let refreshQueued = false;

function numberField(memory, name) {
  return Number(memory?.[name] ?? 0) || 0;
}

export function hasNonZeroMemoryStats(memory) {
  return ["power", "vocal", "dance", "visual", "stamina"].some((name) => numberField(memory, name) !== 0);
}

function exactPItemIds(memory) {
  const ids = Array.isArray(memory?.examBattleProduceItemIds) ? memory.examBattleProduceItemIds : [];
  return [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))];
}

export function resolveMemoryPItemIds(memory, idolById) {
  const exact = exactPItemIds(memory);
  if (exact.length) return { ids: exact, source: "memory" };
  if (!hasNonZeroMemoryStats(memory)) return { ids: [], source: "empty" };

  const idol = idolById?.get?.(String(memory?.idolCardId ?? ""));
  if (!idol) return { ids: [], source: "unresolved" };

  // UserMemoryに実戦用PアイテムIDが残っていない場合だけPアイドルのマスターを参照する。
  // 強化段階を復元できない保存データもあるため、最終側を優先しつつ「Pアイドル由来」と明示する。
  const candidates = [
    idol.afterLevelLimitProduceItemId,
    idol.afterProduceItemId,
    idol.beforeLevelLimitProduceItemId,
    idol.beforeProduceItemId,
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
  const first = candidates[0];
  return first ? { ids: [first], source: "idol" } : { ids: [], source: "unresolved" };
}

export function findRestrictedDuplicateIds(cardIds, cardById) {
  const counts = new Map();
  for (const rawId of cardIds ?? []) {
    const id = String(rawId ?? "");
    if (!cardById?.get?.(id)?.noDeckDuplication) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
}

function readMemories() {
  if (typeof localStorage === "undefined") return [];
  const snapshot = localStorage.getItem(MEMORY_STORAGE_KEY) || "[]";
  if (snapshot === memorySnapshot) return memoryCache;
  memorySnapshot = snapshot;
  try {
    const parsed = JSON.parse(snapshot);
    memoryCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    memoryCache = [];
  }
  return memoryCache;
}

function memoryById(id) {
  const target = String(id ?? "");
  return readMemories().find((memory) => String(memory?.userMemoryId ?? "") === target) ?? null;
}

function itemDisplayName(id) {
  return state.itemById.get(String(id))?.name ?? String(id);
}

function idolDisplayName(id) {
  return state.idolById.get(String(id))?.name ?? String(id ?? "");
}

export function hasUsableMemoryStats(memory) {
  const values = ["vocal", "dance", "visual", "stamina"].map((name) => memory?.[name]);
  if (values.some((value) => value !== null && value !== undefined && Number(value) !== 0)) return true;
  // 総合力があるのに4能力がすべて0なら、旧exporterで途中スナップショットを
  // 保存した可能性が高い。実値0とは断定せず未取得として扱う。
  return numberField(memory, "power") === 0;
}

function memoryStatsText(memory) {
  const grade = gradeLabel(memory?.grade);
  const parts = [];
  if (grade !== "未指定") parts.push(`評価 ${grade}`);
  if (numberField(memory, "power")) parts.push(`総合力 ${numberField(memory, "power")}`);
  if (!hasUsableMemoryStats(memory)) {
    parts.push("Vo 未取得", "Da 未取得", "Vi 未取得", "体力 未取得");
  } else {
    parts.push(
      `Vo ${numberField(memory, "vocal")}`,
      `Da ${numberField(memory, "dance")}`,
      `Vi ${numberField(memory, "visual")}`,
      `体力 ${numberField(memory, "stamina")}`,
    );
  }
  return parts.join(" · ");
}

function pItemText(memory) {
  const result = resolveMemoryPItemIds(memory, state.idolById);
  if (result.ids.length) {
    const names = result.ids.map(itemDisplayName).join(" / ");
    return result.source === "idol" ? `${names}（Pアイドル由来）` : names;
  }
  if (result.source === "empty") return "情報なし（能力値がすべて0）";
  return "Pアイテムを特定できません";
}

function ensureSlotDetail(box, memory) {
  let detail = box.querySelector(":scope > .memory-detail-v6");
  if (!memory) {
    detail?.remove();
    return;
  }
  if (!detail) {
    detail = document.createElement("div");
    detail.className = "memory-detail-v6";
    const head = box.querySelector(":scope > .sim-slot-head");
    head?.after(detail);
  }

  const idolName = idolDisplayName(memory.idolCardId);
  const stats = memoryStatsText(memory);
  const pitem = pItemText(memory);
  const signature = `${stats}|${idolName}|${pitem}`;
  if (detail.dataset.signature === signature) return;
  detail.dataset.signature = signature;
  detail.replaceChildren();

  const statLine = document.createElement("div");
  statLine.className = "stat-line memory-stats-v6";
  statLine.textContent = stats;
  const meta = document.createElement("small");
  meta.className = "muted-line";
  const idolPart = memory?.idolCardId ? `Pアイドル: ${idolName}` : "Pアイドル: 未指定";
  meta.textContent = `${idolPart} · Pアイテム: ${pitem}`;
  detail.append(statLine, meta);
}

function cardIdFromLabel(label) {
  const direct = String(label?.dataset?.cardId ?? "");
  if (direct && state.cardById.has(direct)) return direct;
  const strong = label?.querySelector("strong")?.textContent?.trim() ?? "";
  const baseName = strong.replace(/\++$/, "").trim();
  return state.cardByName.get(baseName)?.id ?? null;
}

function ensureRestrictionBadge(label, cardId) {
  const strong = label?.querySelector("strong");
  if (!strong) return;
  let badge = label.querySelector(".card-rule-badge-v6");
  const restricted = Boolean(state.cardById.get(String(cardId))?.noDeckDuplication);
  if (!restricted) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "badge card-rule-badge-v6";
    badge.textContent = "1枚のみ";
    strong.after(badge);
  }
}

function decorateBuilder(mode) {
  const builder = document.getElementById(`${mode}-builder`);
  if (!builder) return;
  for (const box of builder.querySelectorAll(":scope > .sim-memory-slot")) {
    const select = box.querySelector(".sim-slot-head select");
    ensureSlotDetail(box, select?.value ? memoryById(select.value) : null);
    for (const label of box.querySelectorAll(".card-check")) {
      const cardId = cardIdFromLabel(label);
      if (cardId) {
        label.dataset.cardId = String(cardId);
        ensureRestrictionBadge(label, cardId);
      }
    }
  }
}

function selectedMemoryIds(mode) {
  const builder = document.getElementById(`${mode}-builder`);
  if (!builder) return [];
  return [...builder.querySelectorAll(".sim-memory-slot .sim-slot-head select")]
    .map((select) => select.value)
    .filter(Boolean);
}

function renderModePItems(mode) {
  const container = document.getElementById(`${mode}-pitems`);
  if (!container) return;
  const memoryIds = selectedMemoryIds(mode);
  const results = memoryIds.map((id) => memoryById(id)).filter(Boolean).map((memory) => resolveMemoryPItemIds(memory, state.idolById));
  const byId = new Map();
  for (const result of results) {
    for (const id of result.ids) {
      const old = byId.get(id);
      byId.set(id, old === "memory" ? old : result.source);
    }
  }

  const signature = JSON.stringify([...byId.entries()]);
  const currentIds = [...container.querySelectorAll(".pitem-v6")].map((chip) => [chip.dataset.id, chip.dataset.source]);
  if (container.dataset.v6Signature === signature && JSON.stringify(currentIds) === signature) return;
  container.dataset.v6Signature = signature;
  container.replaceChildren();

  if (byId.size) {
    for (const [id, source] of byId) {
      const chip = document.createElement("span");
      chip.className = "chip pitem-v6";
      chip.dataset.id = id;
      chip.dataset.source = source;
      chip.title = id;
      chip.textContent = source === "idol" ? `${itemDisplayName(id)}（Pアイドル由来）` : itemDisplayName(id);
      container.append(chip);
    }
    return;
  }

  const unresolved = results.some((result) => result.source === "unresolved");
  if (!memoryIds.length) container.textContent = "メモリー選択後に表示";
  else if (unresolved) container.textContent = "Pアイテムを特定できません";
  else container.textContent = "Pアイテム情報なし（能力値がすべて0）";
}

function decorateMemoryList() {
  const memories = readMemories();
  const byName = new Map();
  for (const memory of memories) {
    const name = String(memory?.name ?? "");
    if (!name) continue;
    const list = byName.get(name) ?? [];
    list.push(memory);
    byName.set(name, list);
  }

  for (const article of document.querySelectorAll("#memory-list .memory-card-v3")) {
    const title = article.querySelector(".memory-card-v3-head strong")?.textContent ?? "";
    const matches = byName.get(title) ?? [];
    if (matches.length !== 1) continue;
    const line = article.querySelector(".muted-line");
    if (!line) continue;
    const next = `Pアイテム: ${pItemText(matches[0])}`;
    if (line.textContent !== next) line.textContent = next;
  }
}

function decorateCardCatalog() {
  for (const article of document.querySelectorAll("#card-catalog-list .catalog-entry-v4")) {
    const id = article.querySelector("code")?.textContent?.trim();
    if (!id) continue;
    const restricted = Boolean(state.cardById.get(id)?.noDeckDuplication);
    let badge = article.querySelector(".catalog-card-rule-v6");
    if (!restricted) {
      badge?.remove();
      continue;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "badge catalog-card-rule-v6";
      badge.textContent = "デッキに1枚のみ";
      article.querySelector("strong")?.after(badge);
    }
  }
}

function selectedCardIds(mode) {
  const ids = [];
  const builder = document.getElementById(`${mode}-builder`);
  for (const input of builder?.querySelectorAll(".card-check input[type='checkbox']:checked") ?? []) {
    const id = cardIdFromLabel(input.closest(".card-check"));
    if (id) ids.push(String(id));
  }
  for (const chip of document.querySelectorAll(`#${mode}-base-list .chip[title^='p_card-']`)) {
    if (chip.title) ids.push(String(chip.title));
  }
  return ids;
}

function showError(message) {
  const box = document.getElementById("global-error");
  if (!box) return;
  box.textContent = String(message);
  box.hidden = false;
}

function duplicateMessage(ids) {
  const names = ids.map((id) => state.cardById.get(id)?.baseName ?? id);
  return `「${names.join(" / ")}」はデッキに1枚のみ使用可能です。同じカードを複数のメモリー/初期デッキから同時に採用できません。`;
}

function validateModeRestrictions(mode) {
  const duplicates = findRestrictedDuplicateIds(selectedCardIds(mode), state.cardById);
  if (!duplicates.length) return true;
  showError(duplicateMessage(duplicates));
  return false;
}

function modeFromElement(element) {
  if (element?.closest?.("#contest-builder")) return "contest";
  if (element?.closest?.("#tower-builder")) return "tower";
  return null;
}

function onCapturedChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.matches(".card-check input[type='checkbox']") || !input.checked) return;
  const mode = modeFromElement(input);
  if (!mode) return;
  const id = cardIdFromLabel(input.closest(".card-check"));
  if (!id || !state.cardById.get(id)?.noDeckDuplication) return;

  const duplicates = findRestrictedDuplicateIds(selectedCardIds(mode), state.cardById);
  if (!duplicates.includes(id)) return;
  input.checked = false;
  event.stopImmediatePropagation();
  showError(duplicateMessage([id]));
  scheduleRefresh();
}

function onCapturedClick(event) {
  const button = event.target?.closest?.("button");
  if (!button) return;
  const mode = button.id === "contest-run" ? "contest"
    : ["tower-run", "tower-find-seed"].includes(button.id) ? "tower"
      : null;
  if (!mode || validateModeRestrictions(mode)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function refreshVisibleUi() {
  decorateBuilder("contest");
  decorateBuilder("tower");
  renderModePItems("contest");
  renderModePItems("tower");
  decorateMemoryList();
  decorateCardCatalog();
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  const run = () => {
    refreshQueued = false;
    refreshVisibleUi();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function observe(selector) {
  const element = document.querySelector(selector);
  if (element) new MutationObserver(scheduleRefresh).observe(element, { childList: true, subtree: true });
}

async function loadCatalogs() {
  const [idolText, itemText, cardText] = await Promise.all([
    fetchTextWithFallback(CATALOG_URLS.idolCards),
    fetchTextWithFallback(CATALOG_URLS.itemsPrimary, CATALOG_URLS.itemsFallback),
    fetchTextWithFallback(CATALOG_URLS.cardsPrimary, CATALOG_URLS.cardsFallback),
  ]);
  state.idols = parseIdolCardCatalog(idolText);
  state.idolById = new Map(state.idols.map((entry) => [String(entry.id), entry]));
  state.items = parseProduceItemCatalog(itemText);
  state.itemById = new Map(state.items.map((entry) => [String(entry.id), entry]));
  state.cards = buildCanonicalCardCatalog(parseProduceCardCatalog(cardText));
  state.cardById = new Map(state.cards.map((entry) => [String(entry.id), entry]));
  state.cardByName = buildUniqueNameIndex(state.cards, "baseName");
}

async function boot() {
  await loadCatalogs();
  document.addEventListener("change", onCapturedChange, true);
  document.addEventListener("change", scheduleRefresh);
  document.addEventListener("click", onCapturedClick, true);
  observe("#contest-builder");
  observe("#tower-builder");
  observe("#memory-list");
  observe("#card-catalog-list");
  window.addEventListener("storage", (event) => {
    if (event.key !== MEMORY_STORAGE_KEY) return;
    memorySnapshot = null;
    scheduleRefresh();
  });
  scheduleRefresh();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot().catch(console.warn), { once: true });
  else boot().catch((error) => console.warn("v6 detail UI initialization failed", error));
}
