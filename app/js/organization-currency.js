import { SUPPORTED_CURRENCIES } from "./fx-validation.js";
import { ORGANIZATION_CONFIG } from "./organization-config.js";

let state = Object.freeze({ currency: ORGANIZATION_CONFIG.currencyCode, status: "loading", updatedAt: null, error: null });
const listeners = new Set();

export function validateOrganizationCurrency(value) {
  if (!SUPPORTED_CURRENCIES.includes(value)) throw new Error("Choose USD, CAD, GBP or EUR as the organization currency.");
  return value;
}

export function getOrganizationCurrency() { return state.currency; }
export function getOrganizationCurrencyState() { return state; }

export function resetWorkspaceCurrency(currency = null) {
  if (currency !== null) validateOrganizationCurrency(currency);
  state = Object.freeze({ currency, status: "loading", updatedAt: null, error: null });
  listeners.forEach((listener) => listener(state));
}

export function acceptOrganizationSettings(row) {
  const currency = validateOrganizationCurrency(row?.organization_currency);
  if (row.id !== true || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) {
    throw new Error("The organization settings response is invalid.");
  }
  state = Object.freeze({ currency, status: "ready", updatedAt: row.updated_at, error: null });
  listeners.forEach((listener) => listener(state));
  return state;
}

export function organizationSettingsUnavailable(error) {
  state = Object.freeze({ ...state, status: "unavailable", error: error.message });
  listeners.forEach((listener) => listener(state));
}

export function requireOrganizationCurrency() {
  if (state.status !== "ready") throw new Error("Organization currency could not be verified. Reload Settings before importing projects.");
  return state.currency;
}

export function subscribeOrganizationCurrency(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
