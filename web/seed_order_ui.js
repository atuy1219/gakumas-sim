(() => {
  const style = document.createElement("style");
  style.textContent = `
    .observed-batch { display: contents !important; }
    .observed-batch > small { display: none !important; }
  `;
  document.head.append(style);

  const normalizeTowerMessages = () => {
    const container = document.getElementById("tower-seed-results");
    if (!container) return;
    for (const node of container.querySelectorAll(".seed-message")) {
      const original = node.textContent ?? "";
      const normalized = original
        .replace(/山札由来([\d,]+)枚・[\d,]+ドロー/g, "観測順$1枚")
        .replace("各ドロー内は順不同。", "入力順をそのまま照合。");
      if (normalized !== original) node.textContent = normalized;
    }
  };

  const towerResults = document.getElementById("tower-seed-results");
  if (towerResults) {
    new MutationObserver(normalizeTowerMessages).observe(towerResults, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
})();
