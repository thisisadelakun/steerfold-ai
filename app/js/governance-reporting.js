import { formatCurrency } from "./formatters.js";
import { APP_CONFIG } from "./app-config.js";

const EMPTY = "\u2014";
const STATUSES = ["Draft", "Submitted", "Under Review", "Approved", "Rejected", "Deferred", "Withdrawn"];
const PENDING = new Set(["Submitted", "Under Review", "Deferred"]);
const OPEN = new Set(["Draft", ...PENDING]);
const isApplied = (request) => request.appliedAt != null;
const isApproved = (request) => request.status === "Approved";
const amount = (request) => Number.isFinite(request.budgetChangeAmount) ? request.budgetChangeAmount : 0;
const sum = (requests) => requests.reduce((total, request) => total + amount(request), 0);

function applicationState(request) {
  if (!isApproved(request)) return "Not Applicable";
  return isApplied(request) ? "Applied" : "Not Applied";
}

function projectLabel(request, projectNames) {
  const name = projectNames.get(request.projectCode);
  return name ? `${request.projectCode} ${EMPTY} ${name}` : request.projectCode || EMPTY;
}

function money(value, signed = false) {
  if (!Number.isFinite(value)) return EMPTY;
  return `${signed && value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function date(value) {
  if (!value) return EMPTY;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? EMPTY : new Intl.DateTimeFormat(
    APP_CONFIG.portfolio.locale,
    { dateStyle: "medium" },
  ).format(parsed);
}

function summary(requests) {
  const approved = requests.filter(isApproved);
  const applied = requests.filter(isApplied);
  const unapplied = approved.filter((request) => !isApplied(request));
  const pending = requests.filter((request) => PENDING.has(request.status));
  return {
    counts: [["Total Requests", requests.length], ["Pending Decision", pending.length],
      ["Approved Not Applied", unapplied.length], ["Applied", applied.length]],
    financial: [["Approved Change Value", sum(approved)], ["Applied Baseline Impact", sum(applied)],
      ["Approved Not Applied Value", sum(unapplied)], ["Pending Proposed Change", sum(pending)]],
    open: requests.filter((request) => OPEN.has(request.status)).length,
    closed: requests.filter((request) => ["Approved", "Rejected", "Withdrawn"].includes(request.status)).length,
  };
}

function groupRequests(requests, key) {
  const groups = new Map();
  requests.forEach((request) => {
    const value = request[key] || EMPTY;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(request);
  });
  return [...groups].sort(([left], [right]) => left.localeCompare(right, APP_CONFIG.portfolio.locale));
}

function filterRequests(requests, filters, projectNames) {
  const query = filters.search.trim().toLocaleLowerCase(APP_CONFIG.portfolio.locale);
  return requests.filter((request) => {
    const application = applicationState(request);
    const matchesApplication = filters.application === "All" ||
      (filters.application === "Approved Not Applied" && application === "Not Applied") ||
      filters.application === application;
    const searchable = `${request.requestId || ""} ${projectLabel(request, projectNames)} ${request.changeSummary || ""}`;
    return (filters.status === "All" || request.status === filters.status) &&
      matchesApplication &&
      (filters.type === "All" || request.changeType === filters.type) &&
      (filters.project === "All" || request.projectCode === filters.project) &&
      (!query || searchable.toLocaleLowerCase(APP_CONFIG.portfolio.locale).includes(query));
  });
}

function sortRequests(requests, sort, projectNames) {
  const collator = new Intl.Collator(APP_CONFIG.portfolio.locale, { sensitivity: "base", numeric: true });
  const value = (request) => {
    if (sort.key === "budgetChangeAmount") return amount(request);
    if (sort.key === "createdAt") return Date.parse(request.createdAt) || 0;
    if (sort.key === "project") return projectLabel(request, projectNames);
    return request[sort.key] || "";
  };
  return [...requests].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    const comparison = typeof a === "number" ? a - b : collator.compare(a, b);
    return comparison * (sort.direction === "asc" ? 1 : -1) || collator.compare(left.requestId || "", right.requestId || "");
  });
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function table(headers, rows, className = "") {
  const node = element("table", null, `sf-governance-report-table ${className}`);
  const head = element("thead");
  const heading = element("tr");
  headers.forEach((label) => {
    const cell = element("th", label);
    cell.scope = "col";
    heading.append(cell);
  });
  head.append(heading);
  const body = element("tbody");
  rows.forEach((values) => {
    const row = element("tr");
    values.forEach((value, index) => {
      const cell = element("td", value);
      cell.dataset.label = headers[index];
      row.append(cell);
    });
    body.append(row);
  });
  node.append(head, body);
  return node;
}

export function initGovernanceReporting({ projects, onSelectRequest }) {
  const root = element("section", null, "sf-governance-reporting");
  root.setAttribute("aria-labelledby", "sf-governance-report-title");
  const projectNames = new Map(projects.map((project) => [project.projectId, project.projectName]));
  const filters = { search: "", status: "All", application: "All", type: "All", project: "All" };
  const sort = { key: "createdAt", direction: "desc" };
  let requests = [];
  let selectedId = null;
  let disabled = false;

  function render() {
    root.replaceChildren();
    const heading = element("h2", "Governance Summary");
    heading.id = "sf-governance-report-title";
    root.append(heading);
    const metrics = summary(requests);
    const counts = element("dl", null, "sf-governance-report-kpis");
    metrics.counts.forEach(([label, value]) => {
      const item = element("div");
      item.append(element("dt", label), element("dd", String(value)));
      counts.append(item);
    });
    const financial = element("dl", null, "sf-governance-report-financial");
    metrics.financial.forEach(([label, value]) => {
      const item = element("div");
      item.append(element("dt", label), element("dd", money(value, true)));
      financial.append(item);
    });
    root.append(counts, financial, element("p",
      `Open: ${metrics.open} (Draft, Submitted, Under Review, Deferred). Closed Governance Decision: ${metrics.closed} (Approved, Rejected, Withdrawn).`,
      "sf-governance-report-note"));
    root.append(element("p", "Governance status records the decision on a Change Request. Baseline application records whether an approved budget change has been applied to the active project budget baseline.", "sf-governance-report-note"));

    root.append(element("h3", "Change Control Register"));
    const controls = element("div", null, "sf-governance-register-controls sf-governance-print-hide");
    function control(key, label, options = null) {
      const field = element("div");
      const caption = element("label", label);
      const input = element(options ? "select" : "input");
      input.id = `sf-register-${key}`;
      caption.htmlFor = input.id;
      input.disabled = disabled;
      if (options) {
        options.forEach(([value, text]) => {
          const option = element("option", text);
          option.value = value;
          input.append(option);
        });
      } else {
        input.type = "search";
        input.placeholder = "Request, project or summary";
      }
      input.value = filters[key];
      input.addEventListener(options ? "change" : "input", () => {
        const cursor = input.selectionStart;
        filters[key] = input.value;
        render();
        const replacement = root.querySelector(`#sf-register-${key}`);
        replacement.focus();
        if (!options && cursor != null) replacement.setSelectionRange(cursor, cursor);
      });
      field.append(caption, input);
      controls.append(field);
    }
    control("search", "Search register");
    control("status", "Governance Status", ["All", ...STATUSES].map((value) => [value, value]));
    control("application", "Application State", ["All", "Applied", "Approved Not Applied", "Not Applicable"].map((value) => [value, value]));
    control("type", "Change Type", [["All", "All"], ...groupRequests(requests, "changeType").filter(([key]) => key !== EMPTY).map(([key]) => [key, key])]);
    control("project", "Project", [["All", "All Projects"], ...groupRequests(requests, "projectCode").filter(([key]) => key !== EMPTY).map(([key, group]) => [key, projectLabel(group[0], projectNames)])]);
    root.append(controls);

    const filtered = sortRequests(filterRequests(requests, filters, projectNames), sort, projectNames);
    const count = element("p", `${filtered.length} ${filtered.length === 1 ? "request" : "requests"}`, "sf-governance-report-note");
    count.setAttribute("role", "status");
    root.append(count);
    const columns = [
      ["Request ID", "requestId"], ["Project", "project"], ["Change Type", null],
      ["Budget Change", "budgetChangeAmount"], ["Proposed BAC", null],
      ["Governance Status", "status"], ["Baseline Application", null], ["Created Date", "createdAt"],
    ];
    const register = table(columns.map(([label]) => label), filtered.map((request) => [
      request.requestId || EMPTY, projectLabel(request, projectNames), request.changeType || EMPTY,
      money(request.budgetChangeAmount, true), money(request.proposedBac), request.status || EMPTY,
      applicationState(request), date(request.createdAt),
    ]), "sf-governance-register");
    register.setAttribute("aria-label", "Change Control Register");
    [...register.querySelectorAll("th")].forEach((cell, index) => {
      const [label, key] = columns[index];
      if (!key) return;
      const button = element("button", label, "sf-governance-register-sort sf-governance-print-hide");
      button.type = "button";
      button.disabled = disabled;
      button.setAttribute("aria-label", `Sort by ${label}`);
      const active = sort.key === key;
      if (active) {
        cell.setAttribute("aria-sort", sort.direction === "asc" ? "ascending" : "descending");
        const arrow = element("span", sort.direction === "asc" ? " \u2191" : " \u2193");
        arrow.setAttribute("aria-hidden", "true");
        button.append(arrow);
      }
      const printLabel = element("span", label, "sf-governance-register-print-label");
      cell.replaceChildren(button, printLabel);
      button.addEventListener("click", () => {
        sort.direction = active ? (sort.direction === "asc" ? "desc" : "asc") : (key === "createdAt" || key === "budgetChangeAmount" ? "desc" : "asc");
        sort.key = key;
        render();
        root.querySelectorAll(".sf-governance-register-sort")[columns.slice(0, index).filter(([, sortable]) => sortable).length]?.focus();
      });
    });
    [...register.querySelectorAll("tbody tr")].forEach((row, index) => {
      const request = filtered[index];
      const button = element("button", request.requestId || EMPTY, "sf-governance-register-select sf-governance-print-hide");
      button.type = "button";
      button.disabled = disabled;
      button.setAttribute("aria-label", `Select ${request.requestId}, ${projectLabel(request, projectNames)}`);
      button.setAttribute("aria-pressed", String(selectedId === request.id));
      row.classList.toggle("sf-governance-register-selected", selectedId === request.id);
      const printLabel = element("strong", request.requestId || EMPTY, "sf-governance-register-print-label");
      row.firstElementChild.replaceChildren(button, printLabel);
      button.addEventListener("click", () => onSelectRequest(request.id));
      row.addEventListener("click", (event) => {
        if (!disabled && !event.target.closest("button")) onSelectRequest(request.id);
      });
    });
    if (filtered.length) root.append(register);
    else {
      const empty = element("p", requests.length ? "No change requests match the current filters." : "No change requests have been created yet.", "sf-governance-register-empty");
      empty.setAttribute("role", "status");
      root.append(empty);
    }

    const summaries = element("div", null, "sf-governance-report-summaries");
    const types = element("section");
    types.append(element("h3", "Change Type Summary"));
    const typeRows = groupRequests(requests, "changeType").map(([key, group]) => [key, String(group.length), money(sum(group), true)]);
    types.append(typeRows.length ? table(["Change Type", "Requests", "Requested Change"], typeRows) : element("p", "No change types to report.", "sf-governance-report-note"));
    const impacts = element("section");
    impacts.append(element("h3", "Project Impact Summary"));
    const projectRows = groupRequests(requests, "projectCode").map(([, group]) => {
      const approved = group.filter(isApproved);
      const applied = group.filter(isApplied);
      return [projectLabel(group[0], projectNames), String(group.length), String(approved.length), String(applied.length), money(sum(approved), true), money(sum(applied), true)];
    });
    impacts.append(projectRows.length ? table(["Project", "Requests", "Approved", "Applied", "Approved Change", "Applied Baseline Impact"], projectRows) : element("p", "No projects to report.", "sf-governance-report-note"));
    summaries.append(types, impacts);
    root.append(summaries);
  }

  return {
    element: root,
    update(nextRequests, nextSelectedId, pending) {
      requests = nextRequests;
      selectedId = nextSelectedId;
      disabled = pending;
      if (filters.type !== "All" && !requests.some((request) => request.changeType === filters.type)) filters.type = "All";
      if (filters.project !== "All" && !requests.some((request) => request.projectCode === filters.project)) filters.project = "All";
      render();
    },
    clear() {
      requests = [];
      selectedId = null;
      Object.assign(filters, { search: "", status: "All", application: "All", type: "All", project: "All" });
      Object.assign(sort, { key: "createdAt", direction: "desc" });
      root.replaceChildren();
      root.remove();
    },
  };
}
