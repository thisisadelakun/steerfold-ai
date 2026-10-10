import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "./supabase-config.js";
import { getValidAccessToken } from "./auth-service.js";

const ROLES = new Set([
  "requester",
  "reviewer",
  "approver",
  "baseline_controller",
  "governance_admin",
]);

function validateAssignment(userId, role) {
  if (!ROLES.has(role)) throw new Error("Unsupported governance role.");
  if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("A valid target user ID is required.");
  }
}

function normalizeAssignment(row) {
  if (!row || !ROLES.has(row.role)) {
    throw new Error("The role service returned an invalid assignment.");
  }
  return {
    userId: row.user_id,
    email: row.email ?? null,
    role: row.role,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by ?? null,
  };
}

async function errorMessage(response, fallback) {
  if (response.status === 401) {
    return "Your authentication session has expired. Sign in again before continuing.";
  }

  try {
    const error = await response.json();
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.includes("Authentication is required")) {
      return "Sign in to access governance roles.";
    }
    if (message.includes("Governance Admin role is required")) {
      return "Governance Admin role is required to manage role assignments.";
    }
    if (message.includes("Target auth user not found") || error?.code === "23503") {
      return "The target user could not be found.";
    }
    if (message.includes("Unsupported governance role")) {
      return "Unsupported governance role.";
    }
    if (message.includes("Role assignment not found")) {
      return "The specified role assignment no longer exists.";
    }
    if (message.includes("At least one Governance Admin must remain assigned")) {
      return "At least one Governance Admin must remain assigned.";
    }
    if (error?.code === "23505") return "This role is already assigned to the user.";
  } catch {
    // Unknown server responses use the concise operation-specific fallback.
  }

  return fallback;
}

async function callRpc(name, body, fallback) {
  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch {
    throw new Error("Your session could not be validated. Sign in again before continuing.");
  }
  if (!accessToken) throw new Error("Sign in to access governance roles.");

  const url = new URL(`/rest/v1/rpc/${name}`, SUPABASE_URL);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`${fallback} Check your network connection.`);
  }

  if (!response.ok) throw new Error(await errorMessage(response, fallback));
  try {
    return await response.json();
  } catch {
    throw new Error("The role service returned an unreadable response. Check the current assignments before repeating a role change.");
  }
}

export async function getMyGovernanceRoles() {
  const rows = await callRpc("get_my_governance_roles", {}, "Your governance roles could not be loaded.");
  if (!Array.isArray(rows)) throw new Error("Your governance roles could not be loaded.");
  return rows.map((row) => {
    if (!ROLES.has(row.role)) throw new Error("The role service returned an unsupported role.");
    return { role: row.role, assignedAt: row.assigned_at };
  });
}

export async function listGovernanceRoleAssignments() {
  const rows = await callRpc("list_governance_role_assignments", {}, "Governance role assignments could not be loaded.");
  if (!Array.isArray(rows)) throw new Error("Governance role assignments could not be loaded.");
  return rows.map(normalizeAssignment);
}

export async function assignGovernanceRole(userId, role) {
  validateAssignment(userId, role);
  const result = await callRpc("assign_governance_role", {
    p_user_id: userId,
    p_role: role,
  }, "The governance role could not be assigned.");
  return normalizeAssignment(Array.isArray(result) ? result[0] : result);
}

export async function revokeGovernanceRole(userId, role) {
  validateAssignment(userId, role);
  const result = await callRpc("revoke_governance_role", {
    p_user_id: userId,
    p_role: role,
  }, "The governance role could not be revoked.");
  if (result !== true) throw new Error("The governance role revocation could not be confirmed.");
  return true;
}
