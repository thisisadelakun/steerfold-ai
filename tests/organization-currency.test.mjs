import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const js = new URL("../app/js/", import.meta.url);
const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Brisk & Zip", industry: "", currency: "CAD", isDemo: false, canWrite: true };
const project = { projectId: "P001", projectName: "Fixture", projectManager: "Manager", projectType: "IT",
  strategicPriority: "High", budgetBAC: 300000, plannedValuePV: 175000, earnedValueEV: 150000,
  actualCostAC: 190000, percentComplete: 0.5, riskScore: 20, startDate: "2026-01-02", endDate: "2026-12-31",
  resourceDemand: "High", projectStatus: "Critical" };

async function fixture({ token = "fixture-token", failFx = false, rows, savedPreference = null, writeStatus = 200, returnedCurrency, initialCurrency = "CAD", beforeResponse } = {}) {
  const requests = [];
  let serverCurrency = initialCurrency;
  const storage = new Map(savedPreference ? [["steerfold-display-currency", savedPreference]] : []);
  const context = vm.createContext({ console, URL, URLSearchParams, Intl, Date, AbortController, setTimeout, clearTimeout,
    window: new EventTarget(), CustomEvent,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("/.netlify/")) {
        if (failFx) return { ok: false, status: 503 };
        const params = new URL(url, "https://fixture.invalid").searchParams;
        return { ok: true, json: async () => ({ base: params.get("base"), quote: params.get("quote"), rate: 0.8,
          provider: "Frankfurter", rateDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString() }) };
      }
      if (String(url).includes("set_organization_currency")) {
        if (writeStatus !== 200) return { ok: false, status: writeStatus };
        serverCurrency = returnedCurrency ?? JSON.parse(options.body).p_currency;
      }
      const row = { id: true, organization_currency: serverCurrency, updated_at: new Date().toISOString() };
      await beforeResponse?.();
      return { ok: true, json: async () => String(url).includes("/rpc/") ? row : rows ?? [row] };
    },
  });
  const cache = new Map();
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    let module;
    if (name === "auth-service.js" || name === "supabase-config.js") {
      const exports = name === "auth-service.js" ? { getValidAccessToken: async () => token, getCurrentUser: () => token ? { id: "fixture-user" } : null }
        : { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable-fixture" };
      module = new vm.SyntheticModule(Object.keys(exports), function () {
        Object.entries(exports).forEach(([key, value]) => this.setExport(key, value));
      }, { context });
    } else module = new vm.SourceTextModule(await readFile(new URL(name, js), "utf8"), { context, identifier: name });
    cache.set(name, module);
    await module.link((specifier) => load(specifier.replace("./", "")));
    return module;
  }
  async function api(name) { const module = await load(name); if (module.status !== "evaluated") await module.evaluate(); return module.namespace; }
  const workspaceContext = await api("workspace-context.js");
  workspaceContext.setActiveWorkspace(workspace);
  const organization = await api("organization-currency.js");
  return { api, organization, requests, storage, workspace: workspaceContext,
    setBase(currency) { organization.acceptOrganizationSettings({ id: true, organization_currency: currency, updated_at: new Date().toISOString() }); },
  };
}

test("Brisk & Zip is configured for CAD, not a universal product currency or localStorage authority", async () => {
  const f = await fixture({ savedPreference: "GBP" });
  assert.equal(f.organization.getOrganizationCurrency(), "CAD");
  const { APP_CONFIG } = await f.api("app-config.js");
  assert.equal(APP_CONFIG.organization.name, "Brisk & Zip");
  assert.equal(APP_CONFIG.organization.currencyCode, "CAD");
  assert.equal(APP_CONFIG.portfolio.currencyCode, "CAD");
  assert.equal(f.organization.getOrganizationCurrencyState().status, "loading");
  assert.throws(() => f.organization.requireOrganizationCurrency(), /verified/);
  assert.equal(f.requests.length, 0);
});

test("workspace settings read verifies the singleton and dynamic configuration", async () => {
  const f = await fixture();
  await (await f.api("organization-settings-service.js")).loadOrganizationSettings();
  assert.equal(f.organization.requireOrganizationCurrency(), "CAD");
  assert.match(f.requests[0].url, /organization_settings\?id=eq.true/);
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.requests[0].options.headers["x-steerfold-organization-id"], workspace.id);
  f.setBase("EUR");
  assert.equal((await f.api("app-config.js")).APP_CONFIG.portfolio.currencyCode, "EUR");
});

test("missing, multiple and unsupported settings responses fail closed", async () => {
  for (const rows of [[], [{ id: true, organization_currency: "JPY", updated_at: new Date().toISOString() }], [{}, {}]]) {
    const f = await fixture({ rows });
    await assert.rejects((await f.api("organization-settings-service.js")).loadOrganizationSettings());
    assert.equal(f.organization.getOrganizationCurrencyState().status, "unavailable");
    assert.throws(() => f.organization.requireOrganizationCurrency(), /verified/);
  }
});

test("only USD/CAD/GBP/EUR are accepted, and changes require explicit confirmation and authentication", async () => {
  const f = await fixture({ initialCurrency: "USD" });
  const service = await f.api("organization-settings-service.js");
  for (const currency of ["USD", "CAD", "GBP", "EUR"]) assert.equal(f.organization.validateOrganizationCurrency(currency), currency);
  for (const currency of ["JPY", "usd", "", null]) {
    await assert.rejects(service.updateOrganizationCurrency(currency, { expectedCurrency: "USD", confirmed: true }), /Choose/);
  }
  await assert.rejects(service.updateOrganizationCurrency("GBP", { expectedCurrency: "USD" }), /confirmation/);
  assert.equal(f.requests.length, 0);
  const signedOut = await fixture({ token: null });
  await assert.rejects((await signedOut.api("organization-settings-service.js")).updateOrganizationCurrency("USD", { expectedCurrency: "USD", confirmed: true }), /Sign in/);
  assert.equal(signedOut.requests.length, 0);
  for (const confirmed of [false, null, "true", 1]) {
    await assert.rejects(service.updateOrganizationCurrency("GBP", { expectedCurrency: "USD", confirmed }), /confirmation/);
  }
  assert.equal(f.requests.length, 0);
  await service.updateOrganizationCurrency("GBP", { expectedCurrency: "USD", confirmed: true });
  assert.equal(f.organization.requireOrganizationCurrency(), "GBP");
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.requests[0].options.headers["x-steerfold-organization-id"], workspace.id);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_currency: "GBP", p_expected_currency: "USD", p_confirm: true });
});

test("workspace currency reset drops prior authority and never starts FX for a missing workspace currency", async () => {
  const f = await fixture();
  const preferences = await f.api("currency-preferences.js");
  f.setBase("USD");
  f.organization.resetWorkspaceCurrency("EUR");
  assert.equal(f.organization.getOrganizationCurrency(), "EUR");
  assert.equal(f.organization.getOrganizationCurrencyState().status, "loading");
  assert.throws(() => f.organization.requireOrganizationCurrency(), /verified/);
  f.organization.resetWorkspaceCurrency();
  assert.equal(f.organization.getOrganizationCurrency(), null);
  assert.equal(f.organization.getOrganizationCurrencyState().updatedAt, null);
  await preferences.refreshCurrencyRate();
  assert.equal(f.requests.length, 0);
});

test("organization currency rejects late reads after same-ID workspace replacement", async () => {
  let f;
  f = await fixture({ beforeResponse: () => f.workspace.setActiveWorkspace(workspace) });
  const service = await f.api("organization-settings-service.js");
  await assert.rejects(service.loadOrganizationSettings(), /Workspace changed/);
  assert.equal(f.requests.length, 1);
  assert.throws(() => f.organization.requireOrganizationCurrency(), /verified/);
});

test("missing and read-only workspaces prevent organization currency writes", async () => {
  const f = await fixture();
  const service = await f.api("organization-settings-service.js");
  for (const selected of [null, { ...workspace, canWrite: false }]) {
    f.workspace.setActiveWorkspace(selected);
    await assert.rejects(service.updateOrganizationCurrency("CAD", { expectedCurrency: "CAD" }), /read-only|unavailable/);
  }
  f.workspace.setActiveWorkspace(null);
  await assert.rejects(service.loadOrganizationSettings(), /workspace/);
  assert.equal(f.requests.length, 0);
});

test("confirming the unchanged currency needs no acknowledgement and sends false explicitly", async () => {
  const f = await fixture();
  await (await f.api("organization-settings-service.js")).updateOrganizationCurrency("CAD", { expectedCurrency: "CAD" });
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_currency: "CAD", p_expected_currency: "CAD", p_confirm: false });
  assert.equal(f.organization.requireOrganizationCurrency(), "CAD");
});

test("same-currency combinations never call FX; absent display preference follows organization", async () => {
  const f = await fixture(); const preferences = await f.api("currency-preferences.js");
  for (const currency of ["CAD", "USD", "GBP", "EUR"]) {
    f.setBase(currency);
    await preferences.refreshCurrencyRate();
    const state = preferences.getCurrencyState();
    assert.equal(state.displayCurrency, currency);
    assert.equal(state.rate, 1);
    assert.equal(state.conversionRequired, false);
  }
  assert.equal(f.requests.length, 0);
});

test("an unverified organization currency never starts display conversion", async () => {
  const f = await fixture();
  const preferences = await f.api("currency-preferences.js");
  preferences.setDisplayCurrency("GBP"); await preferences.refreshCurrencyRate();
  assert.equal(preferences.getCurrencyState().fxStatus, "unavailable");
  assert.equal(preferences.getCurrencyState().organizationCurrency, "CAD");
  assert.equal(preferences.getCurrencyState().activeCurrency, "CAD");
  assert.equal(f.requests.length, 0);
  f.setBase("USD"); await preferences.refreshCurrencyRate();
  assert.equal(preferences.getCurrencyState().fxStatus, "ready");
  assert.equal(f.requests.length, 1);
});

test("denied, stale and failed settings updates never claim a currency change or retry automatically", async () => {
  for (const status of [401, 403, 409, 500]) {
    const f = await fixture({ writeStatus: status }); f.setBase("USD");
    await assert.rejects((await f.api("organization-settings-service.js")).updateOrganizationCurrency("USD", { expectedCurrency: "USD", confirmed: true }), /Admin|elsewhere|unavailable/);
    assert.equal(f.organization.getOrganizationCurrency(), "USD");
    assert.equal(f.organization.getOrganizationCurrencyState().status, "unavailable");
    assert.equal(f.requests.length, 1);
  }
});

test("explicit display preference persists independently of organization updates", async () => {
  const f = await fixture({ savedPreference: "GBP" });
  const preferences = await f.api("currency-preferences.js");
  f.setBase("EUR"); await preferences.refreshCurrencyRate();
  assert.equal(preferences.getCurrencyState().displayCurrency, "GBP");
  assert.equal(f.storage.get("steerfold-display-currency"), "GBP");
  preferences.setDisplayCurrency("USD"); await preferences.refreshCurrencyRate();
  assert.equal(f.organization.getOrganizationCurrency(), "EUR");
  assert.equal(f.storage.get("steerfold-display-currency"), "USD");
  assert.equal(f.storage.size, 1);
});

test("a successful HTTP response cannot claim a different currency was saved", async () => {
  const f = await fixture({ returnedCurrency: "EUR" }); f.setBase("USD");
  await assert.rejects((await f.api("organization-settings-service.js")).updateOrganizationCurrency("USD", { expectedCurrency: "USD", confirmed: true }), /response could not be verified/);
  assert.equal(f.organization.getOrganizationCurrency(), "USD");
  assert.equal(f.organization.getOrganizationCurrencyState().status, "unavailable");
  assert.equal(f.requests.length, 1);
});

test("CAD to USD and other organization pairs convert presentation only through same-origin FX", async () => {
  const f = await fixture(); const preferences = await f.api("currency-preferences.js");
  const formatter = await f.api("formatters.js");
  for (const [base, quote] of [["CAD", "USD"], ["USD", "GBP"], ["EUR", "USD"]]) {
    f.setBase(base); preferences.setDisplayCurrency(quote); await preferences.refreshCurrencyRate();
    assert.equal(preferences.getCurrencyState().activeCurrency, quote);
    assert.match(formatter.formatDisplayCurrency(100), new RegExp(`${quote}.*80`));
    assert.equal(f.organization.getOrganizationCurrency(), base);
    assert.ok(f.requests.some(({ url }) => url === `/.netlify/functions/fx-rate?base=${base}&quote=${quote}`));
  }
});

test("FX failure falls back to the current organization, never specifically CAD", async () => {
  const f = await fixture({ failFx: true });
  const preferences = await f.api("currency-preferences.js"); const formatter = await f.api("formatters.js");
  for (const [base, quote] of [["CAD", "USD"], ["USD", "CAD"], ["GBP", "CAD"], ["EUR", "CAD"]]) {
    f.setBase(base); preferences.setDisplayCurrency(quote); await preferences.refreshCurrencyRate();
    assert.equal(preferences.getCurrencyState().fxStatus, "unavailable");
    assert.match(formatter.formatDisplayCurrency(100), new RegExp(`${base}.*100`));
  }
});

test("currency changes do not rescale EVM/forecast values, ratios or intelligence ranking", async () => {
  const f = await fixture();
  const analytics = await f.api("portfolio-analytics.js"); const intelligence = await f.api("portfolio-intelligence.js");
  const formatter = await f.api("formatters.js");
  const snapshot = JSON.stringify(project);
  const evm = JSON.stringify(analytics.calculateProjectEvm(project));
  const forecast = JSON.stringify(analytics.calculateProjectForecast(project));
  const ranking = JSON.stringify(intelligence.getPortfolioIntelligence([project]));
  for (const currency of ["USD", "CAD", "GBP", "EUR"]) {
    f.setBase(currency);
    assert.equal(JSON.stringify(analytics.calculateProjectEvm(project)), evm);
    assert.equal(JSON.stringify(analytics.calculateProjectForecast(project)), forecast);
    assert.equal(JSON.stringify(intelligence.getPortfolioIntelligence([project])), ranking);
    assert.match(formatter.formatCurrency(-40000, undefined, undefined, "code"), new RegExp(currency));
  }
  assert.equal(JSON.stringify(project), snapshot);
});

test("Safe Import payload follows organization currency without FX or numeric changes", async () => {
  const f = await fixture(); const conflict = await f.api("import-conflict-review.js");
  for (const currency of ["USD", "CAD", "GBP", "EUR"]) {
    f.setBase(currency);
    const payload = conflict.buildProjectImportPayload({ results: { rows: [{ rowNumber: 2, project, errors: [] }], mappingIssues: [], summary: { error: 0 } }, selectedRows: new Set([2]), fileName: "fixture.csv" });
    assert.equal(payload.currency_code, currency);
    assert.equal(payload.rows[0].project.budget_bac, 300000);
    assert.equal(payload.rows[0].project.earned_value_ev, 150000);
    assert.equal("project_id" in payload.rows[0].project, false);
  }
  assert.equal(f.requests.length, 0);
});

test("unverified or mismatched import currency blocks the check before sending RPC", async () => {
  const f = await fixture(); const service = await f.api("project-import-service.js");
  await assert.rejects(service.checkProjectImport({ currency_code: "USD" }), /verified/);
  f.setBase("USD");
  await assert.rejects(service.checkProjectImport({ currency_code: "EUR" }), /currency changed/);
  assert.equal(f.requests.length, 0);
});

test("historical import result retains CAD after organization switches to USD", async () => {
  const f = await fixture(); const { normalizeProjectImportResult } = await f.api("import-commit-state.js");
  f.setBase("USD");
  const id = "11111111-1111-4111-8111-111111111111";
  const result = { contract_version: 1, status: "committed", replayed: true, import_id: id, idempotency_key: id,
    payload_hash: "a".repeat(64), imported_by: id, committed_at: new Date().toISOString(), source_namespace: null,
    currency_code: "CAD", rows_submitted: 1, rows_imported: 1, rows_skipped: 0, rows_failed: 0,
    rows: [{ source_row: 2, source_project_id: null, project_uuid: id, project_id: "P012", project_name: "Fixture" }] };
  const before = JSON.stringify(result);
  assert.equal(normalizeProjectImportResult(result, { idempotencyKey: id }).currency_code, "CAD");
  assert.equal(JSON.stringify(result), before);
  assert.throws(() => normalizeProjectImportResult({ ...result, currency_code: "JPY" }, { idempotencyKey: id }));
});

test("migration preserves authority, history, replay and conflict locks without project updates", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261026_organization_currency.sql", import.meta.url), "utf8");
  assert.match(sql, /organization_currency text not null\s+check/);
  assert.match(sql, /values \(true, 'CAD'\)/);
  assert.doesNotMatch(sql, /organization_currency text not null default/i);
  assert.match(sql, /id boolean primary key default true check \(id = true\)/);
  assert.match(sql, /before delete[\s\S]*before truncate/);
  assert.match(sql, /current_user_has_governance_role\('governance_admin'\)/);
  assert.match(sql, /p_confirm is distinct from true/);
  assert.match(sql, /v_settings.organization_currency is distinct from p_expected_currency/);
  assert.match(sql, /if v_settings.organization_currency <> p_currency then\s+if p_confirm is distinct from true then[\s\S]*update public.organization_settings set organization_currency = p_currency/);
  assert.doesNotMatch(sql, /separately approved financial migration|errcode = '0A000'/);
  assert.match(sql, /grant select on public.organization_settings to anon, authenticated/);
  assert.doesNotMatch(sql, /grant (?:update|insert|delete|all) on public.organization_settings/i);
  assert.match(sql, /create or replace function public._prepare_project_import/);
  assert.match(sql, /create or replace function public.commit_project_import/);
  assert.match(sql, /return v_prior.result[\s\S]*where id = true for share;[\s\S]*lock table public.projects in share row exclusive mode;[\s\S]*v_analysis := public._analyze_project_import/);
  assert.match(sql, /v_prepared->>'currency_code' is distinct from v_currency/);
  assert.match(sql, /'currency_code', v_currency/);
  assert.doesNotMatch(sql, /(?:update|delete from) public\.(?:projects|project_imports|project_import_rows|change_requests)\b/i);
  assert.match(sql, /revoke all on function public._prepare_project_import\(jsonb\) from public, anon, authenticated/);
});

test("organization authority overrides deployment fallback for other businesses", async () => {
  const f = await fixture({ initialCurrency: "GBP" });
  assert.equal(f.organization.getOrganizationCurrency(), "CAD");
  await (await f.api("organization-settings-service.js")).loadOrganizationSettings();
  assert.equal(f.organization.requireOrganizationCurrency(), "GBP");
  assert.equal((await f.api("app-config.js")).APP_CONFIG.portfolio.currencyCode, "GBP");
});

test("no global currency badge or replacement currency banner is rendered", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/js/app.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/js/organization-settings-ui.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-currency-indicator|sf-currency-indicator/);
  assert.doesNotMatch(app, /renderCurrencyIndicator|Values in /);
  assert.doesNotMatch(ui, /unverified .*currency context|data-page-subtitle|sf-data-source-notice/);
  assert.match(app, /Conversion is currently unavailable\. Showing organization-currency values\./);
});
