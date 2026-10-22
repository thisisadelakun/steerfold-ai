import { APP_CONFIG } from "./app-config.js";
import { parseImportFile } from "./import-parser.js";
import { IMPORT_FIELDS, suggestImportMappings, validateImportRows } from "./import-validation.js";
import { getCurrentUser, isAuthenticated } from "./auth-service.js";
import { checkProjectImport, commitProjectImport, getProjectImportResult } from "./project-import-service.js";
import { buildProjectImportPayload, CONFLICT_MESSAGES, createConflictReview } from "./import-conflict-review.js";
import { createImportAttempt, normalizeProjectImportResult } from "./import-commit-state.js";

const STEPS = ["Upload", "Map Columns", "Validate", "Preview", "Conflict Review"];
const PAGE_SIZE = 25;

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function button(text, handler, className = "") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

export function openProjectImport({ onImported, onViewProjects } = {}) {
  const existing = document.getElementById("sf-project-import");
  if (existing) {
    if (!existing.open) { existing.showModal(); existing.querySelector("button:not([disabled])")?.focus(); }
    return;
  }
  const opener = document.activeElement;
  const dialog = element("dialog", "", "sf-import-dialog");
  dialog.id = "sf-project-import";
  dialog.setAttribute("aria-labelledby", "sf-import-title");
  dialog.setAttribute("aria-modal", "true");
  const state = {
    step: 0, reached: 0, parsed: null, source: null, sheet: "", mappings: [],
    suggestions: [], results: null, percentMode: "percent", filter: "all", page: 1,
    busy: false, error: "", discard: null,
    selectedRows: new Set(), namespace: "", checking: false, payload: null,
    blockingPage: 1, warningPage: 1,
    committing: false, recovering: false, resultPage: 1, refreshError: "",
  };
  const review = createConflictReview();
  const attempt = createImportAttempt();
  const reviewContent = element("section", "", "sf-import-conflict-review");
  reviewContent.setAttribute("aria-label", "Server conflict review");
  const content = element("div", "", "sf-import-content");
  const footer = element("div", "", "sf-import-actions");
  const steps = element("ol", "", "sf-import-steps");
  const status = element("p", "", "sf-import-status");
  status.setAttribute("role", "status");
  const error = element("p", "", "sf-import-error");
  error.setAttribute("role", "alert");
  const heading = element("h2", "Import Projects");
  heading.id = "sf-import-title";
  const context = element("p", `Financial inputs use ${APP_CONFIG.portfolio.currencyCode}. Projects are created only after server conflict review and your explicit final confirmation.`, "sf-import-context");
  dialog.append(heading, context, steps, status, error, content, footer);

  function close() {
    if (state.busy) return;
    // Keep the same in-memory attempt available while the user signs in again.
    if (attempt.uncertain) {
      dialog.close();
      if (opener?.isConnected) opener.focus();
      return;
    }
    window.removeEventListener("auth:changed", onAuthChanged);
    window.removeEventListener("beforeunload", onBeforeUnload);
    invalidateReview();
    dialog.close();
    dialog.remove();
    state.parsed = null;
    state.source = null;
    state.results = null;
    if (opener?.isConnected) opener.focus();
  }

  function confirmDiscard(action) {
    if (state.busy) return;
    if (!state.source) { action(); return; }
    state.discard = action;
    render();
    footer.querySelector("button")?.focus();
  }

  function revalidate() {
    invalidateReview();
    state.results = state.source ? validateImportRows(state.source, state.mappings, state.percentMode) : null;
    state.selectedRows = new Set(state.results?.rows.filter((row) => row.status !== "error").map((row) => row.rowNumber));
    state.page = 1;
  }

  function invalidateReview({ material = true } = {}) {
    if (material) attempt.invalidate();
    else attempt.confirm(false);
    review.invalidate();
    state.payload = null;
    state.blockingPage = 1;
    state.warningPage = 1;
  }

  function onAuthChanged() {
    if (attempt.snapshot && (attempt.busy || attempt.uncertain || attempt.result)) {
      state.error = sameActor() ? "Account restored. Recover the existing import result before starting another import."
        : "Sign in with the account that started this import. Its key and recovery state have been preserved in this tab.";
      render();
      return;
    }
    invalidateReview();
    state.error = isAuthenticated() ? "Sign-in changed. Run Review Conflicts again." : "Sign in again to review conflicts. Your local staging is preserved.";
    render();
  }

  function canReview() {
    return !state.busy && !attempt.uncertain && !attempt.result && isAuthenticated() && !!state.source && !!state.results
      && !state.results.mappingIssues.length && !state.results.summary.error && state.selectedRows.size > 0;
  }

  async function reviewConflicts() {
    if (!canReview()) return;
    invalidateReview({ material: false });
    const revision = review.revision;
    state.error = "";
    try {
      const payload = buildProjectImportPayload({
        results: state.results, selectedRows: state.selectedRows, fileName: state.parsed.name,
        worksheetName: state.parsed.type === "XLSX" ? state.sheet : null, sourceNamespace: state.namespace,
      });
      state.busy = true;
      state.checking = true;
      state.step = 4;
      state.reached = 4;
      render();
      const analysis = await checkProjectImport(payload);
      if (review.accept(analysis, revision)) state.payload = payload;
    } catch (failure) {
      if (revision === review.revision) state.error = failure.message || "Conflict review could not be completed.";
    } finally {
      state.busy = false;
      state.checking = false;
      render("sf-import-review-action");
    }
  }

  function onBeforeUnload(event) {
    if (!attempt.busy && !attempt.uncertain) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function sameActor() {
    return isAuthenticated() && getCurrentUser()?.id === attempt.snapshot?.actorId;
  }

  function currentPayload() {
    return buildProjectImportPayload({ results: state.results, selectedRows: state.selectedRows,
      fileName: state.parsed.name, worksheetName: state.parsed.type === "XLSX" ? state.sheet : null,
      sourceNamespace: state.namespace });
  }

  function canCommit() {
    return !state.busy && sameActor() && review.ready && attempt.confirmed && !attempt.result
      && attempt.snapshot.payloadHash === review.analysis.payload_hash;
  }

  async function refreshPortfolio() {
    state.refreshError = "";
    try {
      if (typeof onImported !== "function") throw new Error("No portfolio refresh handler is available.");
      await onImported(attempt.result);
    } catch {
      state.refreshError = "Import completed, but Steerfold could not refresh the portfolio automatically.";
    }
  }

  async function finishImport(value) {
    const snapshot = attempt.snapshot;
    const result = normalizeProjectImportResult(value, { idempotencyKey: snapshot.idempotencyKey,
      payloadHash: snapshot.payloadHash, payload: snapshot.payload, actorId: snapshot.actorId });
    attempt.complete(result);
    state.committing = false;
    state.error = "";
    state.resultPage = 1;
    render();
    await refreshPortfolio();
  }

  async function reconcileImport() {
    state.recovering = true;
    state.committing = false;
    render();
    try {
      const snapshot = attempt.recover(getCurrentUser()?.id);
      const value = await getProjectImportResult(snapshot.idempotencyKey);
      if (value.status === "not_found") {
        attempt.fail(true);
        state.error = "No committed result is visible yet. The original request may still be running. Check again or Retry Import using the same key; do not start another import.";
      } else await finishImport(value);
    } catch (failure) {
      attempt.fail(true);
      state.error = `${failure.message || "Recovery is unavailable."} The original outcome remains uncertain; the same import key is preserved.`;
    } finally { state.recovering = false; }
  }

  async function recoverImport() {
    if (state.busy || !attempt.uncertain || !sameActor()) return;
    state.busy = true;
    state.error = "";
    try { await reconcileImport(); }
    finally { state.busy = false; render("sf-import-recover"); }
  }

  async function submitImport() {
    if (!canCommit()) return;
    let snapshot;
    try {
      if (JSON.stringify(currentPayload()) !== JSON.stringify(state.payload)) {
        throw new Error("Staging changed. Run Review Conflicts again before importing.");
      }
      snapshot = attempt.begin({ payload: state.payload, ready: review.ready, actorId: getCurrentUser()?.id });
    } catch (failure) {
      if (!attempt.uncertain) invalidateReview();
      state.error = failure.message;
      render();
      return;
    }
    state.busy = true;
    state.committing = true;
    state.error = "";
    state.discard = null;
    render();
    try {
      const value = await commitProjectImport(snapshot);
      try { await finishImport(value); }
      catch { attempt.fail(true); await reconcileImport(); }
    } catch (failure) {
      const wasUncertain = attempt.uncertain;
      attempt.fail(failure.uncertain === true);
      if (attempt.uncertain) {
        state.error = failure.message;
        await reconcileImport();
      } else {
        if (failure.requiresReview && !wasUncertain) invalidateReview({ material: false });
        state.error = failure.message || "The import request failed. No successful result was confirmed.";
      }
    } finally {
      state.busy = false;
      state.committing = false;
      render(attempt.result ? "sf-import-complete-title" : attempt.uncertain ? "sf-import-recover" : "sf-import-review-action");
    }
  }

  function resetImport() {
    if (state.busy || attempt.uncertain) return;
    invalidateReview();
    Object.assign(state, { step: 0, reached: 0, parsed: null, source: null, sheet: "", mappings: [],
      suggestions: [], results: null, selectedRows: new Set(), namespace: "", percentMode: "percent",
      filter: "all", page: 1, error: "", discard: null, resultPage: 1, refreshError: "" });
    render();
  }

  function selectSheet(name) {
    const source = state.parsed.readSheet(name);
    state.sheet = name;
    state.source = source;
    state.suggestions = suggestImportMappings(source.headers);
    state.mappings = [...state.suggestions];
    state.reached = 1;
    state.step = 1;
    state.filter = "all";
    revalidate();
  }

  async function loadFile(file) {
    state.busy = true;
    state.error = "";
    render();
    try {
      const parsed = await parseImportFile(file);
      // Check the default worksheet before replacing the current staging state.
      parsed.readSheet(parsed.sheetNames[0]);
      state.parsed = parsed;
      state.namespace = "";
      state.percentMode = "percent";
      selectSheet(parsed.sheetNames[0]);
    } catch (failure) {
      state.error = `${file.name}: ${failure.message || "The file could not be read."}`;
    } finally {
      state.busy = false;
      render();
    }
  }

  function filePicker() {
    const zone = element("div", "", "sf-import-dropzone");
    const label = element("label", "Choose a CSV or XLSX file");
    label.htmlFor = "sf-import-file";
    const input = element("input");
    input.id = label.htmlFor;
    input.type = "file";
    input.accept = ".csv,.xlsx";
    input.disabled = state.busy;
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (file) confirmDiscard(() => loadFile(file));
      input.value = "";
    });
    zone.append(label, input, element("small", "Drop one file here. Maximum 5 MB, 5,000 rows and 100 columns."));
    zone.addEventListener("dragover", (event) => { event.preventDefault(); });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      if (state.busy) return;
      if (event.dataTransfer.files.length !== 1) {
        state.error = "Choose one file at a time.";
        render();
        return;
      }
      confirmDiscard(() => loadFile(event.dataTransfer.files[0]));
    });
    return zone;
  }

  function summary() {
    const result = state.results;
    const group = element("div", "", "sf-import-summary");
    [["Rows", result.rows.length], ["Valid", result.summary.valid], ["Warning", result.summary.warning], ["Error", result.summary.error]].forEach(([label, value]) => {
      const item = element("div");
      item.append(element("strong", String(value)), element("span", label));
      group.append(item);
    });
    return group;
  }

  function mappingIssues() {
    if (!state.results.mappingIssues.length) return element("p", "All required fields are mapped.", "sf-import-ready");
    const list = element("ul", "", "sf-import-error");
    state.results.mappingIssues.forEach((issue) => list.append(element("li", issue)));
    return list;
  }

  function renderMappings() {
    content.append(element("h3", "Map Columns"));
    if (state.parsed.sheetNames.length > 1) {
      const field = element("label", "Worksheet", "sf-import-field");
      const select = element("select");
      state.parsed.sheetNames.forEach((name) => {
        const option = element("option", name);
        option.value = name;
        select.append(option);
      });
      select.value = state.sheet;
      select.disabled = state.busy;
      select.addEventListener("change", () => {
        const name = select.value;
        confirmDiscard(() => {
          try { selectSheet(name); state.error = ""; }
          catch (failure) { state.error = failure.message; }
          render();
        });
      });
      field.append(select);
      content.append(field);
    }
    const percentField = element("label", "Unformatted completion numbers", "sf-import-field");
    const percent = element("select");
    percent.id = "sf-import-percent-mode";
    [["percent", "Percentages: 55 means 55%"], ["fraction", "Fractions: 0.55 means 55%"]].forEach(([value, label]) => {
      const option = element("option", label);
      option.value = value;
      percent.append(option);
    });
    percent.value = state.percentMode;
    percent.addEventListener("change", () => {
      state.percentMode = percent.value;
      state.reached = 1;
      revalidate();
      render(percent.id);
    });
    percentField.append(percent);
    content.append(percentField);
    const grid = element("div", "", "sf-import-mappings");
    state.source.headers.forEach((header, index) => {
      const row = element("div", "", "sf-import-mapping");
      const source = element("div");
      source.append(element("strong", header || `Column ${index + 1}`), element("small", String(state.source.rows[0].values[index] ?? "").slice(0, 120)));
      const field = element("label", `Destination for ${header || `Column ${index + 1}`}`, "sf-import-field");
      const select = element("select");
      select.id = `sf-import-mapping-${index}`;
      const ignore = element("option", "Ignore column");
      ignore.value = "";
      select.append(ignore);
      IMPORT_FIELDS.forEach((definition) => {
        const option = element("option", `${definition.label} (${definition.required ? "Required" : "Optional"})`);
        option.value = definition.key;
        option.disabled = state.mappings.includes(definition.key) && state.mappings[index] !== definition.key;
        select.append(option);
      });
      select.value = state.mappings[index];
      select.addEventListener("change", () => {
        state.mappings[index] = select.value;
        state.reached = 1;
        revalidate();
        render(select.id);
      });
      field.append(select);
      if (state.suggestions[index] && state.suggestions[index] === state.mappings[index]) field.append(element("small", "Suggested mapping"));
      row.append(source, field);
      grid.append(row);
    });
    content.append(grid, mappingIssues(), summary(), button("Reset Mappings", () => confirmDiscard(() => {
      state.mappings = [...state.suggestions];
      state.reached = 1;
      revalidate();
      render();
    })));
  }

  function previewRows() {
    return state.results.rows.filter((row) => state.filter === "all"
      || (state.filter === "valid" ? row.status === "valid" : row.status !== "valid"));
  }

  function renderTable(preview) {
    const field = element("label", "Rows", "sf-import-field");
    const filter = element("select");
    filter.id = "sf-import-row-filter";
    [["all", "All rows"], ["valid", "Valid rows"], ["issues", "Rows with issues"]].forEach(([value, label]) => {
      const option = element("option", label); option.value = value; filter.append(option);
    });
    filter.value = state.filter;
    filter.addEventListener("change", () => { state.filter = filter.value; state.page = 1; render(filter.id); });
    field.append(filter);
    const rows = previewRows();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const wrap = element("div", "", "sf-import-table-wrap");
    const table = element("table", "", "sf-import-table");
    table.append(element("caption", preview ? "Normalized project preview" : "Row validation results"));
    const head = element("thead");
    const headings = element("tr");
    const columns = preview ? ["Source Row", "Status", "Project Name", "Project Manager", "Project Type", `Budget (BAC) (${APP_CONFIG.portfolio.currencyCode})`, "Complete %", "Risk Score", "End Date", "Issues"] : ["Source Row", "Status", "Project Name", "Issues"];
    if (preview) columns.unshift("Select");
    columns.forEach((label) => { const th = element("th", label); th.scope = "col"; headings.append(th); });
    head.append(headings);
    const body = element("tbody");
    slice.forEach((row) => {
      const tr = element("tr");
      if (preview) {
        const td = element("td", "", "sf-import-selection-cell");
        const select = element("input");
        select.type = "checkbox";
        select.id = `sf-import-select-${row.rowNumber}`;
        select.setAttribute("aria-label", `Select source row ${row.rowNumber}: ${row.project.projectName || "Unnamed project"}`);
        select.checked = state.selectedRows.has(row.rowNumber);
        select.disabled = row.status === "error";
        select.addEventListener("change", () => {
          if (select.checked) state.selectedRows.add(row.rowNumber); else state.selectedRows.delete(row.rowNumber);
          invalidateReview();
          render(select.id);
        });
        td.append(select);
        tr.append(td);
      }
      const label = `${row.status[0].toUpperCase()}${row.status.slice(1)}`;
      const values = preview ? [row.rowNumber, label, row.project.projectName, row.project.projectManager, row.project.projectType,
        row.project.budgetBAC, Number.isFinite(row.project.percentComplete) ? `${Number((row.project.percentComplete * 100).toFixed(6))}%` : null, row.project.riskScore, row.project.endDate]
        : [row.rowNumber, label, row.project.projectName];
      values.forEach((value, index) => {
        const td = element("td", String(value ?? "--"));
        if (index === 1) td.dataset.status = row.status;
        tr.append(td);
      });
      const messages = element("td");
      const issues = [...row.errors, ...row.warnings];
      if (!issues.length) messages.textContent = state.results.mappingIssues.length ? "Resolve the missing column mappings above." : "No issues";
      else { const list = element("ul"); issues.forEach((issue) => list.append(element("li", issue))); messages.append(list); }
      tr.append(messages);
      body.append(tr);
    });
    if (!slice.length) { const row = element("tr"); const td = element("td", "No rows in this view."); td.colSpan = columns.length; row.append(td); body.append(row); }
    table.append(head, body);
    wrap.append(table);
    const pagination = element("div", "", "sf-import-pagination");
    const previous = button("Previous", () => { state.page -= 1; render("sf-import-previous"); });
    previous.id = "sf-import-previous";
    previous.disabled = state.page <= 1;
    previous.setAttribute("aria-label", "Previous preview page");
    const next = button("Next", () => { state.page += 1; render("sf-import-next"); });
    next.id = "sf-import-next";
    next.disabled = state.page >= pages;
    next.setAttribute("aria-label", "Next preview page");
    pagination.append(previous, element("span", `Page ${state.page} of ${pages}. Previewing ${slice.length} of ${rows.length} rows (${state.source.rows.length} total).`), next);
    content.append(field, wrap, pagination);
  }

  function renderNamespace() {
    const field = element("label", "Source namespace (Optional)", "sf-import-field sf-import-namespace");
    const input = element("input");
    input.type = "text";
    input.id = "sf-import-namespace";
    input.maxLength = 128;
    input.value = state.namespace;
    input.setAttribute("aria-describedby", "sf-import-namespace-help");
    const help = element("small", "Helps recognize previously imported source IDs. Leave blank to keep source IDs as provenance only.");
    help.id = "sf-import-namespace-help";
    input.addEventListener("input", () => {
      state.namespace = input.value;
      invalidateReview();
      state.error = "";
      error.hidden = true;
      renderConflictResults();
    });
    field.append(input, help);
    content.append(field);
  }

  function renderConflictList(items, warning) {
    const section = element("section", "", "sf-import-conflict-section");
    section.append(element("h4", `${warning ? "Duplicate warnings" : "Blocking conflicts"} (${items.length})`));
    const pageKey = warning ? "warningPage" : "blockingPage";
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state[pageKey] = Math.min(state[pageKey], pages);
    const list = element("ul", "", "sf-import-conflict-list");
    items.slice((state[pageKey] - 1) * PAGE_SIZE, state[pageKey] * PAGE_SIZE).forEach((item) => {
      const entry = element("li", "", warning ? "sf-import-conflict-warning" : "sf-import-conflict-blocking");
      entry.append(element("strong", CONFLICT_MESSAGES[item.code]));
      const rows = item.source_rows || [item.source_row];
      entry.append(element("p", `Source ${rows.length > 1 ? "rows" : "row"}: ${rows.join(", ")}`));
      const incomingIds = state.payload.rows.filter((row) => rows.includes(row.source_row) && row.source_project_id)
        .map((row) => `Row ${row.source_row}: ${row.source_project_id}`);
      if (incomingIds.length) entry.append(element("p", `Source Project ID: ${incomingIds.join("; ")}`));
      const existing = [["Project", item.existing_project_id], ["Name", item.existing_project_name],
        ["Manager", item.existing_project_manager], ["Start date", item.existing_start_date]]
        .filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
      if (existing.length) entry.append(element("p", existing.join(" | ")));
      if (warning) {
        const label = element("label", "", "sf-import-acknowledgement");
        const check = element("input");
        check.type = "checkbox";
        check.setAttribute("aria-label", `Acknowledge warning for source ${rows.length > 1 ? "rows" : "row"} ${rows.join(", ")}${item.existing_project_id ? `, existing project ${item.existing_project_id}` : ""}: ${CONFLICT_MESSAGES[item.code]}`);
        check.checked = review.isAcknowledged(item.conflict_id);
        check.value = item.conflict_id;
        check.addEventListener("change", () => {
          review.acknowledge(item.conflict_id, check.checked);
          updateReadiness();
          renderFinalConfirmation();
        });
        label.append(check, element("span", "I reviewed this warning and intend to create a separate project."));
        entry.append(label);
      }
      list.append(entry);
    });
    section.append(list);
    if (pages > 1) {
      const controls = element("div", "", "sf-import-pagination");
      const previous = button("Previous", () => { state[pageKey] -= 1; renderConflictResults(); reviewContent.querySelector("h4")?.focus(); });
      const next = button("Next", () => { state[pageKey] += 1; renderConflictResults(); reviewContent.querySelector("h4")?.focus(); });
      previous.disabled = state[pageKey] <= 1;
      next.disabled = state[pageKey] >= pages;
      previous.setAttribute("aria-label", `Previous ${warning ? "warnings" : "blocking conflicts"} page`);
      next.setAttribute("aria-label", `Next ${warning ? "warnings" : "blocking conflicts"} page`);
      controls.append(previous, element("span", `Page ${state[pageKey]} of ${pages}`), next);
      section.append(controls);
    }
    section.querySelector("h4").tabIndex = -1;
    return section;
  }

  function updateReadiness() {
    const target = reviewContent.querySelector("[data-import-readiness]");
    if (!target) return;
    const analysis = review.analysis;
    const summary = element("dl", "", "sf-import-conflict-summary");
    [["Rows selected", state.selectedRows.size], ["Blocking conflicts", analysis.blocking_count],
      ["Warnings", analysis.warning_count], ["Acknowledged", `${review.acknowledgedCount} of ${analysis.warning_count}`],
      ["Server check", "Complete"]].forEach(([label, value]) => summary.append(element("dt", label), element("dd", String(value))));
    target.replaceChildren(summary, element("p", analysis.blocking_count ? "Safe Import cannot continue. Blocking conflicts cannot be overridden."
      : review.ready ? "Ready for final confirmation. No records have been imported."
        : "Review and acknowledge every duplicate warning before final confirmation."));
  }

  function renderConflictResults() {
    reviewContent.replaceChildren();
    if (!review.analysis) {
      reviewContent.append(element("p", state.checking ? "Checking selected rows against live projects..."
        : "A successful server check is required. Run Review Conflicts for the current staging and selection.", "sf-import-context"));
      return;
    }
    const readiness = element("div");
    readiness.dataset.importReadiness = "";
    readiness.setAttribute("role", "status");
    reviewContent.append(readiness);
    updateReadiness();
    const analysis = review.analysis;
    if (analysis.blocking_count) reviewContent.append(renderConflictList(analysis.blocking_conflicts, false));
    if (analysis.warning_count) {
      reviewContent.append(element("p", "Acknowledgement means you reviewed a duplicate warning and intend to create a separate new project. It does not merge or resolve an existing project.", "sf-import-context"));
      const acknowledgeAll = button("Acknowledge all warnings", () => {
        review.acknowledgeAll();
        renderConflictResults();
        document.getElementById("sf-import-acknowledge-all")?.focus();
      });
      acknowledgeAll.id = "sf-import-acknowledge-all";
      reviewContent.append(acknowledgeAll);
      reviewContent.append(renderConflictList(analysis.warnings, true));
    } else if (!analysis.blocking_count) {
      reviewContent.append(element("p", "No blocking conflicts or duplicate warnings were found.", "sf-import-ready"));
    }
    const confirmation = element("section", "", "sf-import-confirmation");
    confirmation.id = "sf-import-final-confirmation";
    reviewContent.append(confirmation);
    renderFinalConfirmation();
  }

  function renderFinalConfirmation() {
    const target = reviewContent.querySelector("#sf-import-final-confirmation");
    if (!target) return;
    target.replaceChildren();
    if (!review.ready) { attempt.confirm(false); return; }
    try {
      attempt.prepare({ payload: state.payload, payloadHash: review.analysis.payload_hash,
        acknowledgements: review.analysis.warnings.map((warning) => warning.conflict_id), actorId: getCurrentUser()?.id });
    } catch (failure) {
      const message = element("p", failure.message, "sf-import-error");
      message.setAttribute("role", "alert"); target.append(message); return;
    }
    target.append(element("h4", "Final confirmation"));
    const summary = element("dl", "", "sf-import-conflict-summary");
    [["Rows selected", state.payload.rows.length], ["Source namespace", state.payload.source_namespace || "None"],
      ["Warnings acknowledged", `${review.acknowledgedCount} of ${review.analysis.warning_count}`],
      ["Server conflict check", "Complete"], ["Currency", "CAD"]]
      .forEach(([label, value]) => summary.append(element("dt", label), element("dd", String(value))));
    target.append(summary, element("p", "New projects will be created. Existing projects will not be updated or merged."),
      element("p", "Steerfold will generate new project IDs."));
    const label = element("label", "", "sf-import-acknowledgement");
    const check = element("input");
    check.type = "checkbox";
    check.id = "sf-import-confirm-create";
    check.checked = attempt.confirmed;
    label.append(check, element("span", "I confirm that I want to create these projects as new Steerfold projects."));
    const action = button("Import Projects", submitImport, "sf-import-primary");
    action.id = "sf-import-commit";
    action.disabled = !canCommit();
    check.addEventListener("change", () => { attempt.confirm(check.checked); action.disabled = !canCommit(); });
    target.append(label, action);
  }

  function renderRecovery() {
    content.append(element("h3", "Import outcome not yet confirmed"),
      element("p", "Staging is locked to protect against duplicate creation. Recovery and retries reuse the exact original payload, acknowledgements and import key.", "sf-import-context"));
    const details = element("details", "", "sf-import-recovery-details");
    details.append(element("summary", "Recovery details"), element("p", `Import key: ${attempt.snapshot.idempotencyKey}`),
      element("p", "Recovery is kept in this browser tab. Do not reload or start another import until the outcome is resolved."));
    content.append(details);
    const recover = button("Check Import Result", recoverImport);
    recover.id = "sf-import-recover";
    recover.disabled = !sameActor();
    const retry = button("Retry Import", submitImport, "sf-import-primary");
    retry.disabled = !canCommit();
    footer.append(recover, retry, button("Close (keep recovery)", close));
  }

  function renderComplete() {
    const result = attempt.result;
    const title = element("h3", "Import Complete");
    title.id = "sf-import-complete-title";
    title.tabIndex = -1;
    content.append(title, element("p", `${result.rows_imported} projects imported.`, "sf-import-ready"));
    const summary = element("dl", "", "sf-import-conflict-summary");
    [["Import ID", result.import_id], ["Committed", new Date(result.committed_at).toLocaleString(APP_CONFIG.portfolio.locale)],
      ["Source namespace", result.source_namespace || "None"], ["Currency", result.currency_code]]
      .forEach(([label, value]) => summary.append(element("dt", label), element("dd", value)));
    content.append(summary);
    if (result.replayed) content.append(element("p", "This import had already been committed. Steerfold restored the original result.", "sf-import-context"));
    if (state.refreshError) {
      const message = element("p", state.refreshError, "sf-import-error");
      message.setAttribute("role", "alert");
      content.append(message, button("Retry Portfolio Refresh", async () => {
        if (state.busy) return;
        state.busy = true; render();
        try { await refreshPortfolio(); } finally { state.busy = false; render(); }
      }));
    }
    const wrap = element("div", "", "sf-import-table-wrap");
    const table = element("table", "", "sf-import-table sf-import-result-table");
    table.append(element("caption", "Created projects"));
    const head = element("thead");
    const headings = element("tr");
    ["Source Row", "Source Project ID", "Steerfold Project ID", "Project Name"].forEach((label) => {
      const th = element("th", label); th.scope = "col"; headings.append(th);
    });
    head.append(headings);
    const body = element("tbody");
    const pages = Math.ceil(result.rows.length / PAGE_SIZE);
    result.rows.slice((state.resultPage - 1) * PAGE_SIZE, state.resultPage * PAGE_SIZE).forEach((row) => {
      const tr = element("tr");
      [row.source_row, row.source_project_id || "None", row.project_id, row.project_name]
        .forEach((value) => tr.append(element("td", String(value))));
      body.append(tr);
    });
    table.append(head, body); wrap.append(table); content.append(wrap);
    if (pages > 1) {
      const pagination = element("div", "", "sf-import-pagination");
      const previous = button("Previous", () => { state.resultPage -= 1; render(); });
      const next = button("Next", () => { state.resultPage += 1; render(); });
      previous.disabled = state.resultPage <= 1; next.disabled = state.resultPage >= pages;
      previous.setAttribute("aria-label", "Previous imported projects page");
      next.setAttribute("aria-label", "Next imported projects page");
      pagination.append(previous, element("span", `Page ${state.resultPage} of ${pages}`), next); content.append(pagination);
    }
    footer.append(button("View Projects", () => { if (state.busy) return; close(); onViewProjects?.(); }, "sf-import-primary"),
      button("Start Another Import", resetImport), button("Close", close));
  }

  function render(focusId = null) {
    steps.replaceChildren();
    STEPS.forEach((name, index) => {
      const item = element("li");
      const needsAttention = state.results && ((index === 1 && state.results.mappingIssues.length) || (index === 2 && state.results.summary.error));
      const control = button(`${index + 1}. ${name}${needsAttention && index <= state.reached ? " - Needs attention" : index < state.step ? " - Complete" : ""}`, () => { state.step = index; state.error = ""; state.discard = null; render(); });
      control.disabled = state.busy || attempt.uncertain || !!attempt.result || index > state.reached;
      if (index === state.step) control.setAttribute("aria-current", "step");
      item.append(control); steps.append(item);
    });
    error.textContent = state.error;
    error.hidden = !state.error;
    status.textContent = state.recovering ? "Recovering the existing import result..." : state.committing ? `Creating ${attempt.snapshot.payload.rows.length} projects securely...`
      : attempt.result ? state.busy ? "Refreshing the live portfolio..." : "Import committed."
        : state.checking ? "Checking conflicts with the server..." : state.busy ? "Reading file locally..." : state.parsed ? `${state.parsed.name} | ${state.parsed.type} | ${state.sheet} | ${state.source.rows.length} rows` : "No file selected";
    dialog.setAttribute("aria-busy", String(state.busy));
    content.replaceChildren();
    footer.replaceChildren();
    if (attempt.result) {
      if (sameActor()) renderComplete();
      else { content.append(element("p", "Import completed. Sign in with the original account to view its result.")); footer.append(button("Close", close)); }
    } else if (attempt.uncertain) renderRecovery();
    else if (state.step === 0) content.append(filePicker());
    else if (state.step === 1) renderMappings();
    else if (state.step === 4) {
      content.append(element("h3", "Conflict Review"));
      renderNamespace();
      content.append(reviewContent);
      renderConflictResults();
    } else {
      content.append(element("h3", STEPS[state.step]), summary(), mappingIssues());
      if (state.step === 3) content.append(element("p", state.results.summary.error ? "Preparation needs attention. No records have been imported."
        : state.results.summary.warning ? "Preparation complete with warnings to review. No records have been imported."
          : "Import preparation complete. No records have been imported.", "sf-import-context"));
      if (state.step === 3) {
        renderNamespace();
        const selection = element("div", "", "sf-import-pagination");
        selection.append(element("span", `${state.selectedRows.size} rows selected`),
          button("Select all eligible rows", () => {
            state.selectedRows = new Set(state.results.rows.filter((row) => row.status !== "error").map((row) => row.rowNumber));
            invalidateReview(); render();
          }), button("Clear selection", () => { state.selectedRows.clear(); invalidateReview(); render(); }));
        content.append(selection);
      }
      renderTable(state.step === 3);
    }
    if (attempt.result || attempt.uncertain) {
      // Completed and uncertain attempts expose only their dedicated actions.
    } else if (state.discard) {
      footer.append(element("p", "Discard the current staging or mapping changes?", "sf-import-discard"));
      footer.append(button("Keep Staging", () => { state.discard = null; render(); }), button("Discard Changes", () => {
        const action = state.discard;
        state.discard = null;
        action();
      }));
    } else {
      footer.append(button("Cancel", () => confirmDiscard(close)));
      if (state.source) footer.append(button("Replace File", () => { state.step = 0; state.error = ""; render(); }));
      if (state.step > 0) footer.append(button("Back", () => { state.step -= 1; state.error = ""; render(); }));
      if (state.source && state.step < 3) footer.append(button(`Continue to ${STEPS[state.step + 1]}`, () => {
        state.step += 1; state.reached = Math.max(state.reached, state.step); state.error = ""; render();
      }, "sf-import-primary"));
      if (state.step >= 3) {
        const action = button("Review Conflicts", reviewConflicts, "sf-import-primary");
        action.id = "sf-import-review-action";
        action.disabled = !canReview();
        footer.append(action, button("Return to Projects", () => confirmDiscard(close)));
        if (!isAuthenticated()) content.append(element("p", "Sign in to review conflicts. Local staging remains available.", "sf-import-context"));
      }
    }
    if (state.busy) dialog.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
    if (focusId) document.getElementById(focusId)?.focus();
    else content.querySelector("input, select")?.focus();
  }

  dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (attempt.uncertain || attempt.result) close(); else confirmDiscard(close); });
  window.addEventListener("auth:changed", onAuthChanged);
  window.addEventListener("beforeunload", onBeforeUnload);
  document.body.append(dialog);
  render();
  dialog.showModal();
  content.querySelector("input")?.focus();
}
