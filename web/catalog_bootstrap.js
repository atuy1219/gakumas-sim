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
    import("./display_fix_v4.js").catch((error) => console.warn("display name fix load failed", error));
  }, { once: true });
})();
