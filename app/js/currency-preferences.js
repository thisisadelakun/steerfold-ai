import { APP_CONFIG } from "./app-config.js";
import { loadFxRate } from "./fx-service.js";
import { SUPPORTED_CURRENCIES, validateFxResponse } from "./fx-validation.js";

// Accounting currency of the current organization, not a product-wide CAD rule.
export const BASE_CURRENCY = APP_CONFIG.portfolio.currencyCode;
const STORAGE_KEY = "steerfold-display-currency";
const CHANGE_EVENT = "currency:changed";
let persistenceAvailable = true;

function normalizePreference(value) {
  return SUPPORTED_CURRENCIES.includes(value) ? value : BASE_CURRENCY;
}

function readPreference() {
  try {
    return normalizePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    persistenceAvailable = false;
    return BASE_CURRENCY;
  }
}

let displayCurrency = readPreference();
let fx = { status: displayCurrency === BASE_CURRENCY ? "ready" : "idle", base: BASE_CURRENCY, quote: displayCurrency, rate: displayCurrency === BASE_CURRENCY ? 1 : null };
let requestVersion = 0;

export function getCurrencyState() {
  const conversionRequired = displayCurrency !== BASE_CURRENCY;
  let ready = fx.status === "ready";
  if (ready) {
    try { validateFxResponse(fx, BASE_CURRENCY, displayCurrency); }
    catch { ready = false; }
  }
  return Object.freeze({
    organizationCurrency: BASE_CURRENCY,
    baseCurrency: BASE_CURRENCY,
    displayCurrency,
    activeCurrency: ready ? displayCurrency : BASE_CURRENCY,
    conversionRequired,
    fxStatus: ready ? "ready" : fx.status === "loading" ? "loading" : "unavailable",
    rate: ready ? fx.rate : null,
    fxRate: ready ? fx.rate : null,
    provider: ready ? fx.provider ?? null : null,
    source: ready ? fx.provider ?? null : null,
    rateDate: ready ? fx.rateDate ?? null : null,
    fetchedAt: ready ? fx.fetchedAt ?? null : null,
    updatedAt: ready ? fx.fetchedAt ?? null : null,
    fxError: ready ? null : fx.error ?? null,
    persistenceAvailable,
  });
}

export async function refreshCurrencyRate() {
  const version = ++requestVersion;
  const quote = displayCurrency;
  if (quote === BASE_CURRENCY) {
    fx = { status: "ready", base: BASE_CURRENCY, quote, rate: 1 };
    notifyChange();
    return getCurrencyState();
  }
  fx = { status: "loading", base: BASE_CURRENCY, quote, rate: null };
  notifyChange();
  const result = await loadFxRate(BASE_CURRENCY, quote);
  if (version !== requestVersion || quote !== displayCurrency) return getCurrencyState();
  fx = result;
  notifyChange();
  return getCurrencyState();
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getCurrencyState() }));
}

export function setDisplayCurrency(value) {
  displayCurrency = normalizePreference(value);
  try {
    localStorage.setItem(STORAGE_KEY, displayCurrency);
    persistenceAvailable = true;
  } catch {
    persistenceAvailable = false;
  }
  refreshCurrencyRate();
  return getCurrencyState();
}

export function subscribeCurrencyChanges(callback) {
  const listener = (event) => callback(event.detail);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    displayCurrency = normalizePreference(event.newValue);
    refreshCurrencyRate();
  });
}
