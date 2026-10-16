import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app/js/data-service.js", import.meta.url), "utf8");
const csv = "Project_ID,Project_Name\nCSV-ONLY,Fallback project\n";

function row(index) {
  return {
    project_id: `P${String(index + 1).padStart(6, "0")}`,
    project_name: `Project ${index + 1}`,
    project_manager: "Fixture Manager", project_type: "Fixture",
    strategic_priority: "Medium", resource_demand: "Medium", project_status: "On Track",
    budget_bac: "120000.50", planned_value_pv: "60000", earned_value_ev: "55000",
    actual_cost_ac: "65000", percent_complete: "0.5", risk_score: "12",
    start_date: "2026-01-02", end_date: "2026-12-31",
  };
}

async function fixture({ count = 10, pageResponse, csvFails = false, useSupabase = true } = {}) {
  const requests = [];
  let active = 0;
  let maximumActive = 0;
  let authCalls = 0;
  const context = vm.createContext({
    URL,
    console: { warn() {} },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "data/Steerfold_AI_Project_Data.csv") {
        return { ok: !csvFails, status: csvFails ? 500 : 200, text: async () => csv };
      }
      assert.equal(new URL(url).origin, "https://fixture.invalid");
      assert.equal(new URL(url).pathname, "/rest/v1/projects");
      assert.equal(new URL(url).searchParams.get("select"), "*");
      assert.equal(new URL(url).searchParams.get("order"), "project_id.asc");
      assert.equal(options.method ?? "GET", "GET");
      assert.equal(options.headers.apikey, "fixture-publishable-key");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Prefer, undefined);
      assert.equal(options.headers["Range-Unit"], "items");
      const [start, end] = options.headers.Range.split("-").map(Number);
      assert.equal(end - start + 1, 1000);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      try {
        if (pageResponse) {
          const response = pageResponse(start, end);
          if (response) return response;
        }
        return { ok: true, status: 200, json: async () => Array.from({ length: Math.max(0, Math.min(1000, count - start)) }, (_, index) => row(start + index)) };
      } finally {
        active -= 1;
      }
    },
  });
  const module = new vm.SourceTextModule(useSupabase ? source : source.replace("const USE_SUPABASE = true;", "const USE_SUPABASE = false;"), { context });
  await module.link((specifier) => {
    if (specifier === "./supabase-config.js") {
      return new vm.SyntheticModule(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], function () {
        this.setExport("SUPABASE_URL", "https://fixture.invalid");
        this.setExport("SUPABASE_PUBLISHABLE_KEY", "fixture-publishable-key");
      }, { context });
    }
    assert.equal(specifier, "./auth-service.js");
    return new vm.SyntheticModule(["getValidAccessToken"], function () {
      this.setExport("getValidAccessToken", async () => { authCalls += 1; throw new Error("Public reads must not request a token"); });
    }, { context });
  });
  await module.evaluate();
  return {
    api: module.namespace,
    requests,
    liveRequests: () => requests.filter((request) => request.url !== "data/Steerfold_AI_Project_Data.csv"),
    maximumActive: () => maximumActive,
    authCalls: () => authCalls,
  };
}

for (const count of [0, 10, 1000, 1001, 2500, 5000]) {
  test(`complete sequential read: ${count} projects`, async () => {
    const f = await fixture({ count });
    const projects = await f.api.loadPortfolioData({ allowCsvFallback: false });
    assert.equal(projects.length, count);
    assert.equal(f.liveRequests().length, Math.floor(count / 1000) + 1);
    assert.deepEqual(f.liveRequests().map((request) => request.options.headers.Range),
      Array.from({ length: Math.floor(count / 1000) + 1 }, (_, index) => `${index * 1000}-${index * 1000 + 999}`));
    assert.equal(new Set(projects.map((project) => project.projectId)).size, count);
    assert.deepEqual(Array.from(projects, (project) => project.projectId), Array.from({ length: count }, (_, index) => row(index).project_id));
    assert.equal(f.maximumActive(), 1);
    assert.equal(f.authCalls(), 0);
    assert.equal(f.api.getLastPortfolioDataSource(), "supabase");
    if (count) {
      assert.equal(projects[0].budgetBAC, 120000.5);
      assert.equal(projects[0].percentComplete, 0.5);
      assert.equal(projects[0].startDate, "1/2/2026");
    }
  });
}

for (const failureStart of [0, 1000]) {
  for (const allowCsvFallback of [true, false]) {
    test(`HTTP failure at ${failureStart}, CSV fallback ${allowCsvFallback}`, async () => {
      const f = await fixture({ count: 2500, pageResponse: (start) => start === failureStart ? { ok: false, status: 503 } : null });
      if (allowCsvFallback) {
        const projects = await f.api.loadPortfolioData();
        assert.deepEqual(Array.from(projects, (project) => project.projectId), ["CSV-ONLY"]);
        assert.equal(f.api.getLastPortfolioDataSource(), "csv-fallback");
      } else {
        await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback }), /status 503/);
        assert.equal(f.requests.length, failureStart / 1000 + 1);
        assert.equal(f.api.getLastPortfolioDataSource(), null);
      }
    });
  }
}

test("non-array pages reject the complete read", async () => {
  for (const malformed of [null, {}, "invalid"]) {
    for (const startAt of [0, 1000]) {
      const f = await fixture({ count: 2500, pageResponse: (start) => start === startAt ? { ok: true, json: async () => malformed } : null });
      await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback: false }), /invalid project page/);
    }
  }
});

test("malformed later page falls back to CSV only, never mixed data", async () => {
  const f = await fixture({ count: 2500, pageResponse: (start) => start === 1000 ? { ok: true, json: async () => ({ error: "bad page" }) } : null });
  const projects = await f.api.loadPortfolioData();
  assert.deepEqual(Array.from(projects, (project) => project.projectId), ["CSV-ONLY"]);
});

test("failed CSV fallback cannot expose partial live rows", async () => {
  const f = await fixture({ count: 2500, csvFails: true, pageResponse: (start) => start === 1000 ? { ok: false, status: 503 } : null });
  await assert.rejects(f.api.loadPortfolioData(), /CSV request failed with status 500/);
  assert.equal(f.api.getLastPortfolioDataSource(), null);
});

test("successful 206 range responses are accepted without exact counts", async () => {
  const f = await fixture({ pageResponse: () => ({ ok: true, status: 206, json: async () => [row(0)] }) });
  const projects = await f.api.loadPortfolioData({ allowCsvFallback: false });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectId, row(0).project_id);
});

test("network and JSON failures propagate the original error in strict mode", async () => {
  for (const network of [true, false]) {
    const failure = new Error(network ? "network failure" : "invalid JSON");
    const f = await fixture({ count: 2500, pageResponse: (start) => {
      if (start !== 1000) return null;
      if (network) throw failure;
      return { ok: true, json: async () => { throw failure; } };
    } });
    await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback: false }), (error) => error === failure);
    assert.equal(f.requests.length, 2);
  }
});

test("overlapping or ignored ranges fail instead of returning duplicates", async () => {
  const f = await fixture({ count: 2500, pageResponse: (start) => start === 1000 ? { ok: true, json: async () => [row(999)] } : null });
  await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback: false }), /duplicate project identifiers/);
  assert.equal(f.requests.length, 2);
});

test("oversized pages are rejected", async () => {
  const f = await fixture({ pageResponse: () => ({ ok: true, json: async () => Array.from({ length: 1001 }, (_, index) => row(index)) }) });
  await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback: false }), /invalid project page/);
});

test("page guard throws, never returns a truncated portfolio", async () => {
  const f = await fixture({ count: 100000 });
  await assert.rejects(f.api.loadPortfolioData({ allowCsvFallback: false }), /safe pagination limit/);
  assert.equal(f.requests.length, 100);
});

test("CSV-only provider behavior is preserved", async () => {
  const f = await fixture({ useSupabase: false });
  const projects = await f.api.loadPortfolioData({ allowCsvFallback: false });
  assert.deepEqual(Array.from(projects, (project) => project.projectId), ["CSV-ONLY"]);
  assert.equal(f.liveRequests().length, 0);
  assert.equal(f.api.getLastPortfolioDataSource(), "csv");
});
