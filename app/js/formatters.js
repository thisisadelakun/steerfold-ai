import { APP_CONFIG } from "./app-config.js";
import { getCurrencyState } from "./currency-preferences.js";

export function formatCurrency(
  value,
  currency = APP_CONFIG.portfolio.currencyCode,
  locale = APP_CONFIG.portfolio.locale,
  currencyDisplay = "symbol",
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDisplayCurrency(baseValue, locale = APP_CONFIG.portfolio.locale) {
  const state = getCurrencyState();
  if (state.conversionRequired && state.fxStatus === "ready" && Number.isFinite(state.rate) && state.rate > 0) {
    const convertedValue = baseValue * state.rate;
    if (Number.isFinite(baseValue) && Number.isFinite(convertedValue)) return formatCurrency(convertedValue, state.displayCurrency, locale, "code");
  }
  return formatCurrency(baseValue, state.organizationCurrency, locale, "code");
}

export function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function formatDate(
  value,
  locale = APP_CONFIG.portfolio.locale,
) {
  const [month, day, year] = String(value ?? "")
    .split("/")
    .map(Number);

  const date = new Date(year, month - 1, day);

  if (
    !month ||
    !day ||
    !year ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
