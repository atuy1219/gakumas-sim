const MEMORY_STORAGE_KEY = "gakumas-sim-memory-library-v3";
const routeLabels = Object.freeze({
  memory: "メモリー管理",
  cards: "P図鑑 · カード",
  items: "P図鑑 · Pアイテム",
  exam: "試験（オーディション）",
  contest: "コンテスト",
  tower: "ドル道",
  seed: "Seed特定",
});

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
  if (["exam", "contest", "tower"].includes(route)) setSimulationStage(route, "memory");
  setDrawer(false);
}

menuButton.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer.classList.contains("open")) setDrawer(false);
});
for (const button of drawer.querySelectorAll("[data-route]")) {
  button.addEventListener("click", () => openRoute(button.dataset.route));
}

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
  for (const element of panel.querySelectorAll("[data-sim-stage]")) {
    element.hidden = element.dataset.simStage !== stage;
  }
  if (stage === "memory") {
    for (const result of panel.querySelectorAll("[data-sim-result]")) result.hidden = true;
  }
  for (const chip of panel.querySelectorAll(".m3e-flow-nav [data-stage]")) {
    chip.classList.toggle("active", chip.dataset.stage === stage);
  }
  panel.dataset.stage = stage;
  window.scrollTo?.({ top: 0, behavior: "smooth" });
}

addFlowNavigation("contest");
addFlowNavigation("tower");
setSimulationStage("contest", "memory");
setSimulationStage("tower", "memory");

function readMemories() {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function memoryId(memory) {
  return String(memory?.userMemoryId ?? memory?.raw?.userMemoryId ?? "");
}

function memoryCards(memory) {
  const source = memory?.examBattleProduceCards ?? memory?.raw?.examBattleProduceCards;
  return Array.isArray(source) ? source : [];
}

function refreshExamMemories() {
  const select = document.getElementById("exam-memory-select");
  const selected = select.value;
  const memories = readMemories();
  select.replaceChildren(new Option("メモリーを選択", ""));
  for (const memory of memories) {
    const id = memoryId(memory);
    if (!id) continue;
    select.add(new Option(String(memory.label ?? memory.name ?? id), id));
  }
  if (memories.some((memory) => memoryId(memory) === selected)) select.value = selected;
}

function renderExamCards() {
  const select = document.getElementById("exam-memory-select");
  const container = document.getElementById("exam-card-selection");
  const memory = readMemories().find((item) => memoryId(item) === select.value);
  const cards = memoryCards(memory);
  container.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = memory ? "このメモリーにカード情報がありません。" : "メモリーを選択してください。";
    container.append(empty);
    updateExamCardSummary();
    return;
  }
  for (const [index, card] of cards.entries()) {
    const label = document.createElement("label");
    label.className = "m3e-select-card";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.cardIndex = String(index);
    input.addEventListener("change", updateExamCardSummary);
    const text = document.createElement("span");
    const id = String(card?.id ?? card?.produceCardId ?? "カード");
    text.innerHTML = `<strong></strong><small></small>`;
    text.querySelector("strong").textContent = id;
    text.querySelector("small").textContent = Number(card?.upgradeCount ?? 0) > 0 ? `強化 +${card.upgradeCount}` : "未強化";
    label.append(input, text);
    container.append(label);
  }
  updateExamCardSummary();
}

function updateExamCardSummary() {
  const count = document.querySelectorAll("#exam-card-selection input:checked").length;
  document.getElementById("exam-card-summary").textContent = `${count}枚選択`;
}

document.getElementById("exam-memory-select").addEventListener("change", renderExamCards);
document.getElementById("exam-next").addEventListener("click", () => {
  renderExamCards();
  setSimulationStage("exam", "simulation");
});
document.querySelector("#tab-exam .m3e-flow-back").addEventListener("click", () => setSimulationStage("exam", "memory"));
window.addEventListener("storage", refreshExamMemories);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-route='exam']")) refreshExamMemories();
});

const initialRoute = new URLSearchParams(location.search).get("tab") || "memory";
markRoute(initialRoute);
refreshExamMemories();
