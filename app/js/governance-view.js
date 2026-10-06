import { calculateProjectForecast } from "./portfolio-analytics.js";
import { formatCurrency } from "./formatters.js";

const EMPTY = "\u2014";
const DIMENSIONS = ["Scope", "Schedule", "Cost", "Quality", "Resources", "Risk", "Stakeholders"];
const SEVERITIES = ["None", "Low", "Medium", "High"];
const CHANGE_TYPES = ["Scope", "Schedule", "Cost", "Resource", "Risk Response", "Compliance", "Other"];
const PATH = [
  ["Change Initiation", "Document the requested change and rationale."],
  ["Initial Assessment", "Review completeness and initial feasibility."],
  ["Impact Analysis", "Assess budget, schedule, scope, risk and stakeholder effects."],
  ["Change Control Board Review", "Evaluate objectives and baseline impact."],
  ["Decision & Communication", "Record and communicate the formal decision."],
  ["Baseline Update", "Update the approved baseline only after approval."],
];
const ROLES = [
  ["Project Manager", "Prepare the budget change and coordinate assessment."],
  ["Finance", "Review financial impact and compliance."],
  ["Sponsor", "Provide budget sponsorship and approval oversight."],
  ["PMO", "Provide governance oversight."],
  ["Change Control Board / Steering Committee", "Review significant baseline changes and strategic impacts."],
];

function money(value) {
  return Number.isFinite(value) ? formatCurrency(value) : EMPTY;
}

function percent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : EMPTY;
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return EMPTY;
  if (value > 0) return `+${money(value)}`;
  if (value < 0) return `-${money(Math.abs(value))}`;
  return money(0);
}

function signedPercent(value) {
  if (!Number.isFinite(value)) return EMPTY;
  return `${value > 0 ? "+" : ""}${percent(value)}`;
}

export function calculateGovernance(project, rawChange) {
  const bac = project?.budgetBAC;
  const parsed = String(rawChange).trim() === "" ? null : Number(rawChange);
  const changeValid = Number.isFinite(parsed);
  const bacValid = Number.isFinite(bac) && bac > 0;
  const proposed = changeValid && bacValid ? bac + parsed : null;
  const valid = bacValid && changeValid && Number.isFinite(proposed) && proposed > 0;
  const forecast = project && bacValid ? calculateProjectForecast(project) : null;
  const eac = Number.isFinite(forecast?.eac) ? forecast.eac : null;
  const vac = Number.isFinite(forecast?.vac) ? forecast.vac : null;

  return {
    bac: bacValid ? bac : null,
    change: changeValid ? parsed : null,
    proposed: valid ? proposed : null,
    absolute: valid ? Math.abs(parsed) : null,
    changePercent: valid ? (parsed / bac) * 100 : null,
    eac,
    vac,
    headroom: valid && eac !== null ? proposed - eac : null,
    error: !bacValid
      ? "Approved budget is unavailable. Select a project with a positive BAC."
      : !changeValid
        ? "Enter a valid budget change amount."
        : !valid
          ? "Proposed budget must be greater than 0."
          : "",
  };
}

function setText(root, key, value) {
  root.querySelector(`[data-gov-${key}]`).textContent = value;
}

function createOptions(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function createImpactControls(root) {
  const list = root.querySelector("[data-gov-impacts]");
  DIMENSIONS.forEach((dimension) => {
    const field = document.createElement("div");
    field.className = "sf-governance-impact-field";
    const label = document.createElement("label");
    const select = document.createElement("select");
    select.className = "sf-governance-control";
    select.id = `sf-governance-impact-${dimension.toLowerCase()}`;
    select.dataset.dimension = dimension;
    label.htmlFor = select.id;
    label.textContent = dimension === "Cost" ? "Cost Impact Severity" : dimension;
    createOptions(select, SEVERITIES);
    field.append(label, select);

    if (dimension === "Cost") {
      const helper = document.createElement("small");
      const guidance = document.createElement("small");
      helper.id = "sf-governance-cost-severity-help";
      helper.className = "sf-governance-impact-help";
      helper.textContent =
        "Rate the significance of the financial impact; the budget amount is calculated separately.";
      guidance.id = "sf-governance-cost-severity-guidance";
      guidance.className = "sf-governance-impact-guidance";
      guidance.textContent =
        "A financial change is present; confirm the qualitative cost severity.";
      guidance.hidden = true;
      select.setAttribute(
        "aria-describedby",
        `${helper.id} ${guidance.id}`,
      );
      field.append(helper, guidance);
    }

    list.append(field);
  });
}

function getCalculatedCostNote(result) {
  if (result.change === 0) return "No calculated budget change.";
  if (
    !Number.isFinite(result.change) ||
    !Number.isFinite(result.changePercent)
  ) {
    return "Calculated budget impact is unavailable.";
  }

  return `Calculated budget impact: ${signedMoney(result.change)} (${signedPercent(result.changePercent)}).`;
}

function createGuidance(root) {
  for (const [title, description] of PATH) {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    const text = document.createElement("span");
    heading.textContent = title;
    text.textContent = description;
    item.append(heading, text);
    root.querySelector("[data-gov-path]").append(item);
  }
  for (const [title, description] of ROLES) {
    const item = document.createElement("div");
    const heading = document.createElement("strong");
    const text = document.createElement("span");
    heading.textContent = title;
    text.textContent = description;
    item.append(heading, text);
    root.querySelector("[data-gov-roles]").append(item);
  }
}

function forecastLanguage(headroom) {
  if (headroom === null) return "Current forecast is unavailable.";
  if (headroom < 0) return `Current forecast would remain ${money(Math.abs(headroom))} above the proposed budget.`;
  if (headroom > 0) return `Proposed budget would provide ${money(headroom)} of forecast headroom.`;
  return "Current forecast would align with the proposed budget.";
}

function getForecastImpactPresentation(result) {
  return {
    headroom: money(result.headroom),
    narrative: forecastLanguage(result.headroom),
  };
}

function renderBridge(root, result) {
  const bridge = root.querySelector("[data-gov-bridge]");
  bridge.replaceChildren();
  if (result.error) return;

  const values = [result.bac, result.proposed, result.eac].filter(Number.isFinite);
  const scale = Math.max(...values, 1);
  const steps = [
    ["Current BAC", result.bac, "current"],
    [result.change >= 0 ? "+ Budget Change" : "- Budget Change", Math.abs(result.change), result.change >= 0 ? "positive" : "negative"],
    ["Proposed BAC", result.proposed, "proposed"],
    ["Current EAC (forecast)", result.eac, "forecast"],
  ];
  for (const [label, value, kind] of steps) {
    const row = document.createElement("div");
    row.className = "sf-governance-bridge-row";
    const name = document.createElement("span");
    const track = document.createElement("div");
    const bar = document.createElement("span");
    const amount = document.createElement("strong");
    name.textContent = label;
    track.className = "sf-governance-bridge-track";
    bar.className = `sf-governance-bridge-bar sf-governance-bridge-bar--${kind}`;
    amount.textContent = money(value);
    if (Number.isFinite(value) && value > 0) {
      const start = kind === "positive" ? result.bac : kind === "negative" ? result.proposed : 0;
      bar.style.left = `${(start / scale) * 100}%`;
      bar.style.width = `${(value / scale) * 100}%`;
      track.append(bar);
    }
    row.append(name, track, amount);
    bridge.append(row);
  }
  bridge.setAttribute("aria-label",
    `Current BAC ${money(result.bac)}; budget change ${money(result.change)}; proposed BAC ${money(result.proposed)}; current EAC forecast ${money(result.eac)}.`);
}

function update(root, project) {
  const amount = root.querySelector("[data-gov-amount]");
  const result = calculateGovernance(project, amount.value);
  const error = root.querySelector("[data-gov-error]");
  error.textContent = result.error;
  error.hidden = !result.error;
  amount.setAttribute("aria-invalid", String(Boolean(result.error)));

  setText(root, "approved", money(result.bac));
  setText(root, "eac", money(result.eac));
  setText(root, "vac", money(result.vac));
  setText(root, "status", project?.projectStatus || EMPTY);
  setText(root, "risk", Number.isFinite(project?.riskScore) ? `Risk score ${project.riskScore}/25` : "Risk score unavailable");
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const high = [];
  root.querySelectorAll("[data-dimension]").forEach((select) => {
    counts[select.value] += 1;
    if (select.value === "High") high.push(select.dataset.dimension);
  });
  const costSeverity = root.querySelector('[data-dimension="Cost"]')?.value ?? "None";
  const costGuidance = root.querySelector(
    "#sf-governance-cost-severity-guidance",
  );
  setText(root, "impact-counts", `High impact: ${counts.High} · Medium impact: ${counts.Medium} · Low impact: ${counts.Low} · No impact: ${counts.None}`);
  setText(root, "cost-indicator", getCalculatedCostNote(result));
  costGuidance.hidden = !(
    Number.isFinite(result.change) &&
    result.change !== 0 &&
    costSeverity === "None"
  );
  const downstream = root.querySelector("[data-gov-downstream]");
  downstream.hidden = Boolean(result.error);
  if (result.error) return;
  const forecastImpact = getForecastImpactPresentation(result);

  setText(root, "current-bac", money(result.bac));
  setText(root, "change", money(result.change));
  setText(root, "proposed", money(result.proposed));
  setText(root, "absolute", money(result.absolute));
  setText(root, "percent", percent(result.changePercent));
  setText(root, "forecast-eac", money(result.eac));
  setText(root, "forecast-vac", money(result.vac));
  setText(root, "headroom", forecastImpact.headroom);
  setText(root, "forecast-language", forecastImpact.narrative);
  setText(root, "cost-change", money(result.change));
  setText(root, "cost-percent", percent(result.changePercent));
  setText(root, "cost-forecast", forecastImpact.headroom);
  setText(root, "requirement", result.change === 0 ? "No Baseline Change Proposed" : "Formal Change Control Required");
  renderBridge(root, result);

  const readiness = root.querySelector("[data-gov-readiness]");
  readiness.replaceChildren();
  const lines = [
    result.change === 0
      ? "No budget baseline change is proposed."
      : `Budget baseline change of ${money(Math.abs(result.change))} (${result.changePercent >= 0 ? "+" : ""}${percent(result.changePercent)}) requires formal change control.`,
    forecastImpact.narrative,
    `Change type selected: ${root.querySelector("[data-gov-type]").value}.`,
  ];
  if (high.length) lines.push(`High impacts were identified in ${high.join(", ")}.`);
  if (costSeverity !== "None") {
    lines.push(`Cost impact severity: ${costSeverity}.`);
  }
  lines.push(`Impact assessment: ${DIMENSIONS.length} of ${DIMENSIONS.length} dimensions selected.`);
  lines.forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    readiness.append(item);
  });
}

export function renderGovernanceView(container, projects) {
  if (!container) return;
  container.replaceChildren();
  if (!projects?.length) {
    const empty = document.createElement("p");
    empty.className = "sf-governance-empty";
    empty.textContent = "No project data is currently available for governance analysis.";
    const workflow = document.createElement("section");
    workflow.dataset.governanceWorkflow = "";
    container.append(empty, workflow);
    return {
      getAssessment: () => null,
      loadAssessment: () => false,
      setProjectLocked: () => {},
    };
  }

  container.innerHTML = `
    <div class="sf-governance-toolbar">
      <div class="sf-governance-field"><label for="sf-governance-project">Project</label><select id="sf-governance-project" class="sf-governance-control" data-gov-project></select></div>
    </div>
    <section aria-labelledby="sf-governance-baseline-title"><div class="sf-section-header"><div><h2 id="sf-governance-baseline-title">Baseline Snapshot</h2><p>Current approved baseline and forecast for the selected project.</p></div></div>
      <div class="sf-governance-kpis">
        <article class="sf-kpi-card"><span class="sf-kpi-label">Approved Budget (BAC)</span><strong class="sf-kpi-value" data-gov-approved></strong></article>
        <article class="sf-kpi-card"><span class="sf-kpi-label">Current Forecast (EAC)</span><strong class="sf-kpi-value" data-gov-eac></strong></article>
        <article class="sf-kpi-card"><span class="sf-kpi-label">Forecast Variance (VAC)</span><strong class="sf-kpi-value" data-gov-vac></strong></article>
        <article class="sf-kpi-card"><span class="sf-kpi-label">Project Status</span><strong class="sf-kpi-value" data-gov-status></strong><small data-gov-risk></small></article>
      </div>
    </section>
    <div class="sf-governance-top-grid">
      <section class="sf-panel" aria-labelledby="sf-governance-change-title"><div class="sf-section-header"><div><p class="sf-governance-eyebrow">Proposed Change</p><h2 id="sf-governance-change-title">Change Details</h2></div></div>
        <div class="sf-governance-form">
          <div class="sf-governance-field"><label for="sf-governance-amount">Budget Change Amount (CAD)</label><input id="sf-governance-amount" class="sf-governance-control" type="number" step="any" value="0" aria-describedby="sf-governance-error" data-gov-amount><small>Positive increases budget; negative reduces it.</small><p id="sf-governance-error" class="sf-governance-error" data-gov-error hidden></p></div>
          <div class="sf-governance-field"><label for="sf-governance-type">Change Type</label><select id="sf-governance-type" class="sf-governance-control" data-gov-type></select></div>
          <div class="sf-governance-field"><label for="sf-governance-summary">Change Summary</label><textarea id="sf-governance-summary" class="sf-governance-control" rows="3" placeholder="Briefly describe the proposed change." data-gov-summary></textarea></div>
          <button class="sf-governance-reset" type="button" data-gov-reset>Reset Assessment</button>
        </div>
      </section>
      <section class="sf-panel" aria-labelledby="sf-governance-impact-title"><div class="sf-section-header"><div><p class="sf-governance-eyebrow">Impact Assessment</p><h2 id="sf-governance-impact-title">Affected Areas</h2><p>Select the observed impact for each dimension. Financial facts are shown separately.</p></div></div><div class="sf-governance-impacts" data-gov-impacts></div><p class="sf-governance-counts" data-gov-impact-counts></p><p class="sf-governance-counts" data-gov-cost-indicator></p></section>
    </div>
    <div data-gov-downstream>
      <div class="sf-governance-financial-grid">
        <section class="sf-panel" aria-labelledby="sf-governance-proposed-title"><div class="sf-section-header"><div><h2 id="sf-governance-proposed-title">Proposed Baseline</h2><p>Illustrative only; the approved BAC is unchanged.</p></div></div><dl class="sf-governance-facts"><div><dt>Current BAC</dt><dd data-gov-current-bac></dd></div><div><dt>Budget Change</dt><dd data-gov-change></dd></div><div class="sf-governance-emphasis"><dt>Proposed BAC</dt><dd data-gov-proposed></dd></div><div><dt>Absolute Change</dt><dd data-gov-absolute></dd></div><div><dt>Percentage Change</dt><dd data-gov-percent></dd></div></dl></section>
        <section class="sf-panel" aria-labelledby="sf-governance-forecast-title"><div class="sf-section-header"><div><h2 id="sf-governance-forecast-title">Forecast Impact</h2><p>Compare the current forecast with both budgets.</p></div></div><dl class="sf-governance-facts"><div><dt>Current EAC</dt><dd data-gov-forecast-eac></dd></div><div><dt>Current VAC</dt><dd data-gov-forecast-vac></dd></div><div class="sf-governance-emphasis"><dt>Proposed Budget Headroom</dt><dd data-gov-headroom></dd></div></dl><p class="sf-governance-interpretation" data-gov-forecast-language></p></section>
      </div>
      <section class="sf-panel" aria-labelledby="sf-governance-bridge-title"><div class="sf-section-header"><div><p class="sf-governance-eyebrow">Budget Change Bridge</p><h2 id="sf-governance-bridge-title">Baseline and Forecast Comparison</h2><p>Current BAC plus the proposed change equals the proposed BAC. EAC is a forecast reference.</p></div></div><div class="sf-governance-bridge" role="img" data-gov-bridge></div></section>
      <div class="sf-governance-financial-grid">
        <section class="sf-panel" aria-labelledby="sf-governance-cost-title"><div class="sf-section-header"><div><h2 id="sf-governance-cost-title">Cost Impact</h2><p>Calculated financial facts, separate from selected impact severity.</p></div></div><dl class="sf-governance-facts"><div><dt>Budget Change Amount</dt><dd data-gov-cost-change></dd></div><div><dt>Budget Change %</dt><dd data-gov-cost-percent></dd></div><div><dt>Forecast vs Proposed Budget</dt><dd data-gov-cost-forecast></dd></div></dl></section>
        <section class="sf-panel" aria-labelledby="sf-governance-readiness-title"><div class="sf-section-header"><div><p class="sf-governance-eyebrow">Governance Readiness</p><h2 id="sf-governance-readiness-title" data-gov-requirement></h2></div></div><p class="sf-governance-interpretation">This simulation does not represent an approval or active change request.</p></section>
      </div>
      <section class="sf-panel" aria-labelledby="sf-governance-decision-title"><div class="sf-section-header"><div><p class="sf-governance-eyebrow">Decision Readiness</p><h2 id="sf-governance-decision-title">Assessment Summary</h2></div></div><ul class="sf-governance-readiness-list" data-gov-readiness></ul></section>
    </div>
    <section class="sf-panel" aria-labelledby="sf-governance-path-title"><div class="sf-section-header"><div><h2 id="sf-governance-path-title">Expected Governance Path</h2><p>Guidance for a formal request, not a live workflow status.</p></div></div><ol class="sf-governance-path" data-gov-path></ol></section>
    <section class="sf-panel" aria-labelledby="sf-governance-roles-title"><div class="sf-section-header"><div><h2 id="sf-governance-roles-title">Governance Roles</h2><p>Typical responsibilities; no approval is implied.</p></div></div><div class="sf-governance-roles" data-gov-roles></div></section>
    <section data-governance-workflow></section>`;

  const projectSelect = container.querySelector("[data-gov-project]");
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = project.projectName || project.projectId;
    projectSelect.append(option);
  });
  createOptions(container.querySelector("[data-gov-type]"), CHANGE_TYPES);
  createImpactControls(container);
  createGuidance(container);
  let selected = projects[0];
  const amount = container.querySelector("[data-gov-amount]");
  const impactControls = [...container.querySelectorAll("[data-dimension]")];

  function reset() {
    amount.value = "0";
    container.querySelector("[data-gov-type]").selectedIndex = 0;
    container.querySelector("[data-gov-summary]").value = "";
    impactControls.forEach((control) => { control.value = "None"; });
    update(container, selected);
  }
  projectSelect.addEventListener("change", () => {
    selected = projects.find((project) => project.projectId === projectSelect.value) || projects[0];
    reset();
  });
  amount.addEventListener("input", () => update(container, selected));
  container.querySelector("[data-gov-type]").addEventListener("change", () => update(container, selected));
  impactControls.forEach((control) => control.addEventListener("change", () => update(container, selected)));
  container.querySelector("[data-gov-reset]").addEventListener("click", reset);
  reset();

  return {
    getAssessment() {
      const result = calculateGovernance(selected, amount.value);
      const impacts = {};
      impactControls.forEach((control) => {
        impacts[control.dataset.dimension] = control.value;
      });

      return {
        project: selected,
        result,
        budgetChangeAmount: result.change,
        changeType: container.querySelector("[data-gov-type]").value,
        changeSummary: container.querySelector("[data-gov-summary]").value.trim(),
        impacts,
      };
    },

    loadAssessment(request) {
      const project = projects.find((item) => {
        return item.projectId === request.projectCode;
      });

      if (!project) return false;

      selected = project;
      projectSelect.value = project.projectId;
      amount.value = String(request.budgetChangeAmount);
      container.querySelector("[data-gov-type]").value = request.changeType;
      container.querySelector("[data-gov-summary]").value = request.changeSummary ?? "";

      const requestImpacts = {
        Scope: request.impactScope,
        Schedule: request.impactSchedule,
        Cost: request.impactCost,
        Quality: request.impactQuality,
        Resources: request.impactResources,
        Risk: request.impactRisk,
        Stakeholders: request.impactStakeholders,
      };
      impactControls.forEach((control) => {
        control.value = requestImpacts[control.dataset.dimension] ?? "None";
      });
      update(container, selected);
      container.scrollIntoView({ block: "start", behavior: "smooth" });
      return true;
    },

    setProjectLocked(isLocked) {
      projectSelect.disabled = isLocked;
    },
  };
}
