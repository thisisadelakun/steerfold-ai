import { getCurrentUser, isAuthenticated } from "./auth-service.js";
import { ORGANIZATION_CONFIG, acceptOrganizationName } from "./organization-config.js";
import { loadOrganizationProfile, saveOrganizationProfile, loadPersonalProfile, savePersonalProfile } from "./profile-service.js";
import { setProfileIdentity, profileInitials, profileDisplayName } from "./profile-identity.js";

export function initProfileSettings() {
  const company = document.querySelector("[data-company-profile]");
  const personal = document.querySelector("[data-personal-profile]");
  let admin = false;
  let generation = 0;
  const companyState = { row: null, busy: false, message: "" };
  const personalState = { row: null, busy: false, message: "" };

  function identity() {
    const user = isAuthenticated() ? getCurrentUser() : null;
    document.querySelector("[data-profile-avatar]").textContent = profileInitials(user);
    document.querySelector("[data-profile-identity]").textContent = profileDisplayName(user);
    document.querySelector("[data-profile-email]").value = user?.email || "";
    document.querySelector("[data-account-content]").hidden = !user;
    document.querySelector("[data-account-guest]").hidden = Boolean(user);
  }

  function render() {
    for (const [form, state, allowed] of [[company, companyState, admin], [personal, personalState, isAuthenticated()]]) {
      form.querySelectorAll("input:not([readonly]), button[type=submit]").forEach((control) => {
        control.disabled = state.busy || !state.row || !allowed;
      });
      form.querySelector("[data-profile-reload]").disabled = state.busy;
      form.querySelector("[data-profile-status]").textContent = state.message;
      form.setAttribute("aria-busy", String(state.busy));
    }
    identity();
  }

  function setCompany(row) {
    companyState.row = row;
    company.elements.organizationName.value = row.name;
    company.elements.industry.value = row.industry;
    acceptOrganizationName(row.name);
    window.dispatchEvent(new CustomEvent("organization:profile-changed"));
  }

  function setPersonal(row) {
    personalState.row = row;
    personal.elements.fullName.value = row.fullName;
    personal.elements.jobTitle.value = row.jobTitle;
    setProfileIdentity(getCurrentUser()?.id, row.fullName);
    identity();
    window.dispatchEvent(new CustomEvent("profile:identity-changed"));
  }

  async function reload(form, state, load, accept, token) {
    state.busy = true; state.row = null; state.message = "Loading profile..."; render();
    try {
      const row = await load();
      if (token !== generation) return;
      accept(row);
      state.message = form === company && !admin ? "Only a Governance Admin can edit company details." : "";
    } catch (error) {
      if (token === generation) state.message = error.message;
    } finally {
      if (token === generation) { state.busy = false; render(); }
    }
  }

  function reloadPersonal() {
    if (!isAuthenticated() || personalState.busy) return;
    return reload(personal, personalState, loadPersonalProfile, setPersonal, generation);
  }

  for (const [form, state, save, accept] of [
    [company, companyState, saveOrganizationProfile, setCompany],
    [personal, personalState, savePersonalProfile, setPersonal],
  ]) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy || !state.row || !isAuthenticated() || (form === company && !admin)) return;
      if (!form.reportValidity()) return;
      const token = generation;
      const data = form === company
        ? { name: form.elements.organizationName.value, industry: form.elements.industry.value }
        : { fullName: form.elements.fullName.value, jobTitle: form.elements.jobTitle.value };
      state.busy = true; state.message = "Saving..."; render();
      try {
        const row = await save({ ...data, updatedAt: state.row.updatedAt });
        if (token !== generation) return;
        accept(row); state.message = "Profile saved.";
      } catch (error) {
        if (token === generation) {
          state.message = error.message;
          // Unknown write outcomes must be verified by a read, not an automatic retry.
          state.row = null;
        }
      } finally {
        if (token === generation) { state.busy = false; render(); }
      }
    });
  }
  company.querySelector("[data-profile-reload]").addEventListener("click", () => {
    if (!companyState.busy) reload(company, companyState, loadOrganizationProfile, setCompany, generation);
  });
  personal.querySelector("[data-profile-reload]").addEventListener("click", reloadPersonal);

  function authChanged() {
    generation++; admin = false;
    setProfileIdentity(null);
    window.dispatchEvent(new CustomEvent("profile:identity-changed"));
    personalState.row = null; personalState.busy = false;
    personal.elements.fullName.value = ""; personal.elements.jobTitle.value = "";
    personalState.message = "Sign in to manage your profile.";
    // Invalidate any result belonging to a previous signed-in actor.
    companyState.busy = false;
    render();
    reload(company, companyState, loadOrganizationProfile, setCompany, generation);
    reloadPersonal();
  }
  company.elements.organizationName.value = ORGANIZATION_CONFIG.name;
  window.addEventListener("auth:changed", authChanged);
  window.addEventListener("workspace:changed", () => {
    generation++;
    admin = false;
    companyState.busy = false;
    companyState.row = null;
    personalState.busy = false;
    render();
    reload(company, companyState, loadOrganizationProfile, setCompany, generation);
    if (!personalState.row) reloadPersonal();
  });
  authChanged();
  return {
    setAdmin(value) {
      admin = value === true;
      if (companyState.row && !companyState.busy) {
        companyState.message = admin ? "" : "Only a Governance Admin can edit company details.";
      }
      render();
    },
  };
}
