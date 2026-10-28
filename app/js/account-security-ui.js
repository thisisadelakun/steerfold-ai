import { getCurrentUser, isAuthenticated, signOut } from "./auth-service.js";
import { requestPasswordVerification, updateAccountPassword } from "./account-security-service.js";

export function initAccountSecurity() {
  const form = document.querySelector("[data-account-password]");
  const status = document.querySelector("[data-account-security-status]");
  const signOutButton = document.querySelector("[data-account-sign-out]");
  let busy = false;
  let uncertain = false;
  let generation = 0;
  function render() {
    form.querySelectorAll("input, button").forEach((control) => { control.disabled = busy || uncertain || !isAuthenticated(); });
    signOutButton.disabled = busy || !isAuthenticated();
    form.setAttribute("aria-busy", String(busy));
  }
  async function run(operation, success) {
    if (busy || uncertain || !isAuthenticated()) return;
    const token = generation;
    const actor = getCurrentUser()?.id;
    busy = true; status.textContent = "Working..."; render();
    try {
      await operation();
      if (token === generation && actor === getCurrentUser()?.id) status.textContent = success;
    } catch (error) {
      if (token === generation) { status.textContent = error.message; uncertain = error.uncertain === true; }
    } finally {
      if (token === generation) {
        form.reset(); busy = false; render();
        if (!isAuthenticated()) window.dispatchEvent(new CustomEvent("auth:changed"));
      }
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmation.value;
    const nonce = form.elements.nonce.value;
    run(() => updateAccountPassword(password, confirmation, nonce), "Your password was updated.");
  });
  document.querySelector("[data-account-reauthenticate]").addEventListener("click", () => {
    run(requestPasswordVerification, "Verification code sent to your account email or phone. Enter it with your new password.");
  });
  document.querySelector("[data-account-sign-in]").addEventListener("click", (event) => {
    // Do not let this forwarded click trigger the auth panel's outside-click close.
    event.stopPropagation();
    if (!isAuthenticated()) document.querySelector("[data-auth-launcher]")?.click();
  });
  signOutButton.addEventListener("click", async () => {
    if (busy || !isAuthenticated()) return;
    busy = true; render();
    let message = "Signed out.";
    try { await signOut(); } catch { message = "Signed out locally. Server sign-out could not be confirmed."; }
    finally {
      busy = false;
      window.dispatchEvent(new CustomEvent("auth:changed", { detail: { message } }));
      document.querySelector("[data-account-session-status]").textContent = message;
    }
  });
  window.addEventListener("auth:changed", () => {
    generation++; busy = false; uncertain = false; form.reset(); status.textContent = "";
    document.querySelector("[data-account-session-status]").textContent = "";
    render();
  });
  render();
}
