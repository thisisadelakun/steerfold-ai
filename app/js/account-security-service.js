import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getCurrentUser, getValidAccessToken } from "./auth-service.js";

async function securityRequest(path, method, body) {
  const actor = getCurrentUser()?.id;
  const token = await getValidAccessToken();
  if (!actor || !token || actor !== getCurrentUser()?.id) throw new Error("Sign in again before managing account security.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method, signal: controller.signal,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      let code;
      try { const error = await response.json(); code = error.code || error.error_code; } catch { /* Do not echo provider payloads or password content. */ }
      const messages = {
        reauthentication_needed: "Request a verification code and enter it before updating your password.",
        reauthentication_not_valid: "The verification code is invalid or expired. Request a new code.",
        weak_password: "Choose a stronger password that meets the account provider's requirements.",
        same_password: "Choose a password different from your current password.",
      };
      if (response.status >= 500) throw Object.assign(new Error("The security request could not be confirmed. Sign out and sign in again before retrying."), { uncertain: true });
      throw new Error(messages[code] || (response.status === 429 ? "Too many requests. Wait before trying again."
        : response.status === 401 ? "Your session could not be verified. Sign in again."
          : "The account provider could not complete this security request."));
    }
    if (path === "user") {
      let user;
      try { user = await response.json(); } catch {
        throw Object.assign(new Error("The password change could not be confirmed. Sign out and sign in again before retrying."), { uncertain: true });
      }
      if (user?.id !== actor) throw Object.assign(new Error("The password change response could not be verified. Sign in again."), { uncertain: true });
    }
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw Object.assign(new Error("The security request could not be confirmed. Sign out and sign in again before retrying."), { uncertain: true });
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

export function requestPasswordVerification() {
  // Matches Supabase Auth's authenticated reauthenticate endpoint (no redirect).
  return securityRequest("reauthenticate", "GET");
}

export function updateAccountPassword(password, confirmation, nonce = "") {
  if (typeof password !== "string" || password.length < 8 || password !== confirmation) {
    throw new Error("Use at least 8 characters and enter the same password in both fields.");
  }
  if (typeof nonce !== "string") throw new Error("Enter a valid verification code.");
  return securityRequest("user", "PUT", { password, ...(nonce.trim() ? { nonce: nonce.trim() } : {}) });
}
