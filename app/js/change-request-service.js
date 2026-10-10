import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "./supabase-config.js";

import { getValidAccessToken } from "./auth-service.js";

function nullableNumber(value) {
  return value === null || value === undefined
    ? null
    : Number(value);
}

function normalizeChangeRequest(row) {
  if (!row) return null;

  return {
    id: row.id,
    requestId: row.request_id,
    projectId: row.project_id,
    projectCode: row.project_code,
    originalBac: Number(row.original_bac),
    budgetChangeAmount: Number(row.budget_change_amount),
    proposedBac: Number(row.proposed_bac),
    changeType: row.change_type,
    changeSummary: row.change_summary,
    impactScope: row.impact_scope,
    impactSchedule: row.impact_schedule,
    impactCost: row.impact_cost,
    impactQuality: row.impact_quality,
    impactResources: row.impact_resources,
    impactRisk: row.impact_risk,
    impactStakeholders: row.impact_stakeholders,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    appliedBacBefore: nullableNumber(row.applied_bac_before),
    appliedBacAfter: nullableNumber(row.applied_bac_after),
    applicationNote: row.application_note,
  };
}

function normalizeChangeRequestEvent(row) {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

function mapRequestInput(data) {
  return {
    p_budget_change_amount: data.budgetChangeAmount,
    p_change_type: data.changeType,
    p_change_summary: data.changeSummary || null,
    p_impact_scope: data.impactScope ?? "None",
    p_impact_schedule: data.impactSchedule ?? "None",
    p_impact_cost: data.impactCost ?? "None",
    p_impact_quality: data.impactQuality ?? "None",
    p_impact_resources: data.impactResources ?? "None",
    p_impact_risk: data.impactRisk ?? "None",
    p_impact_stakeholders: data.impactStakeholders ?? "None",
  };
}

async function getErrorMessage(response, fallbackMessage) {
  if (response.status === 401) {
    return "Your authentication session has expired. Sign in again before continuing.";
  }

  try {
    const error = await response.json();
    const serverText = [error?.message, error?.details]
      .filter(Boolean)
      .join(" ");

    if (error?.code === "23503") {
      return "The selected project is no longer available.";
    }

    if (
      serverText.includes("change_requests_proposed_bac_positive") ||
      serverText.includes("change_requests_budget_balance")
    ) {
      return "The proposed budget must be greater than 0 and equal the original budget plus the requested change.";
    }

    if (serverText.includes("Project budget baseline has changed")) {
      return "Application blocked because the project's current budget baseline no longer matches the baseline captured by this Change Request.";
    }

    if (serverText.includes("Change Request has already been applied")) {
      return "This Change Request has already been applied to the project budget baseline.";
    }

    if (serverText.includes("Only an Approved Change Request can be applied")) {
      return "Application blocked because this Change Request is no longer Approved.";
    }

    if (
      serverText.includes("proposed budget is invalid") ||
      serverText.includes("budget change amount must be non-zero")
    ) {
      return "Application blocked because the approved budget values are no longer valid.";
    }

    const details = [
      error?.message,
      error?.details,
      error?.hint,
      error?.error_description,
    ].filter(Boolean);

    if (details.length > 0) return details.join(" ");
  } catch {
    // Use the context-specific fallback when the response is not JSON.
  }

  return fallbackMessage;
}

async function getAuthenticatedHeaders() {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error(
      "Authentication is required to access persistent change requests.",
    );
  }

  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function callRpc(functionName, body, fallbackMessage) {
  const url = new URL(`/rest/v1/rpc/${functionName}`, SUPABASE_URL);
  const headers = await getAuthenticatedHeaders();
  let response;

  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`${fallbackMessage} Check your network connection.`);
  }

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, fallbackMessage));
  }

  if (response.status === 204) return null;
  return response.json();
}

function getReturnedRecord(payload) {
  return Array.isArray(payload) ? payload[0] ?? null : payload;
}

async function readRows(url, fallbackMessage) {
  const headers = await getAuthenticatedHeaders();
  let response;

  try {
    response = await fetch(url.toString(), {
      headers,
    });
  } catch {
    throw new Error(`${fallbackMessage} Check your network connection.`);
  }

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, fallbackMessage));
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export async function listChangeRequests({
  projectId,
  status,
} = {}) {
  const url = new URL("/rest/v1/change_requests", SUPABASE_URL);
  url.searchParams.set("select", "*");
  url.searchParams.set("order", "created_at.desc");
  if (projectId) url.searchParams.set("project_id", `eq.${projectId}`);
  if (status) url.searchParams.set("status", `eq.${status}`);

  const rows = await readRows(
    url,
    "Change requests could not be loaded.",
  );
  return rows.map(normalizeChangeRequest);
}

export async function getChangeRequest(changeRequestId) {
  const url = new URL("/rest/v1/change_requests", SUPABASE_URL);
  url.searchParams.set("select", "*");
  url.searchParams.set("id", `eq.${changeRequestId}`);
  url.searchParams.set("limit", "1");

  const rows = await readRows(
    url,
    "The change request could not be loaded.",
  );
  return normalizeChangeRequest(rows[0]);
}

export async function createChangeRequest(data) {
  const projectCode = data?.projectCode ?? data?.projectId;

  if (!projectCode) {
    throw new Error("A valid project is required to create a change request.");
  }

  const payload = await callRpc(
    "create_change_request",
    {
      p_project_code: projectCode,
      ...mapRequestInput(data),
    },
    "The change request could not be created.",
  );

  return normalizeChangeRequest(getReturnedRecord(payload));
}

export async function updateDraftChangeRequest(changeRequestId, data) {
  const payload = await callRpc(
    "update_draft_change_request",
    {
      p_change_request_id: changeRequestId,
      ...mapRequestInput(data),
    },
    "The Draft change request could not be updated.",
  );

  return normalizeChangeRequest(getReturnedRecord(payload));
}

export async function transitionChangeRequestStatus(
  changeRequestId,
  newStatus,
  note = null,
) {
  const payload = await callRpc(
    "transition_change_request_status",
    {
      p_change_request_id: changeRequestId,
      p_new_status: newStatus,
      p_note: note || null,
    },
    "The change request status could not be updated.",
  );

  return normalizeChangeRequest(getReturnedRecord(payload));
}

export async function applyApprovedChangeRequest(
  changeRequestId,
  applicationNote = null,
) {
  const payload = await callRpc(
    "apply_approved_change_request",
    {
      p_change_request_id: changeRequestId,
      p_application_note: applicationNote || null,
    },
    "The approved budget change could not be applied.",
  );

  return normalizeChangeRequest(getReturnedRecord(payload));
}

export async function deleteDraftChangeRequest(changeRequestId) {
  const deleted = await callRpc(
    "delete_draft_change_request",
    { p_change_request_id: changeRequestId },
    "The Draft change request could not be deleted.",
  );

  return deleted === true;
}

export async function listChangeRequestEvents(changeRequestId) {
  const url = new URL("/rest/v1/change_request_events", SUPABASE_URL);
  url.searchParams.set("select", "*");
  url.searchParams.set("change_request_id", `eq.${changeRequestId}`);
  url.searchParams.set("order", "created_at.asc");

  const rows = await readRows(
    url,
    "Change request history could not be loaded.",
  );
  return rows.map(normalizeChangeRequestEvent);
}
