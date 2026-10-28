import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "./supabase-config.js";

const SESSION_STORAGE_KEY = "steerfold_auth_session";

async function authenticationError(response, signingUp) {
  let code;
  try { const details = await response.json(); code = details?.code || details?.error_code; } catch { /* Never echo provider payloads. */ }
  const messages = {
    signup_disabled: "New account registration is currently disabled.",
    invalid_credentials: "Email or password is incorrect.",
    email_not_confirmed: "Confirm your email address before signing in.",
    user_already_exists: "An account already exists for this email. Try signing in.",
    email_exists: "An account already exists for this email. Try signing in.",
    weak_password: "Choose a stronger password and try again.",
    over_email_send_rate_limit: "Too many emails requested. Wait before trying again.",
    over_request_rate_limit: "Too many requests. Wait before trying again.",
  };
  return new Error((Object.hasOwn(messages, code) ? messages[code] : null) || (response.status === 429 ? "Too many requests. Wait before trying again."
    : signingUp ? "Sign up could not be completed. Check your details and try again."
      : "Sign in could not be completed. Check your details and try again."));
}

function saveSession(session) {
  if (
    typeof session?.access_token !== "string" ||
    session.access_token.trim() === ""
  ) {
    throw new Error("Session is missing an access token.");
  }

  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );

  return session;
}

function decodeBase64Url(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const paddedBase64 =
    base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );

  return atob(paddedBase64);
}

function isAccessTokenExpiredOrNearExpiry(session) {
  try {
    const [, payload] =
      String(session?.access_token ?? "").split(".");

    if (!payload) {
      return true;
    }

    const parsedPayload = JSON.parse(
      decodeBase64Url(payload),
    );

    const exp = parsedPayload?.exp;

    if (typeof exp !== "number") {
      return true;
    }

    const expiresAtMilliseconds = exp * 1000;
    const refreshBufferMilliseconds = 60 * 1000;

    return (
      expiresAtMilliseconds - Date.now() <=
      refreshBufferMilliseconds
    );
  } catch {
    return true;
  }
}

export async function signIn(email, password) {
  const url = new URL("/auth/v1/token", SUPABASE_URL);
  url.searchParams.set("grant_type", "password");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    throw await authenticationError(response, false);
  }

  const session = await response.json();

  return saveSession(session);
}

export async function signUp(email, password, fullName) {
  if (typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 120) {
    throw new Error("Enter your full name using at most 120 characters.");
  }
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    throw new Error("Email and password are required.");
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password, data: { full_name: fullName.trim() } }),
  });
  if (!response.ok) throw await authenticationError(response, true);
  const result = await response.json();
  const user = result.user ?? result;
  if (typeof user?.id !== "string" || !user.id) throw new Error("The signup response could not be verified.");
  // Email verification may return a user without an authenticated session.
  const session = result.access_token ? saveSession(result) : null;
  return { user, session, needsEmailVerification: !session };
}

export function getStoredSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);

    if (!session?.access_token) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function getAccessToken() {
  return getStoredSession()?.access_token ?? null;
}

export async function refreshSession() {
  const session = getStoredSession();

  if (!session?.refresh_token) {
    localStorage.removeItem(SESSION_STORAGE_KEY);

    throw new Error("No refreshable session is available.");
  }

  const url = new URL("/auth/v1/token", SUPABASE_URL);
  url.searchParams.set("grant_type", "refresh_token");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: session.refresh_token,
    }),
  });

  if (!response.ok) {
    let serverMessage =
      `Session refresh failed with status ${response.status}`;

    try {
      const errorData = await response.json();

      if (errorData?.msg) {
        serverMessage = errorData.msg;
      } else if (errorData?.error_description) {
        serverMessage = errorData.error_description;
      } else if (errorData?.message) {
        serverMessage = errorData.message;
      }
    } catch {
      // Keep default message if JSON parsing fails
    }

    localStorage.removeItem(SESSION_STORAGE_KEY);

    throw new Error(serverMessage);
  }

  const refreshedSession = await response.json();

  return saveSession(refreshedSession);
}

export async function getValidAccessToken() {
  const session = getStoredSession();

  if (!session) {
    return null;
  }

  if (!isAccessTokenExpiredOrNearExpiry(session)) {
    return session.access_token;
  }

  const refreshedSession = await refreshSession();

  return refreshedSession.access_token;
}

export function getCurrentUser() {
  return getStoredSession()?.user ?? null;
}

export function isAuthenticated() {
  const session = getStoredSession();

  return Boolean(session?.access_token);
}

export async function signOut() {
  const accessToken = getAccessToken();
  let signOutError = null;

  try {
    if (accessToken) {
      const url = new URL("/auth/v1/logout", SUPABASE_URL);
      url.searchParams.set("scope", "local");

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        signOutError = new Error(
          `Sign out failed with status ${response.status}`,
        );
      }
    }
  } catch (error) {
    signOutError =
      error instanceof Error
        ? error
        : new Error("Sign out request failed.");
  } finally {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  if (signOutError) {
    throw signOutError;
  }
}
