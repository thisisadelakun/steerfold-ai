// Real DOM regression checks for the offline fixture only. No real API is used.
export async function runDropdownRegressions({ ui, state, resetFixture, getActiveWorkspace }) {
  let passed = 0;
  function check(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
  }
  const panel = () => document.querySelector(".sf-auth-panel");
  const picker = () => document.getElementById("sf-workspace-select");
  const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
  async function until(predicate) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await pause();
    }
    throw new Error("Timed out waiting for dropdown/auth state");
  }
  function closeAuth() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  async function choose(value) {
    const select = picker();
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    // Exercise the trailing pointer click that selectOption() does not deliver.
    select.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await pause();
  }

  closeAuth();
  resetFixture();
  await until(() => getActiveWorkspace()?.isDemo && !picker().disabled);
  const demoId = getActiveWorkspace().id;
  const privateId = "44444444-4444-4444-8444-444444444444";
  state.rows.push({ id: privateId, organization_name: "Duro Logistic", industry: "Logistics",
    organization_currency: "USD", is_demo: false, can_write: true,
    owner: "11111111-1111-4111-8111-111111111111" });
  await ui.reload();
  check(picker() instanceof HTMLSelectElement, "Must exercise a real native select");
  check(picker().options.length === 2, "Signed-out choices must be Demo plus action only");
  check(picker().options[0].text === "Brisk & Zip", "Demo name must not be synthetic");
  check(picker().options[1].text === "+ Create Workspace", "Create must be the final option");
  await choose("__create");
  check(!panel().hidden, "Trailing click must not close authentication");
  check(localStorage.getItem("steerfold-auth-intent") === "create-workspace", "Auth intent must persist");
  check(picker().value === demoId, "Signed-out picker must restore Demo");
  closeAuth();
  ui.render("portfolio", 2);
  await choose("__create");
  check(!panel().hidden, "Action must work after closing auth and re-rendering");

  panel().querySelector('[name="email"]').value = "fixture@example.invalid";
  panel().querySelector('[name="password"]').value = "fixture-password";
  panel().querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await until(() => state.user && !document.querySelector(".sf-workspace-form").hidden && !picker().disabled);
  check(!document.querySelector(".sf-workspace-gate").hidden, "Post-auth intent must open creation");
  check(!localStorage.getItem("steerfold-auth-intent"), "Resumed intent must be consumed");
  check(state.calls.create === 0, "Authentication must never create a workspace");
  closeAuth();
  await choose(privateId);
  check(getActiveWorkspace()?.id === privateId, "Normal private workspace switching must work");
  ui.render("portfolio", 0);
  await choose("__create");
  check(!document.querySelector(".sf-workspace-gate").hidden, "Authenticated action must open creation");
  check(panel().hidden, "Authenticated action must not open auth");
  check(picker().value === privateId, "Authenticated picker must restore active workspace");
  await choose(demoId);
  await choose("__create");
  check(!document.querySelector(".sf-workspace-gate").hidden, "Creation can reopen after leaving it");
  check([...picker().options].filter((option) => option.value === demoId).length === 1, "Demo must appear once");
  check(picker().options[picker().options.length - 1].value === "__create", "Action must stay last after re-render");
  check(state.calls.create === 0 && state.calls.blocked === 0, "No creation or external fetch is allowed");
  return `${passed} real DOM checks passed`;
}
