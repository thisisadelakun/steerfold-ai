import { APP_CONFIG } from "./app-config.js";

export function formatCurrency(
  value,
  currency = APP_CONFIG.portfolio.currencyCode,
  locale = APP_CONFIG.portfolio.locale,
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
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
