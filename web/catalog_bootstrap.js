(() => {
  const nativeFetch = window.fetch.bind(window);
  const CARD_PRIMARY = "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceCard.yaml";
  const CARD_FALLBACK = "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceCard.yaml";

  async function fetchPrimaryOrFallback(primary, fallback, init) {
    try {
      const response = await nativeFetch(primary, init);
      if (response.ok) {
        const text = await response.clone().text();
        if (text.trim()) return response;
      }
    } catch {}
    return nativeFetch(fallback, init);
  }

  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url === CARD_PRIMARY) return fetchPrimaryOrFallback(CARD_PRIMARY, CARD_FALLBACK, init);
    return nativeFetch(input, init);
  };

  window.addEventListener("DOMContentLoaded", () => {
    import("./display_fix.js").catch((error) => console.warn("display name fix load failed", error));
    import("./simulator_filter.js").catch((error) => console.warn("simulator filter load failed", error));
    import("./memory_detail_ui.js").catch((error) => console.warn("memory detail UI load failed", error));
    import("./seed_history_ui.js").catch((error) => console.warn("seed runtime replay UI load failed", error));
    import("./memory_upgrade_ui.js").catch((error) => console.warn("memory upgrade checkbox UI load failed", error));
  }, { once: true });
})();