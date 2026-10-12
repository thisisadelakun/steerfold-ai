import { subscribeCurrencyChanges } from "./currency-preferences.js";

const renderers = new Map();

export function registerCurrencyRenderer(container, render) {
  if (container) renderers.set(container, render);
}

export function refreshCurrencyPresentation() {
  const focused = document.activeElement;
  const selection = focused?.selectionStart;
  const selectionEnd = focused?.selectionEnd;
  for (const [container, render] of [...renderers]) {
    if (!container.isConnected) { renderers.delete(container); continue; }
    render();
  }
  if (focused?.id && !focused.isConnected) {
    const replacement = document.getElementById(focused.id);
    replacement?.focus({ preventScroll: true });
    if (selection != null && typeof replacement?.setSelectionRange === "function") {
      replacement.setSelectionRange(selection, selectionEnd);
    }
  }
}

subscribeCurrencyChanges(refreshCurrencyPresentation);
window.addEventListener("beforeprint", refreshCurrencyPresentation);
