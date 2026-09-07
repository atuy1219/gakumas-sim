import { simulateDistribution } from "./engine.js";

const $ = (id) => document.getElementById(id);
const seedInput = $("seed");
const deckInput = $("deck");
const drawCountInput = $("draw-count");
const resultBox = $("result");
const modeBadge = $("mode-badge");
const stateValue = $("state-value");
const orderList = $("order-list");
const drawList = $("draw-list");
const errorBox = $("error");

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("seed", seedInput.value.trim());
  params.set("draw", drawCountInput.value.trim());
  params.set("deck", deckInput.value);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function render() {
  errorBox.hidden = true;
  resultBox.hidden = true;
  try {
    const result = simulateDistribution(deckInput.value, seedInput.value, drawCountInput.value);
    modeBadge.textContent = result.fixedOrder ? "FixedDeckOrder" : "Seeded shuffle";
    stateValue.textContent = `${result.randomState} / ${asHex(result.randomState)}`;
    orderList.innerHTML = "";
    drawList.innerHTML = "";
    result.initialDeck.forEach((card, index) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${index + 1}</span><strong></strong><small></small>`;
      li.querySelector("strong").textContent = card.id;
      li.querySelector("small").textContent = card.fixedDeckOrder ? `order ${card.fixedDeckOrder}` : "";
      orderList.append(li);
    });
    result.draw.forEach((card, index) => {
      const li = document.createElement("li");
      li.textContent = `${index + 1}. ${card.id}`;
      drawList.append(li);
    });
    resultBox.hidden = false;
    updateUrl();
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  }
}

$("run").addEventListener("click", render);
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
if (params.has("seed")) seedInput.value = params.get("seed");
if (params.has("draw")) drawCountInput.value = params.get("draw");
if (params.has("deck")) deckInput.value = params.get("deck");
render();
