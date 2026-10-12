import { normalizeCurrency, validateFxResponse } from "./fx-validation.js";

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();
const pending = new Map();
const states = new Map();

export function getFxState(base, quote) {
  return states.get(`${base}/${quote}`) ?? Object.freeze({ status: "idle", base, quote, error: null });
}

export function loadFxRate(baseValue, quoteValue) {
  const base = normalizeCurrency(baseValue);
  const quote = normalizeCurrency(quoteValue);
  if (!base || !quote) return Promise.resolve(Object.freeze({ status: "unavailable", base, quote, error: "Unsupported display currency pair." }));
  const key = `${base}/${quote}`;
  if (base === quote) {
    const state = Object.freeze({ status: "ready", ...validateFxResponse({ base, quote, rate: 1 }, base, quote), error: null });
    states.set(key, state);
    return Promise.resolve(state);
  }
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      validateFxResponse(cached.state, base, quote);
      states.set(key, cached.state);
      return Promise.resolve(cached.state);
    } catch { cache.delete(key); }
  }
  if (pending.has(key)) return pending.get(key);
  states.set(key, Object.freeze({ status: "loading", base, quote, error: null }));
  const task = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const params = new URLSearchParams({ base, quote });
      const response = await fetch(`/.netlify/functions/fx-rate?${params}`, {
        method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("The exchange-rate service is unavailable.");
      const data = validateFxResponse(await response.json(), base, quote);
      const state = Object.freeze({ status: "ready", ...data, error: null });
      cache.set(key, { state, expiresAt: Date.now() + CACHE_MS });
      states.set(key, state);
      return state;
    } catch (error) {
      cache.delete(key);
      const state = Object.freeze({ status: "unavailable", base, quote, error: controller.signal.aborted
        ? "Exchange-rate lookup timed out." : error?.message || "The exchange rate could not be loaded." });
      states.set(key, state);
      return state;
    } finally {
      clearTimeout(timeout);
      pending.delete(key);
    }
  });
  pending.set(key, task);
  return task;
}
