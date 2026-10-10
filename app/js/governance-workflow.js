import { formatCurrency } from "./formatters.js";
import { APP_CONFIG } from "./app-config.js";
import { isAuthenticated } from "./auth-service.js";
import {
  listChangeRequests,
  createChangeRequest,
  updateDraftChangeRequest,
  transitionChangeRequestStatus,
  applyApprovedChangeRequest,
  deleteDraftChangeRequest,
  listChangeRequestEvents,
} from "./change-request-service.js";

const EMPTY = "\u2014";
const DIALOG_ID = "sf-governance-workflow-dialog";
const STATUSES = [
  "Draft",
  "Submitted",
  "Under Review",
  "Approved",
  "Rejected",
  "Deferred",
  "Withdrawn",
];

function formatMoney(value, { signed = false } = {}) {
  if (!Number.isFinite(value)) return EMPTY;
  if (signed && value > 0) return `+${formatCurrency(value)}`;
  return formatCurrency(value);
}

function formatDateTime(value) {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return new Intl.DateTimeFormat(APP_CONFIG.portfolio.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/\s+/g, "-");
}

function createStatusChip(status) {
  const chip = document.createElement("span");
  chip.className = `sf-governance-status sf-governance-status--${statusClass(status)}`;
  chip.textContent = status || EMPTY;
  return chip;
}

function getFocusableElements(dialog) {
  return [...dialog.querySelectorAll([
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(","))].filter((element) => {
    return !element.closest("[hidden]") && element.getClientRects().length > 0;
  });
}

function trapFocus(event, dialog) {
  const elements = getFocusableElements(dialog);
  if (elements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function makeBackgroundInert(overlay) {
  const siblings = [...document.body.children]
    .filter((element) => element !== overlay)
    .map((element) => ({ element, wasInert: element.inert }));
  siblings.forEach(({ element }) => { element.inert = true; });
  return () => siblings.forEach(({ element, wasInert }) => {
    element.inert = wasInert;
  });
}

function openWorkflowDialog({
  title,
  message,
  details = [],
  noteLabel = null,
  noteHelper = null,
  warning = null,
  confirmText,
  pendingText = null,
  danger = false,
  onConfirm,
}) {
  if (document.getElementById(DIALOG_ID)) return;
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  const dialog = document.createElement("section");
  const heading = document.createElement("h2");
  const copy = document.createElement("p");
  const detailList = document.createElement("dl");
  const noteField = document.createElement("div");
  const note = document.createElement("textarea");
  const noteHelp = document.createElement("small");
  const warningElement = document.createElement("p");
  const error = document.createElement("p");
  const actions = document.createElement("div");
  const cancel = document.createElement("button");
  const confirm = document.createElement("button");
  let pending = false;
  let closed = false;
  let restoreBackground = () => {};

  overlay.className = "sf-governance-dialog-overlay";
  dialog.id = DIALOG_ID;
  dialog.className = "sf-governance-dialog";
  dialog.tabIndex = -1;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", `${DIALOG_ID}-title`);
  heading.id = `${DIALOG_ID}-title`;
  heading.textContent = title;
  copy.textContent = message;
  detailList.className = "sf-governance-dialog-details";
  details.forEach(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value ?? EMPTY;
    row.append(term, description);
    detailList.append(row);
  });
  noteField.className = "sf-governance-dialog-field";
  if (noteLabel) {
    const label = document.createElement("label");
    note.id = `${DIALOG_ID}-note`;
    note.rows = 3;
    label.htmlFor = note.id;
    label.textContent = noteLabel;
    noteHelp.textContent = noteHelper || "";
    noteHelp.hidden = !noteHelper;
    noteField.append(label, note, noteHelp);
  } else {
    noteField.hidden = true;
  }
  warningElement.className = "sf-governance-dialog-warning";
  warningElement.textContent = warning || "";
  warningElement.hidden = !warning;
  error.className = "sf-governance-dialog-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  actions.className = "sf-governance-dialog-actions";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  confirm.type = "button";
  confirm.textContent = confirmText;
  confirm.className = danger ? "sf-governance-dialog-danger" : "sf-governance-dialog-confirm";
  actions.append(cancel, confirm);
  dialog.append(heading, copy, detailList, noteField, warningElement, error, actions);
  overlay.append(dialog);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("auth:changed", onAuthChange);
    restoreBackground();
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function onKeydown(event) {
    if (event.key === "Tab") trapFocus(event, dialog);
    if (event.key === "Escape" && !pending) close();
  }

  function onAuthChange() {
    if (!isAuthenticated()) close();
  }

  cancel.addEventListener("click", () => { if (!pending) close(); });
  confirm.addEventListener("click", async () => {
    if (pending) return;
    pending = true;
    cancel.disabled = true;
    confirm.disabled = true;
    const originalConfirmText = confirm.textContent;
    if (pendingText) confirm.textContent = pendingText;
    error.hidden = true;
    try {
      await onConfirm(note.value.trim() || null);
      close();
    } catch (caught) {
      pending = false;
      cancel.disabled = false;
      confirm.disabled = caught?.preventRetry === true;
      confirm.textContent = originalConfirmText;
      error.textContent = caught?.message ?? "The action could not be completed.";
      error.hidden = false;
    }
  });

  document.body.append(overlay);
  restoreBackground = makeBackgroundInert(overlay);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("auth:changed", onAuthChange);
  requestAnimationFrame(() => (noteLabel ? note : cancel).focus());
}

function assessmentPayload(assessment) {
  return {
    projectCode: assessment.project.projectId,
    budgetChangeAmount: assessment.budgetChangeAmount,
    changeType: assessment.changeType,
    changeSummary: assessment.changeSummary,
    impactScope: assessment.impacts.Scope,
    impactSchedule: assessment.impacts.Schedule,
    impactCost: assessment.impacts.Cost,
    impactQuality: assessment.impacts.Quality,
    impactResources: assessment.impacts.Resources,
    impactRisk: assessment.impacts.Risk,
    impactStakeholders: assessment.impacts.Stakeholders,
  };
}

export function initGovernanceWorkflow({
  container,
  projects,
  assessment,
  onProjectDataRefresh,
  initialSelectedId = null,
  initialSuccess = "",
}) {
  if (!container) return null;
  const state = {
    authenticated: isAuthenticated(),
    requests: [],
    selectedId: initialSelectedId,
    events: [],
    search: "",
    status: "All",
    loading: false,
    historyLoading: false,
    pending: false,
    editingId: null,
    error: "",
    success: initialSuccess,
    authVersion: 0,
  };

  function projectName(request) {
    const project = projects.find((item) => item.projectId === request.projectCode);
    return project?.projectName
      ? `${request.projectCode} · ${project.projectName}`
      : request.projectCode || EMPTY;
  }

  function requestProject(request) {
    return projects.find((item) => item.projectId === request.projectCode) ?? null;
  }

  function selectedRequest() {
    return state.requests.find((request) => request.id === state.selectedId) ?? null;
  }

  function filteredRequests() {
    const query = state.search.trim().toLocaleLowerCase();
    return state.requests.filter((request) => {
      const matchesStatus = state.status === "All" || request.status === state.status;
      const searchable = `${request.requestId} ${projectName(request)} ${request.changeType}`.toLocaleLowerCase();
      return matchesStatus && (!query || searchable.includes(query));
    });
  }

  function addFact(list, label, value) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value ?? EMPTY;
    row.append(term, description);
    list.append(row);
  }

  function renderRequestList(host) {
    const requests = filteredRequests();
    if (!requests.length) {
      const empty = document.createElement("div");
      empty.className = "sf-governance-workflow-empty";
      const title = document.createElement("strong");
      const copy = document.createElement("p");
      title.textContent = state.requests.length
        ? "No change requests match the current filters."
        : "No change requests have been created yet.";
      copy.textContent = state.requests.length
        ? "Adjust the search or status filter."
        : "Use the Governance assessment above, then save it as a Draft.";
      empty.append(title, copy);
      host.append(empty);
      return;
    }

    requests.forEach((request) => {
      const button = document.createElement("button");
      const header = document.createElement("span");
      const requestId = document.createElement("strong");
      const project = document.createElement("span");
      const financial = document.createElement("span");
      const created = document.createElement("span");
      button.type = "button";
      button.disabled = state.pending;
      button.className = "sf-governance-request-row";
      button.classList.toggle("sf-governance-request-row--selected", request.id === state.selectedId);
      button.setAttribute("aria-pressed", String(request.id === state.selectedId));
      button.setAttribute("aria-label", `Open ${request.requestId}, ${projectName(request)}, ${request.status}`);
      header.className = "sf-governance-request-row-header";
      requestId.textContent = request.requestId;
      header.append(requestId, createStatusChip(request.status));
      project.className = "sf-governance-request-project";
      project.textContent = projectName(request);
      financial.className = "sf-governance-request-financial";
      financial.textContent = `${formatMoney(request.budgetChangeAmount, { signed: true })} · Proposed ${formatMoney(request.proposedBac)}`;
      created.className = "sf-governance-request-date";
      created.textContent = `Created ${formatDateTime(request.createdAt)}`;
      button.append(header, project, financial, created);
      button.addEventListener("click", () => selectRequest(request.id));
      host.append(button);
    });
  }

  function renderHistory(host, request) {
    const title = document.createElement("h3");
    title.textContent = "Activity History";
    host.append(title);
    if (state.historyLoading) {
      const loading = document.createElement("p");
      loading.textContent = "Loading activity history...";
      host.append(loading);
      return;
    }
    if (!state.events.length) {
      const empty = document.createElement("p");
      empty.textContent = "No activity history is available.";
      host.append(empty);
      return;
    }
    const list = document.createElement("ol");
    list.className = "sf-governance-history-list";
    state.events.forEach((event) => {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      const transition = document.createElement("span");
      const date = document.createElement("time");
      heading.textContent = event.eventType === "Applied"
        ? "Baseline Applied"
        : event.eventType;
      transition.textContent = event.fromStatus && event.toStatus
        ? `${event.fromStatus} → ${event.toStatus}`
        : event.toStatus || "";
      date.dateTime = event.createdAt || "";
      date.textContent = formatDateTime(event.createdAt);
      item.append(heading, transition, date);
      if (event.note) {
        const note = document.createElement("p");
        note.textContent = event.note;
        item.append(note);
      }
      list.append(item);
    });
    host.append(list);
  }

  function transitionAction(request, newStatus, label) {
    const isDecision = ["Approved", "Rejected", "Deferred"].includes(newStatus);
    const isApproval = newStatus === "Approved";
    openWorkflowDialog({
      title: label,
      message: isApproval
        ? "This records the governance decision only. It will not change the project budget baseline."
        : `Confirm the transition of ${request.requestId} to ${newStatus}.`,
      details: isApproval ? [
        ["Request", request.requestId],
        ["Project", projectName(request)],
        ["Current BAC", formatMoney(request.originalBac)],
        ["Budget Change", formatMoney(request.budgetChangeAmount, { signed: true })],
        ["Proposed BAC", formatMoney(request.proposedBac)],
      ] : [["Request", request.requestId], ["Project", projectName(request)]],
      noteLabel: isDecision ? "Decision Note (optional)" : "Transition Note (optional)",
      warning: isApproval
        ? "Applying an approved budget change is a separate controlled action."
        : null,
      confirmText: isApproval ? "Record Approval" : label,
      danger: ["Rejected", "Withdrawn"].includes(newStatus),
      onConfirm: (note) => mutate(
        () => transitionChangeRequestStatus(request.id, newStatus, note),
        request.id,
        `${request.requestId} moved to ${newStatus}.`,
      ),
    });
  }

  function renderActions(host, request) {
    const actions = [];
    if (request.status === "Draft") {
      actions.push(["Load Draft into Assessment", () => editDraft(request)]);
      actions.push(["Submit", () => transitionAction(request, "Submitted", "Submit Request")]);
      actions.push(["Withdraw", () => transitionAction(request, "Withdrawn", "Withdraw Request")]);
      actions.push(["Delete Draft", () => deleteDraft(request), "danger"]);
    } else if (request.status === "Submitted") {
      actions.push(["Start Review", () => transitionAction(request, "Under Review", "Start Review")]);
      actions.push(["Withdraw", () => transitionAction(request, "Withdrawn", "Withdraw Request")]);
    } else if (request.status === "Under Review") {
      actions.push(["Approve", () => transitionAction(request, "Approved", "Approve Request")]);
      actions.push(["Reject", () => transitionAction(request, "Rejected", "Reject Request"), "danger"]);
      actions.push(["Defer", () => transitionAction(request, "Deferred", "Defer Request")]);
    } else if (request.status === "Deferred") {
      actions.push(["Resume Review", () => transitionAction(request, "Under Review", "Resume Review")]);
    }
    actions.forEach(([label, handler, tone]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = state.pending;
      if (tone) button.dataset.tone = tone;
      button.addEventListener("click", handler);
      host.append(button);
    });
  }


  function applicationErrorNeedsRefresh(message) {
    return message.includes("baseline no longer matches") ||
      message.includes("already been applied");
  }

  function openApplyDialog(request) {
    const project = requestProject(request);
    const currentBac = Number(project?.budgetBAC);

    openWorkflowDialog({
      title: "Apply Approved Budget Change",
      message: "This action will update the project's approved budget baseline. The governance decision is already recorded. This is the separate controlled action that applies the approved budget change.",
      details: [
        ["Request ID", request.requestId],
        ["Project", projectName(request)],
        ["Current Project BAC", formatMoney(currentBac)],
        ["Approved Budget Change", formatMoney(request.budgetChangeAmount, { signed: true })],
        ["New Project BAC", formatMoney(request.proposedBac)],
      ],
      noteLabel: "Application Note",
      noteHelper: "Optional note describing the baseline implementation.",
      warning: "Proceed only when the approved change is ready to become the active project baseline. This does not change earned value, planned value, actual cost, schedule, risk or completion data.",
      confirmText: "Apply Budget Baseline",
      pendingText: "Applying baseline...",
      onConfirm: async (applicationNote) => {
        let applied = false;
        try {
          await applyApprovedChangeRequest(request.id, applicationNote);
          applied = true;
          await onProjectDataRefresh?.({
            requestId: request.id,
            successMessage: `${request.requestId} applied to the project budget baseline.`,
          });
        } catch (error) {
          const message = error?.message ?? "The approved budget change could not be applied.";

          if (!applied && applicationErrorNeedsRefresh(message)) {
            try {
              await onProjectDataRefresh?.({ requestId: request.id });
            } catch {
              // Preserve the authoritative application error.
            }
          } else if (applied) {
            try {
              await loadRequests(request.id);
            } catch {
              // The application succeeded; preserve the refresh error below.
            }
            const refreshError = new Error(
              `${request.requestId} was applied, but the latest project data could not be refreshed.`,
            );
            refreshError.preventRetry = true;
            throw refreshError;
          }

          throw new Error(message);
        }
      },
    });
  }

  function renderBaselineApplication(host, request) {
    if (request.status !== "Approved") return;

    const project = requestProject(request);
    const currentBac = Number(project?.budgetBAC);
    const hasCurrentBac = Number.isFinite(currentBac);
    const hasDrift = hasCurrentBac && currentBac !== request.originalBac;
    const applied = Boolean(request.appliedAt);
    const section = document.createElement("section");
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    const stateIndicator = document.createElement("strong");
    const copy = document.createElement("p");
    const facts = document.createElement("dl");

    section.className = "sf-governance-baseline-application";
    heading.className = "sf-governance-baseline-header";
    title.textContent = "Baseline Application";
    stateIndicator.className = `sf-governance-application-state sf-governance-application-state--${applied ? "applied" : "pending"}`;
    stateIndicator.textContent = applied ? "Applied" : "Not Applied";
    heading.append(title, stateIndicator);
    copy.textContent = applied
      ? "The approved budget change has been applied to the project baseline. Governance status remains Approved."
      : "This Change Request has been approved, but the project budget baseline has not been updated.";
    facts.className = "sf-governance-application-facts";

    if (applied) {
      addFact(facts, "Applied At", formatDateTime(request.appliedAt));
      addFact(facts, "BAC Before", formatMoney(request.appliedBacBefore));
      addFact(facts, "BAC After", formatMoney(request.appliedBacAfter));
      addFact(facts, "Application Note", request.applicationNote || EMPTY);
    } else {
      addFact(facts, "Current Project BAC", formatMoney(currentBac));
      addFact(facts, "Approved Budget Change", formatMoney(request.budgetChangeAmount, { signed: true }));
      addFact(facts, "Approved Proposed BAC", formatMoney(request.proposedBac));
    }

    section.append(heading, copy, facts);

    if (!applied && hasDrift) {
      const warning = document.createElement("p");
      warning.className = "sf-governance-application-warning";
      warning.textContent = "The project baseline no longer matches the baseline captured when this Change Request was created.";
      section.append(warning);
    }

    if (!applied) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "sf-governance-apply-button sf-governance-print-hide";
      apply.textContent = "Apply Approved Change";
      apply.disabled = state.pending || hasDrift || !hasCurrentBac;
      apply.addEventListener("click", () => openApplyDialog(request));
      section.append(apply);
    }

    host.append(section);
  }

  function renderDetail(host) {
    const request = selectedRequest();
    if (!request) {
      const empty = document.createElement("p");
      empty.className = "sf-governance-detail-empty";
      empty.textContent = "Select a Change Request to review its details and activity.";
      host.append(empty);
      return;
    }
    const header = document.createElement("div");
    const identity = document.createElement("div");
    const requestId = document.createElement("strong");
    const project = document.createElement("span");
    const actions = document.createElement("div");
    header.className = "sf-governance-detail-header";
    identity.className = "sf-governance-detail-identity";
    requestId.textContent = request.requestId;
    project.textContent = projectName(request);
    identity.append(requestId, project);
    header.append(identity, createStatusChip(request.status));
    actions.className = "sf-governance-lifecycle-actions sf-governance-print-hide";
    renderActions(actions, request);

    const facts = document.createElement("dl");
    facts.className = "sf-governance-detail-facts";
    addFact(facts, "Created", formatDateTime(request.createdAt));
    addFact(facts, "Updated", formatDateTime(request.updatedAt));
    addFact(facts, "Original BAC", formatMoney(request.originalBac));
    addFact(facts, "Budget Change", formatMoney(request.budgetChangeAmount, { signed: true }));
    addFact(facts, "Proposed BAC", formatMoney(request.proposedBac));
    addFact(facts, "Change Type", request.changeType || EMPTY);
    addFact(facts, "Change Summary", request.changeSummary || EMPTY);
    addFact(facts, "Scope", request.impactScope || EMPTY);
    addFact(facts, "Schedule", request.impactSchedule || EMPTY);
    addFact(facts, "Cost", request.impactCost || EMPTY);
    addFact(facts, "Quality", request.impactQuality || EMPTY);
    addFact(facts, "Resources", request.impactResources || EMPTY);
    addFact(facts, "Risk", request.impactRisk || EMPTY);
    addFact(facts, "Stakeholders", request.impactStakeholders || EMPTY);
    addFact(facts, "Submitted", formatDateTime(request.submittedAt));
    addFact(facts, "Reviewed", formatDateTime(request.reviewedAt));
    addFact(facts, "Decided", formatDateTime(request.decidedAt));
    addFact(facts, "Decision Note", request.decisionNote || EMPTY);
    host.append(header, actions, facts);

    renderBaselineApplication(host, request);

    const history = document.createElement("section");
    history.className = "sf-governance-history";
    history.setAttribute("aria-live", "polite");
    renderHistory(history, request);
    host.append(history);
  }

  function render() {
    container.replaceChildren();
    container.className = "sf-panel sf-governance-workflow";
    container.setAttribute("aria-labelledby", "sf-governance-workflow-title");
    const header = document.createElement("div");
    header.className = "sf-section-header";
    header.innerHTML = '<div><p class="sf-governance-eyebrow">Change Request Workflow</p><h2 id="sf-governance-workflow-title">Persistent Governance Register</h2><p>Manage formal change requests without changing project baselines.</p></div>';
    container.append(header);

    if (!state.authenticated) {
      const signIn = document.createElement("p");
      signIn.className = "sf-governance-workflow-signin";
      signIn.textContent = "Sign in with Admin Access to create and manage persistent change requests.";
      container.append(signIn);
      return;
    }

    const adminNote = document.createElement("p");
    adminNote.className = "sf-governance-admin-note";
    adminNote.textContent = "Current prototype uses the authenticated Admin role for governance actions.";
    const feedback = document.createElement("div");
    feedback.className = "sf-governance-workflow-feedback";
    feedback.setAttribute("aria-live", "polite");
    if (state.error || state.success) {
      feedback.textContent = state.error || state.success;
      feedback.dataset.state = state.error ? "error" : "success";
    } else {
      feedback.hidden = true;
    }
    const primaryActions = document.createElement("div");
    primaryActions.className = "sf-governance-workflow-primary sf-governance-print-hide";
    const save = document.createElement("button");
    save.type = "button";
    save.disabled = state.pending || state.loading;
    save.textContent = state.editingId ? "Save Draft Changes" : "Save as Draft";
    save.addEventListener("click", state.editingId ? saveDraftChanges : saveDraft);
    primaryActions.append(save);
    if (state.editingId) {
      const indicator = document.createElement("strong");
      const cancel = document.createElement("button");
      const request = selectedRequest();
      indicator.textContent = `Editing Draft ${request?.requestId ?? ""}`;
      indicator.className = "sf-governance-editing-indicator";
      cancel.type = "button";
      cancel.textContent = "Cancel Draft Edit";
      cancel.disabled = state.pending;
      cancel.addEventListener("click", cancelEdit);
      primaryActions.append(indicator, cancel);
    }
    container.append(adminNote, feedback, primaryActions);

    if (state.loading) {
      const loading = document.createElement("p");
      loading.className = "sf-governance-workflow-loading";
      loading.setAttribute("role", "status");
      loading.textContent = "Loading change requests...";
      container.append(loading);
      return;
    }

    const controls = document.createElement("div");
    controls.className = "sf-governance-workflow-controls sf-governance-print-hide";
    const searchField = document.createElement("div");
    const searchLabel = document.createElement("label");
    const search = document.createElement("input");
    searchLabel.htmlFor = "sf-governance-request-search";
    searchLabel.textContent = "Search requests";
    search.id = searchLabel.htmlFor;
    search.type = "search";
    search.disabled = state.pending;
    search.value = state.search;
    search.placeholder = "Request or project";
    search.addEventListener("input", () => {
      const cursor = search.selectionStart ?? search.value.length;
      state.search = search.value;
      render();
      const replacement = container.querySelector("#sf-governance-request-search");
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    });
    searchField.append(searchLabel, search);
    const statusField = document.createElement("div");
    const statusLabel = document.createElement("label");
    const status = document.createElement("select");
    statusLabel.htmlFor = "sf-governance-status-filter";
    statusLabel.textContent = "Status";
    status.id = statusLabel.htmlFor;
    status.disabled = state.pending;
    ["All", ...STATUSES].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = state.status === value;
      status.append(option);
    });
    status.addEventListener("change", () => {
      state.status = status.value;
      render();
      container.querySelector("#sf-governance-status-filter")?.focus();
    });
    statusField.append(statusLabel, status);
    controls.append(searchField, statusField);

    const workspace = document.createElement("div");
    const list = document.createElement("div");
    const detail = document.createElement("article");
    workspace.className = "sf-governance-workflow-layout";
    list.className = "sf-governance-request-list sf-governance-print-hide";
    list.setAttribute("aria-label", "Change Requests");
    detail.className = "sf-governance-request-detail";
    renderRequestList(list);
    renderDetail(detail);
    workspace.append(list, detail);
    container.append(controls, workspace);
  }

  async function loadHistory(requestId, version = state.authVersion) {
    state.historyLoading = true;
    state.events = [];
    render();
    try {
      const events = await listChangeRequestEvents(requestId);
      if (version !== state.authVersion || state.selectedId !== requestId) return;
      state.events = events;
    } catch (error) {
      if (version !== state.authVersion) return;
      state.error = error?.message ?? "Activity history could not be loaded.";
    } finally {
      if (version === state.authVersion && state.selectedId === requestId) {
        state.historyLoading = false;
        render();
      }
    }
  }

  async function loadRequests(preferredId = state.selectedId) {
    const version = state.authVersion;
    state.loading = true;
    render();
    try {
      const requests = await listChangeRequests();
      if (version !== state.authVersion) return;
      state.requests = requests;
      state.selectedId = requests.some((request) => request.id === preferredId)
        ? preferredId
        : requests[0]?.id ?? null;
      const editingRequest = requests.find((request) => request.id === state.editingId);
      if (state.editingId && editingRequest?.status !== "Draft") {
        state.editingId = null;
        assessment.setProjectLocked(false);
      }
      state.error = "";
    } catch (error) {
      if (version !== state.authVersion) return;
      state.requests = [];
      state.selectedId = null;
      state.events = [];
      state.error = error?.message ?? "Change requests could not be loaded.";
    } finally {
      if (version !== state.authVersion) return;
      state.loading = false;
      render();
    }
    if (state.selectedId) await loadHistory(state.selectedId, version);
  }

  async function selectRequest(requestId) {
    if (state.selectedId === requestId && !state.historyLoading) return;
    if (state.editingId && state.editingId !== requestId) {
      state.editingId = null;
      assessment.setProjectLocked(false);
      state.success = "Draft editing cancelled.";
    }
    state.selectedId = requestId;
    state.error = "";
    await loadHistory(requestId);
  }

  async function mutate(operation, requestId, successMessage) {
    if (state.pending) throw new Error("A governance action is already in progress.");
    state.pending = true;
    state.error = "";
    state.success = "";
    render();
    try {
      const result = await operation();
      state.pending = false;
      state.success = typeof successMessage === "function"
        ? successMessage(result)
        : successMessage;
      await loadRequests(requestId ?? result?.id ?? state.selectedId);
      return result;
    } catch (error) {
      state.pending = false;
      const message = error?.message ?? "The governance action could not be completed.";
      try {
        await loadRequests(requestId ?? state.selectedId);
      } catch {
        // Preserve the original mutation error.
      }
      state.error = message;
      state.success = "";
      render();
      throw new Error(message);
    }
  }

  function validateAssessment() {
    const current = assessment.getAssessment();
    if (!current?.project) throw new Error("No project is available for a Change Request.");
    if (current.result.error) throw new Error(current.result.error);
    if (current.budgetChangeAmount === 0) {
      throw new Error("Enter a non-zero budget change before creating a Change Request.");
    }
    return current;
  }

  async function saveDraft() {
    try {
      const current = validateAssessment();
      const created = await mutate(
        () => createChangeRequest(assessmentPayload(current)),
        null,
        (request) => `${request.requestId} saved as Draft.`,
      );
      state.selectedId = created.id;
    } catch (error) {
      state.error = error?.message ?? "The Draft could not be created.";
      render();
    }
  }

  function editDraft(request) {
    if (request.status !== "Draft") return;
    if (!assessment.loadAssessment(request)) {
      state.error = "The Draft project is not available in the current portfolio data.";
      render();
      return;
    }
    state.editingId = request.id;
    assessment.setProjectLocked(true);
    state.success = `${request.requestId} loaded into the assessment.`;
    state.error = "";
    render();
  }

  async function saveDraftChanges() {
    const request = selectedRequest();
    try {
      if (!request || request.id !== state.editingId || request.status !== "Draft") {
        throw new Error("The selected Draft is no longer available for editing.");
      }
      const current = validateAssessment();
      await mutate(
        () => updateDraftChangeRequest(request.id, assessmentPayload(current)),
        request.id,
        `${request.requestId} Draft changes saved.`,
      );
      state.editingId = null;
      assessment.setProjectLocked(false);
      render();
    } catch (error) {
      state.error = error?.message ?? "Draft changes could not be saved.";
      render();
    }
  }

  function cancelEdit() {
    state.editingId = null;
    assessment.setProjectLocked(false);
    state.success = "Draft editing cancelled.";
    state.error = "";
    render();
  }

  function deleteDraft(request) {
    openWorkflowDialog({
      title: "Delete Draft",
      message: `Delete ${request.requestId}?`,
      warning: "Deleting this Draft also removes its Draft audit events. Submitted governance records cannot be deleted.",
      confirmText: "Delete Draft",
      danger: true,
      onConfirm: async () => {
        await mutate(
          () => deleteDraftChangeRequest(request.id),
          null,
          `${request.requestId} Draft deleted.`,
        );
        if (state.editingId === request.id) {
          state.editingId = null;
          assessment.setProjectLocked(false);
          render();
        }
      },
    });
  }

  async function handleAuthChange() {
    state.authVersion += 1;
    state.authenticated = isAuthenticated();
    state.requests = [];
    state.events = [];
    state.selectedId = null;
    state.editingId = null;
    state.error = "";
    state.success = "";
    assessment.setProjectLocked(false);
    render();
    if (state.authenticated) await loadRequests();
  }

  render();
  if (state.authenticated) loadRequests();

  return { handleAuthChange };
}
