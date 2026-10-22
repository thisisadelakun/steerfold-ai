import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { APP_CONFIG } from "../app/js/app-config.js";
import * as intelligence from "../app/js/portfolio-intelligence.js";

function project(overrides = {}) {
  return { projectId: "P001", projectName: "Healthy Project", projectManager: "Manager", projectType: "IT",
    projectStatus: "On Track", strategicPriority: "Medium", budgetBAC: 1000,
    plannedValuePV: 100, earnedValueEV: 100, actualCostAC: 100, percentComplete: 0.1,
    riskScore: 4, resourceDemand: "Medium", startDate: "1/1/2026", endDate: "12/31/2026", ...overrides };
}
const cost = project({ projectId: "P002", projectName: "Cost Project", actualCostAC: 120 });
const schedule = project({ projectId: "P003", projectName: "Schedule Project", plannedValuePV: 125 });
const risk = project({ projectId: "P004", projectName: "Risk Project", riskScore: 12 });
const critical = project({ projectId: "P005", projectName: "Critical Project", projectStatus: "Critical", riskScore: 20, strategicPriority: "High" });
const fixtures = [project(), cost, schedule, risk, critical];
const money = (value) => `CAD ${value.toFixed(0)}`;

test("health counts reuse existing status, EVM, forecast and configured risk signals", () => {
  const model = intelligence.getPortfolioIntelligence(fixtures);
  assert.deepEqual(model.counts, { totalProjects: 5, onTrack: 4, atRisk: 0, critical: 1,
    overBudget: 1, behindSchedule: 1, highRisk: 2, forecastConcern: 1 });
  assert.equal(model.strong.length, 1);
  assert.equal(model.attention.length, 4);
  assert.equal(model.strategic[0].projectId, "P005");
  assert.ok(model.forecastExposure > 0);
});

test("cost pressure and forecast exposure remain base-currency numeric calculations", () => {
  const model = intelligence.getPortfolioIntelligence([cost]);
  assert.equal(model.cost[0].evm.cv, -20);
  assert.equal(model.cost[0].evm.cpi, 100 / 120);
  assert.equal(model.overBudget[0].forecast.eac, 1200);
  assert.equal(model.forecastExposure, 200);
  assert.match(intelligence.describeAttention(model.attention[0], money), /CAD 200/);
  assert.match(model.attention[0].action, /EAC|ETC/);
});

test("schedule, risk and critical signals produce supported operational recommendations", () => {
  const scheduleRecord = intelligence.getPortfolioIntelligence([schedule]).attention[0];
  assert.equal(scheduleRecord.evm.sv, -25);
  assert.match(intelligence.describeAttention(scheduleRecord, money), /SPI 0.80/);
  assert.match(scheduleRecord.action, /critical-path/);
  const riskRecord = intelligence.getPortfolioIntelligence([risk]).attention[0];
  assert.match(intelligence.describeAttention(riskRecord, money), /12\/25/);
  assert.match(riskRecord.action, /mitigation owners/);
  const criticalRecord = intelligence.getPortfolioIntelligence([critical]).attention[0];
  assert.equal(criticalRecord.urgency, "Critical");
  assert.match(criticalRecord.action, /sponsor review/);
});

test("ranking is deterministic by existing urgency, risk, dimensions, strategic priority and name/ID", () => {
  const highStrategic = project({ ...schedule, projectId: "P006", projectName: "Z project", strategicPriority: "High" });
  const mediumStrategic = project({ ...schedule, projectId: "P007", projectName: "A project" });
  const model = intelligence.getPortfolioIntelligence([mediumStrategic, highStrategic, risk, critical]);
  assert.deepEqual(model.attention.map((record) => record.projectId), ["P005", "P004", "P006", "P007"]);
  assert.deepEqual(intelligence.getPortfolioIntelligence([critical, risk, highStrategic, mediumStrategic]).attention.map((record) => record.projectId), ["P005", "P004", "P006", "P007"]);
  const combined = project({ ...cost, projectId: "P008", plannedValuePV: 125 });
  const tiedCost = project({ ...cost, projectId: "P009" });
  const sorted = intelligence.getPortfolioIntelligence([tiedCost, combined]);
  assert.equal(sorted.attention[0].projectId, "P008");
  assert.equal(sorted.attention[0].dimensions, 2); // Cost + schedule, not CPI + EAC + schedule.
  assert.equal(sorted.attention[1].dimensions, 1);
});

test("empty and healthy portfolios do not manufacture warning projects", () => {
  const empty = intelligence.getPortfolioIntelligence([]);
  assert.equal(empty.counts.totalProjects, 0);
  assert.equal(empty.attention.length, 0);
  assert.equal(intelligence.buildExecutiveNarrative(empty, money), "No projects are available for portfolio intelligence.");
  const healthy = intelligence.getPortfolioIntelligence([project()]);
  assert.equal(healthy.attention.length, 0);
  assert.equal(healthy.strong.length, 1);
  assert.match(healthy.records[0].action, /no immediate corrective action required/);
  assert.match(intelligence.buildExecutiveNarrative(healthy, money), /No immediate corrective action/);
});

test("unavailable efficiency/forecast comparisons are disclosed, not called strong performance", () => {
  const model = intelligence.getPortfolioIntelligence([project({ plannedValuePV: 0, earnedValueEV: 0, actualCostAC: 0 })]);
  assert.equal(model.strong.length, 0);
  assert.equal(model.attention.length, 0);
  assert.equal(model.comparisonsUnavailable, 1);
  assert.match(intelligence.buildExecutiveNarrative(model, money), /comparisons are unavailable for 1 project/);
});

test("executive narrative is factual, currency-formatted and deterministic across input ordering", () => {
  const narrative = intelligence.buildExecutiveNarrative(intelligence.getPortfolioIntelligence(fixtures), money);
  assert.match(narrative, /5 projects: 4 on track, 0 at risk and 1 critical/);
  assert.match(narrative, /Cost Project.*CAD 20/);
  assert.match(narrative, /Schedule Project.*CAD 25/);
  assert.equal(narrative, intelligence.buildExecutiveNarrative(intelligence.getPortfolioIntelligence([...fixtures].reverse()), money));
  assert.ok(narrative.split(/\.\s+/).length <= 4);
});

test("filters select recorded Critical status and the current cost/schedule/risk signals", () => {
  const model = intelligence.getPortfolioIntelligence(fixtures);
  assert.deepEqual(intelligence.filterIntelligenceAttention(model, "critical").map((record) => record.projectId), ["P005"]);
  assert.deepEqual(intelligence.filterIntelligenceAttention(model, "cost").map((record) => record.projectId), ["P002"]);
  assert.deepEqual(intelligence.filterIntelligenceAttention(model, "schedule").map((record) => record.projectId), ["P003"]);
  assert.equal(intelligence.filterIntelligenceAttention(model, "risk").length, 2);
  assert.equal(intelligence.filterIntelligenceAttention(model, "unknown").length, 0);
});

test("analytics never mutate the project array or any project object", () => {
  const input = Object.freeze(fixtures.map((item) => Object.freeze({ ...item })));
  const before = JSON.stringify(input);
  const model = intelligence.getPortfolioIntelligence(input);
  intelligence.buildExecutiveNarrative(model, money);
  intelligence.filterIntelligenceAttention(model, "cost");
  assert.equal(JSON.stringify(input), before);
  model.records[0].projectName = "Output-only change";
  assert.equal(JSON.stringify(input), before);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.className = ""; this.text = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(" "); }
  get classList() { return { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(" "); } }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ""; this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
}
const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
async function viewFixture() {
  let currency = { organizationCurrency: "CAD", displayCurrency: "CAD", conversionRequired: false, fxStatus: "ready", rate: 1 };
  const context = vm.createContext({ document: { createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    createTextNode: (value) => { const node = new Element("#text"); node.textContent = value; return node; } } });
  const synthetic = (exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  const config = synthetic({ APP_CONFIG });
  const formatters = new vm.SourceTextModule(await readFile(new URL("../app/js/formatters.js", import.meta.url), "utf8"), { context });
  await formatters.link((name) => name === "./app-config.js" ? config : synthetic({ getCurrencyState: () => currency }));
  await formatters.evaluate();
  const charts = new vm.SourceTextModule(await readFile(new URL("../app/js/charts.js", import.meta.url), "utf8"), { context });
  await charts.link((name) => name === "./app-config.js" ? config : formatters);
  await charts.evaluate();
  const components = new vm.SourceTextModule(await readFile(new URL("../app/js/ui-components.js", import.meta.url), "utf8"), { context });
  await components.link(() => { throw new Error("Unexpected UI dependency"); });
  await components.evaluate();
  const view = new vm.SourceTextModule(await readFile(new URL("../app/js/portfolio-intelligence-view.js", import.meta.url), "utf8"), { context });
  await view.link((name) => ({ "./app-config.js": config, "./formatters.js": formatters,
    "./charts.js": charts, "./ui-components.js": components })[name] ?? synthetic(intelligence));
  await view.evaluate();
  const root = new Element("div");
  const opened = [];
  return { root, opened,
    render: (projects = fixtures) => view.namespace.renderPortfolioIntelligence(root, projects, { onOpenProject: (id) => opened.push(id) }),
    currency(value) { currency = value; },
  };
}

test("view uses real display-currency formatting and preserves numeric analytics and selected filter on refresh", async () => {
  const f = await viewFixture(); f.render();
  assert.match(f.root.textContent, /CAD/);
  const before = intelligence.getPortfolioIntelligence(fixtures).forecastExposure;
  const radio = descendants(f.root).find((node) => node.tag === "input" && node.value === "cost");
  radio.checked = true; radio.listeners.change();
  f.currency({ organizationCurrency: "CAD", displayCurrency: "USD", conversionRequired: true, fxStatus: "ready", rate: 0.75 });
  f.render();
  assert.match(f.root.textContent, /USD/);
  assert.match(f.root.textContent, /USD\s*150/);
  assert.equal(f.root.dataset.intelligenceFilter, "cost");
  assert.equal(intelligence.getPortfolioIntelligence(fixtures).forecastExposure, before);
  f.currency({ organizationCurrency: "CAD", displayCurrency: "USD", conversionRequired: true, fxStatus: "unavailable", rate: null });
  f.render();
  assert.match(f.root.textContent, /CAD/);
  assert.doesNotMatch(f.root.textContent, /USD/);
});

test("project links support SPA navigation exactly once and preserve normal modified-click navigation", async () => {
  const f = await viewFixture();
  const encoded = project({ projectId: "ID & 1", projectName: "<b>Literal project name</b>", projectStatus: "Critical" });
  f.render([encoded]);
  const link = descendants(f.root).find((node) => node.tag === "a");
  assert.equal(link.href, "?project=ID%20%26%201");
  assert.equal(link.textContent, "<b>Literal project name</b>");
  let prevented = 0;
  link.listeners.click({ button: 0, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(f.opened, ["ID & 1"]); assert.equal(prevented, 1);
  link.listeners.click({ button: 0, ctrlKey: true, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(f.opened, ["ID & 1"]); assert.equal(prevented, 1);
});

test("real status donut and accessible filters render; healthy/empty states remain factual", async () => {
  const f = await viewFixture(); f.render();
  const nodes = descendants(f.root);
  const svg = nodes.find((node) => node.tag === "svg");
  assert.equal(svg.attributes.role, "img");
  assert.match(svg.attributes["aria-label"], /5 total projects/);
  assert.equal(nodes.filter((node) => node.className.includes("sf-donut-slice ")).length, 3);
  assert.equal(nodes.filter((node) => node.tag === "input" && node.type === "radio").length, 5);
  assert.ok(nodes.some((node) => node.attributes.role === "status"));
  f.render([project()]);
  assert.match(f.root.textContent, /No projects currently require corrective action/);
  f.render([]);
  assert.match(f.root.textContent, /No projects are available to assess/);
  assert.equal(descendants(f.root).filter((node) => node.tag === "a").length, 0);
});

test("existing donut motion retains visible-render, reduced-motion and print protections", async () => {
  const motion = await readFile(new URL("../app/js/visualization-motion.js", import.meta.url), "utf8");
  assert.match(motion, /\.sf-donut-slice/);
  assert.match(motion, /isIntersecting/);
  assert.match(motion, /if \(reducedMotion\.matches\) continue/);
  assert.match(motion, /beforeprint/);
});

test("compact attention list can reveal every matching project without replacing Explorer", async () => {
  const f = await viewFixture();
  f.render(Array.from({ length: 8 }, (_, index) => project({ ...cost, projectId: `P${index}`, projectName: `Cost project ${index}` })));
  const list = descendants(f.root).find((node) => node.id === "sf-intelligence-attention-list");
  const expand = descendants(f.root).find((node) => node.className === "sf-intelligence-expand");
  assert.equal(list.children.length, 5);
  assert.equal(expand.attributes["aria-expanded"], "false");
  expand.listeners.click();
  assert.equal(list.children.length, 8);
  assert.equal(expand.attributes["aria-expanded"], "true");
  expand.listeners.click();
  assert.equal(list.children.length, 5);
});
