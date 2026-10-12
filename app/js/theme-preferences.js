(() => {
  const storageKey = "steerfold-theme";
  const choices = new Set(["dark", "light", "system"]);
  const systemScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";

  try {
    const saved = localStorage.getItem(storageKey);
    if (choices.has(saved)) preference = saved;
  } catch {
    // Theme switching remains usable when browser storage is unavailable.
  }

  function applyTheme() {
    document.documentElement.dataset.sfTheme = preference === "system"
      ? systemScheme.matches ? "dark" : "light"
      : preference;
  }

  function syncControls() {
    document.querySelectorAll('input[name="sf-theme"]').forEach((input) => {
      input.checked = input.value === preference;
    });
  }

  applyTheme();
  systemScheme.addEventListener("change", () => {
    if (preference === "system") applyTheme();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = choices.has(event.newValue) ? event.newValue : "system";
    applyTheme();
    syncControls();
  });

  document.addEventListener("DOMContentLoaded", () => {
    syncControls();
    document.querySelectorAll('input[name="sf-theme"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked || !choices.has(input.value)) return;
        preference = input.value;
        applyTheme();
        const feedback = document.querySelector("[data-theme-feedback]");
        try {
          localStorage.setItem(storageKey, preference);
          if (feedback) feedback.textContent = "";
        } catch {
          if (feedback) feedback.textContent = "Theme applied, but this browser could not save your preference.";
        }
      });
    });
  });
})();
