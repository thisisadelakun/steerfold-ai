export const SUPPORTED_CURRENCIES = Object.freeze(["CAD", "USD", "GBP", "EUR"]);
const DAY_MS = 86400000;
const MAX_FETCH_AGE_MS = 5 * 60 * 60 * 1000;

export function normalizeCurrency(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SUPPORTED_CURRENCIES.includes(code) ? code : null;
}

export function validReferenceDate(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return false;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return timestamp <= today && today - timestamp <= 7 * DAY_MS;
}

export function validateFxResponse(data, base, quote, now = Date.now()) {
  if (!normalizeCurrency(base) || !normalizeCurrency(quote)
    || data?.base !== base || data?.quote !== quote
    || typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) {
    throw new Error("The exchange-rate response is invalid or does not match the requested pair.");
  }
  if (base === quote) {
    if (data.rate !== 1) throw new Error("The same-currency exchange rate must equal 1.");
    return Object.freeze({ base, quote, rate: 1, provider: null, rateDate: null, fetchedAt: null });
  }
  const fetchedAt = typeof data.fetchedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.fetchedAt)
    ? Date.parse(data.fetchedAt) : NaN;
  if (data.provider !== "Frankfurter" || !validReferenceDate(data.rateDate, now)
    || !Number.isFinite(fetchedAt) || new Date(fetchedAt).toISOString() !== data.fetchedAt
    || fetchedAt > now + 60000 || now - fetchedAt > MAX_FETCH_AGE_MS) {
    throw new Error("A recent, verified exchange rate is unavailable.");
  }
  return Object.freeze({ base, quote, rate: data.rate, provider: data.provider, rateDate: data.rateDate, fetchedAt: data.fetchedAt });
}
