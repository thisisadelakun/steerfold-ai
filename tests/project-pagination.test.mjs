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

async function fixture({ count = 10, pageResponse, csvFails = false, useSupabase = true,
  workspace = { id: "demo-id", isDemo: true, canWrite: false }, token = null, onToken, onFetch, transport } = {}) {
  let currentWorkspace = workspace;
  const workspaceContext = {
    getActiveWorkspace: () => currentWorkspace,
    workspaceHeaders: () => {
      if (!currentWorkspace) throw new Error("Select an active workspace first.");
      return { "x-steerfold-organization-id": currentWorkspace.id };
    },
    requireWritableWorkspace: () => {
      if (!currentWorkspace || currentWorkspace.isDemo || !currentWorkspace.canWrite) throw new Error("Workspace is not writable.");
      return currentWorkspace;
    },
    assertWorkspaceCurrent: (captured) => {
      if (!captured || captured !== currentWorkspace) throw new Error("Active workspace changed.");
    },
  };
  const requests = [];
  let active = 0;
  let maximumActive = 0;
  let authCalls = 0;
  const context = vm.createContext({
    URL,
    console: { warn() {} },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      onFetch?.(() => { currentWorkspace = { id: "other-id", canWrite: true, isDemo: false }; });
      if (url === "data/Steerfold_AI_Project_Data.csv") {
        return { ok: !csvFails, status: csvFails ? 500 : 200, text: async () => csv };
      }
      assert.equal(new URL(url).origin, "https://fixture.invalid");
      assert.equal(new URL(url).pathname, "/rest/v1/projects");
      assert.equal(new URL(url).searchParams.get("organization_id"), `eq.${workspace.id}`);
      assert.equal(options.headers["x-steerfold-organization-id"], workspace.id);
      assert.equal(options.headers.Authorization, token ? `Bearer ${token}` : undefined);
      if (transport) return transport(url, options);
      assert.equal(new URL(url).searchParams.get("select"), "*");
      assert.equal(new URL(url).searchParams.get("order"), "project_id.asc");
      assert.equal(options.method ?? "GET", "GET");
      assert.equal(options.headers.apikey, "fixture-publishable-key");
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
    if (specifier === "./workspace-context.js") {
      return new vm.SyntheticModule(Object.keys(workspaceContext), function () {
        for (const [key, value] of Object.entries(workspaceContext)) this.setExport(key, value);
      }, { context });
    }
    assert.equal(specifier, "./auth-service.js");
    return new vm.SyntheticModule(["getValidAccessToken"], function () {
      this.setExport("getValidAccessToken", async () => {
        authCalls += 1;
        onToken?.(() => { currentWorkspace = { id: "other-id", canWrite: true, isDemo: false }; });
        return token;
      });
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
    assert.equal(f.authCalls(), 1);
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

test("signed-in reads use the bearer token and new workspaces stay empty", async () => {
  const f = await fixture({ count: 0, workspace: { id: "new-id", canWrite: true, isDemo: false }, token: "signed-in" });
  assert.equal((await f.api.loadPortfolioData()).length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.api.getLastPortfolioDataSource(), "supabase");
});

test("non-demo and unresolved workspaces never load CSV, including CSV-only mode", async () => {
  for (const workspace of [null, { id: "new-id", canWrite: true, isDemo: false }]) {
    for (const useSupabase of [true, false]) {
      const f = await fixture({ workspace, useSupabase, pageResponse: () => ({ ok: false, status: 503 }) });
      await assert.rejects(f.api.loadPortfolioData());
      await assert.rejects(f.api.getProject("P000001"));
      assert.ok(f.requests.every(({ url }) => url !== "data/Steerfold_AI_Project_Data.csv"));
    }
  }
});

test("project reads reject workspace changes during token and fetch awaits without CSV fallback", async () => {
  for (const hook of ["onToken", "onFetch"]) {
    for (const method of ["loadPortfolioData", "getProject"]) {
      const f = await fixture({ [hook]: (switchWorkspace) => switchWorkspace(),
        transport: () => ({ ok: true, json: async () => [row(0)] }) });
      await assert.rejects(f.api[method]("P000001"), /workspace changed/);
      assert.equal(f.requests.length, hook === "onToken" ? 0 : 1);
    }
  }
});

test("project detail and writes scope URLs; only create includes organization in its body", async () => {
  const f = await fixture({ workspace: { id: "write-id", canWrite: true, isDemo: false }, token: "signed-in",
    transport: () => ({ ok: true, json: async () => [row(0)] }) });
  await f.api.getProject("P000001");
  await f.api.createProject({ projectName: "Created", organization_id: "untrusted" });
  await f.api.updateProject("P000001", { projectName: "Updated", organization_id: "untrusted" });
  await f.api.deleteProject("P000001");
  assert.deepEqual(f.requests.map(({ options }) => options.method ?? "GET"), ["GET", "POST", "PATCH", "DELETE"]);
  assert.equal(JSON.parse(f.requests[1].options.body).organization_id, "write-id");
  assert.equal("organization_id" in JSON.parse(f.requests[2].options.body), false);
  for (const { url } of [f.requests[0], f.requests[2], f.requests[3]]) {
    assert.equal(new URL(url).searchParams.get("project_id"), "eq.P000001");
  }
});

test("project writes block demo, read-only, unresolved and switched workspaces", async () => {
  for (const method of ["createProject", "updateProject", "deleteProject"]) {
    for (const workspace of [null, { id: "demo", isDemo: true, canWrite: false }, { id: "read", isDemo: false, canWrite: false }]) {
      const f = await fixture({ workspace });
      await assert.rejects(f.api[method]("P000001", {}), /not writable/);
      assert.equal(f.requests.length, 0);
      assert.equal(f.authCalls(), 0);
    }
    for (const hook of ["onToken", "onFetch"]) {
      const f = await fixture({ workspace: { id: "write-id", isDemo: false, canWrite: true }, token: "signed-in",
        [hook]: (switchWorkspace) => switchWorkspace(), transport: () => ({ ok: true, json: async () => [row(0)] }) });
      await assert.rejects(f.api[method]("P000001", {}), /workspace changed/);
      assert.equal(f.requests.length, hook === "onToken" ? 0 : 1);
    }
  }
});

const governanceUser = "11111111-1111-4111-8111-111111111111";
const scopedServices = [
  { file: "change-request-service.js", reads: [["listChangeRequests"], ["getChangeRequest", "cr-id"], ["listChangeRequestEvents", "cr-id"]],
    writes: [["createChangeRequest", { projectCode: "P001" }], ["updateDraftChangeRequest", "cr-id", {}],
      ["transitionChangeRequestStatus", "cr-id", "Submitted"], ["applyApprovedChangeRequest", "cr-id"], ["deleteDraftChangeRequest", "cr-id"]] },
  { file: "governance-role-service.js", reads: [["getMyGovernanceRoles"], ["listGovernanceRoleAssignments"], ["listGovernanceUsers"]],
    writes: [["assignGovernanceRole", governanceUser, "requester"], ["revokeGovernanceRole", governanceUser, "requester"]] },
];

async function scopedServiceFixture(file, { workspace = { id: "scope-id", canWrite: true, isDemo: false }, hook } = {}) {
  let currentWorkspace = workspace;
  const requests = [];
  const switchWorkspace = () => { currentWorkspace = { id: "other-id", canWrite: true, isDemo: false }; };
  const context = vm.createContext({ URL, fetch: async (url, options) => {
    requests.push({ url, options });
    if (hook === "fetch") switchWorkspace();
    return { ok: true, status: 200, json: async () => {
      if (hook === "json") switchWorkspace();
      if (/delete_draft|revoke_governance/.test(url)) return true;
      if (/assign_governance_role$/.test(url)) return { user_id: governanceUser, role: "requester" };
      return [];
    } };
  } });
  const module = new vm.SourceTextModule(await readFile(new URL(`../app/js/${file}`, import.meta.url), "utf8"), { context });
  await module.link((name) => {
    const dependency = name === "./supabase-config.js"
      ? { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-key" }
      : name === "./auth-service.js" ? { getValidAccessToken: async () => {
        if (hook === "token") switchWorkspace();
        return "signed-in";
      } } : {
        getActiveWorkspace: () => currentWorkspace,
        workspaceHeaders: () => {
          if (!currentWorkspace) throw new Error("Select an active workspace first.");
          return { "x-steerfold-organization-id": currentWorkspace.id };
        },
        requireWritableWorkspace: () => {
          if (!currentWorkspace || currentWorkspace.isDemo || !currentWorkspace.canWrite) throw new Error("Workspace is not writable.");
          return currentWorkspace;
        },
        assertWorkspaceCurrent: (captured) => {
          if (!captured || captured !== currentWorkspace) throw new Error("Active workspace changed.");
        },
      };
    return new vm.SyntheticModule(Object.keys(dependency), function () {
      for (const [key, value] of Object.entries(dependency)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, requests };
}

for (const { file, reads, writes } of scopedServices) {
  test(`${file}: every read and mutation sends workspace and authentication headers`, async () => {
    const f = await scopedServiceFixture(file);
    for (const [method, ...args] of [...reads, ...writes]) await f.api[method](...args);
    assert.equal(f.requests.length, reads.length + writes.length);
    for (const { options } of f.requests) {
      assert.equal(options.headers["x-steerfold-organization-id"], "scope-id");
      assert.equal(options.headers.Authorization, "Bearer signed-in");
    }
  });

  test(`${file}: mutations are blocked in demo/read-only/unresolved workspaces; reads remain allowed`, async () => {
    for (const workspace of [null, { id: "demo", isDemo: true, canWrite: false }, { id: "read", isDemo: false, canWrite: false }]) {
      const f = await scopedServiceFixture(file, { workspace });
      for (const [method, ...args] of writes) await assert.rejects(f.api[method](...args), /not writable/);
      assert.equal(f.requests.length, 0);
      for (const [method, ...args] of reads) {
        if (workspace) await f.api[method](...args);
        else await assert.rejects(f.api[method](...args), /active workspace/);
      }
    }
  });

  test(`${file}: reads and writes reject workspace switches across each await`, async () => {
    for (const hook of ["token", "fetch", "json"]) {
      for (const [method, ...args] of [...reads, ...writes]) {
        const f = await scopedServiceFixture(file, { hook });
        await assert.rejects(f.api[method](...args), /workspace changed/);
        assert.equal(f.requests.length, hook === "token" ? 0 : 1);
      }
    }
  });
}
