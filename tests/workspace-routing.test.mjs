import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function fixture(path) {
  const window = { location: { href: `https://fixture.invalid/app/${path}` } };
  const history = { state: null, replacements: 0,
    replaceState(state, _title, destination) {
      this.state = state; this.replacements++;
      window.location.href = new URL(destination, window.location.href).href;
    },
    pushState(state, title, destination) { this.replaceState(state, title, destination); },
  };
  const context = vm.createContext({ window, history, URL });
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/router.js", import.meta.url), "utf8"), { context });
  await module.link(() => { throw new Error("Router must not request services"); }); await module.evaluate();
  return { router: module.namespace, history, window };
}

for (const path of ["#projects", "#forecasting", "#settings", "?project=P001", ""]) {
  test(`workspace gate intentionally replaces and restores requested route ${path || "Portfolio"}`, async () => {
    const f = await fixture(path);
    const requested = f.window.location.href;
    f.router.suspendWorkspaceRoute();
    assert.equal(f.router.getCurrentRoute().view, "workspace");
    assert.equal(new URL(f.window.location.href).searchParams.has("project"), false);
    const state = f.history.state;
    f.router.suspendWorkspaceRoute();
    assert.equal(f.history.state, state, "repeated render must not overwrite destination");
    assert.equal(f.history.replacements, 1);
    assert.equal(f.router.restoreWorkspaceRoute(), true);
    assert.equal(f.window.location.href, requested);
    assert.equal(f.history.replacements, 2, "no extra history entry for temporary availability gate");
  });
}

test("Account remains accessible and successful workspace recovery does not force navigation away", async () => {
  const f = await fixture("#account");
  f.router.suspendWorkspaceRoute();
  assert.equal(f.router.getCurrentRoute().view, "account");
  assert.equal(f.router.restoreWorkspaceRoute(), false);
  assert.equal(f.history.replacements, 0);
});

test("direct availability URL recovers to Portfolio, while an external return URL is rejected", async () => {
  const f = await fixture("#workspace");
  assert.equal(f.router.restoreWorkspaceRoute(), true);
  assert.equal(f.router.getCurrentRoute().view, "portfolio");
  f.window.location.href += "#workspace";
  f.history.state = { workspaceReturnUrl: "https://untrusted.invalid/" };
  assert.equal(f.router.restoreWorkspaceRoute(), false);
  assert.equal(f.router.getCurrentRoute().view, "workspace");
});
