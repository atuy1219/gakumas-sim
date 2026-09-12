(() => {
  const STYLE_ID = "memory-upgrade-ui-v12-style";
  const DECORATED = "memoryUpgradeV12";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .card-upgrade-select-v4.memory-upgrade-select-v12 {
        display: none !important;
      }
      .card-upgrade-checkbox-v12 {
        display: inline-flex !important;
        align-items: center;
        gap: .5rem;
        min-height: 42px;
        padding: .55rem .7rem;
        border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
        border-radius: .9rem;
        color: inherit !important;
        font-size: .88rem !important;
        font-weight: 700;
        cursor: pointer;
        user-select: none;
      }
      .card-upgrade-checkbox-v12 input {
        width: 1.1rem !important;
        height: 1.1rem;
        margin: 0 !important;
        accent-color: var(--m3e-primary, var(--primary, #6750a4));
      }
      .card-upgrade-checkbox-v12.checked {
        border-color: color-mix(in srgb, var(--m3e-primary, var(--primary, #6750a4)) 70%, transparent);
        background: color-mix(in srgb, var(--m3e-primary-container, var(--primary, #6750a4)) 18%, transparent);
      }
      .card-customize-lock-v12 {
        grid-column: 1 / -1;
        margin: 0;
        color: var(--muted, #777);
        font-size: .8rem;
        line-height: 1.45;
      }
      .card-customize-controls-v10[data-upgrade-locked="1"] select.card-customize-action-v10 {
        opacity: .5;
        cursor: not-allowed;
      }
    `;
    document.head.append(style);
  }

  function upgradeSelect(row) {
    return row?.querySelector(".card-upgrade-select-v4") ?? null;
  }

  function upgradeCheckbox(row) {
    return row?.querySelector(".card-upgrade-checkbox-input-v12") ?? null;
  }

  function dispatchChange(element) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setCustomizeLocked(row, locked, { clear = false } = {}) {
    const host = row.querySelector(".card-customize-controls-v10");
    if (!host) return;
    host.dataset.upgradeLocked = locked ? "1" : "0";

    const selects = [...host.querySelectorAll("select.card-customize-action-v10")];
    for (const select of selects) {
      if (locked && clear && select.value) {
        select.value = "";
        dispatchChange(select);
      }
      select.disabled = locked;
    }

    let note = host.querySelector(".card-customize-lock-v12");
    if (locked && selects.length) {
      if (!note) {
        note = document.createElement("small");
        note.className = "card-customize-lock-v12";
        host.prepend(note);
      }
      note.textContent = "カスタマイズするには「強化済み（+）」をオンにしてください。";
    } else {
      note?.remove();
    }
  }

  function syncRow(row, { clearWhenLocked = false } = {}) {
    const select = upgradeSelect(row);
    const checkbox = upgradeCheckbox(row);
    if (!select || !checkbox) return;
    const upgraded = select.value === "1";
    checkbox.checked = upgraded;
    checkbox.closest(".card-upgrade-checkbox-v12")?.classList.toggle("checked", upgraded);
    setCustomizeLocked(row, !upgraded, { clear: clearWhenLocked && !upgraded });
  }

  function decorateRow(row) {
    const select = upgradeSelect(row);
    if (!select) return;

    if (row.dataset[DECORATED] === "1") {
      syncRow(row);
      return;
    }
    row.dataset[DECORATED] = "1";
    select.classList.add("memory-upgrade-select-v12");

    const label = select.closest("label") ?? select.parentElement;
    if (!label) return;

    const choice = document.createElement("span");
    choice.className = "card-upgrade-checkbox-v12";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "card-upgrade-checkbox-input-v12";
    checkbox.checked = select.value === "1";
    checkbox.setAttribute("aria-label", "強化済み");
    const text = document.createElement("span");
    text.textContent = "強化済み（+）";
    choice.append(checkbox, text);
    label.append(choice);

    checkbox.addEventListener("change", () => {
      const next = checkbox.checked ? "1" : "0";
      if (select.value !== next) {
        select.value = next;
        dispatchChange(select);
      }
      syncRow(row, { clearWhenLocked: true });
    });

    select.addEventListener("change", () => syncRow(row));
    syncRow(row, { clearWhenLocked: true });
  }

  function decorateAll() {
    ensureStyles();
    for (const row of document.querySelectorAll("#edit-card-rows .edit-card-row")) decorateRow(row);
  }

  function scheduleDecorate() {
    queueMicrotask(decorateAll);
  }

  function initialize() {
    ensureStyles();
    decorateAll();
    const rows = document.getElementById("edit-card-rows");
    if (rows) {
      new MutationObserver(scheduleDecorate).observe(rows, {
        childList: true,
        subtree: true,
      });
    }
    const editor = document.getElementById("memory-editor");
    if (editor) {
      new MutationObserver(scheduleDecorate).observe(editor, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }
  }

  initialize();
})();
