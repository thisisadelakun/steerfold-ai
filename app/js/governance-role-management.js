import { APP_CONFIG } from "./app-config.js";
import {
  listGovernanceUsers,
  listGovernanceRoleAssignments,
  assignGovernanceRole,
  revokeGovernanceRole,
} from "./governance-role-service.js";

const ROLES = {
  requester: "Requester",
  reviewer: "Reviewer",
  approver: "Approver",
  baseline_controller: "Baseline Controller",
  governance_admin: "Governance Admin",
};
const authorizationFailure = (message) => /Governance Admin role is required|Sign in|session|Authentication is required/i.test(message);

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function date(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat(APP_CONFIG.portfolio.locale, { dateStyle: "medium" }).format(parsed)
    : "\u2014";
}

export function initGovernanceRoleManagement({ openDialog, onSelfRolesChanged, onAuthorizationError }) {
  const root = node("section", null, "sf-governance-access sf-governance-print-hide");
  root.setAttribute("aria-labelledby", "sf-governance-access-title");
  root.hidden = true;
  const state = {
    enabled: false, suspended: false, userId: null, users: [], assignments: [],
    loaded: false, loading: false, pending: false, loadBlocked: false,
    search: "", error: "", success: "", version: 0,
  };
  let activeDialog = null;

  function clear() {
    state.version += 1;
    state.enabled = false;
    state.suspended = false;
    state.users = [];
    state.assignments = [];
    state.loaded = false;
    state.loading = false;
    state.pending = false;
    state.loadBlocked = false;
    state.search = "";
    state.error = "";
    state.success = "";
    activeDialog?.close();
    activeDialog = null;
    root.replaceChildren();
    root.hidden = true;
    root.remove();
  }

  function focusUser(userId) {
    if (!state.enabled || state.suspended) return;
    [...root.querySelectorAll("[data-role-user]")]
      .find((row) => row.dataset.roleUser === userId)?.focus();
  }

  async function loadDirectory() {
    if (!state.enabled || state.suspended || state.loading || state.pending) return;
    const version = state.version;
    state.loading = true;
    state.loadBlocked = false;
    state.error = "";
    render();
    try {
      const [users, assignments] = await Promise.all([
        listGovernanceUsers(), listGovernanceRoleAssignments(),
      ]);
      if (version !== state.version) return;
      state.users = users;
      state.assignments = assignments;
      state.loaded = true;
    } catch (error) {
      if (version !== state.version) return;
      const message = error?.message ?? "Governance access data could not be loaded.";
      if (authorizationFailure(message)) {
        clear();
        state.loadBlocked = true;
        state.error = message;
        await onAuthorizationError(message);
        return;
      }
      state.users = [];
      state.assignments = [];
      state.loaded = false;
      state.error = message;
    } finally {
      if (version === state.version) {
        state.loading = false;
        render();
      }
    }
  }

  async function changeRole(user, role, remove) {
    if (!state.enabled || state.suspended || state.pending || state.loading) {
      throw new Error("Governance role management is not currently available.");
    }
    const version = state.version;
    let completed = false;
    state.pending = true;
    state.error = "";
    state.success = "";
    render();
    const identity = user.email || "this user";
    const success = `${ROLES[role]} ${remove ? "removed from" : "assigned to"} ${identity}.`;
    try {
      if (remove) await revokeGovernanceRole(user.userId, role);
      else await assignGovernanceRole(user.userId, role);
      completed = true;
      if (version !== state.version) return;
      if (user.userId === state.userId) await onSelfRolesChanged(success);
      if (version !== state.version || !state.enabled) return;
      const assignments = await listGovernanceRoleAssignments();
      if (version !== state.version) return;
      state.assignments = assignments;
      state.success = success;
    } catch (error) {
      if (version !== state.version) return;
      const message = error?.message ?? "The governance role change could not be completed.";
      if (authorizationFailure(message)) {
        clear();
        state.loadBlocked = true;
        state.error = completed ? `${success} ${message}` : message;
        await onAuthorizationError(state.error);
        return;
      }
      // Refresh authoritative assignments after a rejection, including last-admin protection.
      if (!completed) {
        try {
          const assignments = await listGovernanceRoleAssignments();
          if (version !== state.version) return;
          state.assignments = assignments;
        } catch (refreshError) {
          if (version !== state.version) return;
          if (authorizationFailure(refreshError?.message || "")) {
            clear();
            state.loadBlocked = true;
            state.error = refreshError.message;
            await onAuthorizationError(refreshError.message);
            return;
          }
        }
      }
      const failure = new Error(completed
        ? `${success} The latest role assignments could not be refreshed.`
        : message);
      failure.preventRetry = completed;
      if (completed) state.loaded = false;
      state.error = failure.message;
      throw failure;
    } finally {
      if (version === state.version) {
        state.pending = false;
        render();
        if (!remove) focusUser(user.userId);
      }
    }
  }

  function confirmRemoval(user, role) {
    if (!state.enabled || state.suspended || state.pending) return;
    activeDialog = openDialog({
      title: "Remove Governance Role",
      message: "This removes the selected governance responsibility from this user.",
      details: [["User", user.email || "Email unavailable"], ["Role", ROLES[role]]],
      warning: role === "governance_admin"
        ? "Removing Governance Admin may prevent this user from managing role assignments. The final Governance Admin cannot be removed."
        : null,
      confirmText: "Remove Role",
      pendingText: "Removing role...",
      danger: true,
      onConfirm: () => changeRole(user, role, true),
      onClose: () => { activeDialog = null; focusUser(user.userId); },
    });
  }

  function render() {
    root.replaceChildren();
    root.hidden = !state.enabled || state.suspended;
    if (!state.enabled) return;
    const title = node("h3", "Governance Access Management");
    title.id = "sf-governance-access-title";
    root.append(title,
      node("p", "Assign governance responsibilities to authenticated users.", "sf-governance-access-note"),
      node("p", "Governance Admin manages role assignments only. It does not automatically grant workflow authority.", "sf-governance-access-note"));
    const feedback = node("p", state.error || state.success || (state.pending ? "Updating governance roles..." : ""), "sf-governance-workflow-feedback");
    feedback.dataset.state = state.error ? "error" : "success";
    feedback.setAttribute("role", state.error ? "alert" : "status");
    feedback.hidden = !feedback.textContent;
    root.append(feedback);
    if (state.loading) {
      const loading = node("p", "Loading user directory and role assignments...", "sf-governance-access-note");
      loading.setAttribute("role", "status");
      root.append(loading);
      return;
    }
    if (!state.loaded) {
      const retry = node("button", "Retry loading", "sf-governance-permissions-retry");
      retry.type = "button";
      retry.addEventListener("click", loadDirectory);
      root.append(retry);
      return;
    }
    const field = node("div", null, "sf-governance-access-search");
    const label = node("label", "Search users");
    const search = node("input");
    search.id = "sf-governance-access-search";
    label.htmlFor = search.id;
    search.type = "search";
    search.value = state.search;
    search.placeholder = "Email";
    search.disabled = state.pending;
    search.addEventListener("input", () => {
      const cursor = search.selectionStart;
      state.search = search.value;
      render();
      const replacement = root.querySelector("input[type=search]");
      replacement.focus();
      if (cursor != null) replacement.setSelectionRange(cursor, cursor);
    });
    field.append(label, search);
    root.append(field);
    const query = state.search.trim().toLocaleLowerCase(APP_CONFIG.portfolio.locale);
    const users = state.users.filter((user) => !query || (user.email || "").toLocaleLowerCase(APP_CONFIG.portfolio.locale).includes(query));
    if (!users.length) {
      root.append(node("p", state.users.length ? "No users match the current search." : "No authenticated users are available.", "sf-governance-access-note"));
      return;
    }
    const list = node("div", null, "sf-governance-access-users");
    users.forEach((user, index) => {
      const row = node("article", null, "sf-governance-access-user");
      row.dataset.roleUser = user.userId;
      row.tabIndex = -1;
      const identity = node("div", null, "sf-governance-access-identity");
      identity.append(node("strong", user.email || "Email unavailable"));
      if (user.userId === state.userId) identity.append(node("span", "You", "sf-governance-access-you"));
      identity.append(node("small", `Created ${date(user.createdAt)}`));
      const assigned = new Set(state.assignments.filter((assignment) => assignment.userId === user.userId).map((assignment) => assignment.role));
      const roles = node("ul", null, "sf-governance-access-roles");
      Object.entries(ROLES).filter(([role]) => assigned.has(role)).forEach(([role, name]) => {
        const item = node("li");
        const remove = node("button", "Remove");
        remove.type = "button";
        remove.disabled = state.pending;
        remove.setAttribute("aria-label", `Remove ${name} from ${user.email || "user without email"}`);
        remove.addEventListener("click", () => confirmRemoval(user, role));
        item.append(node("span", name), remove);
        roles.append(item);
      });
      const roleArea = node("div");
      roleArea.append(assigned.size ? roles : node("p", "No governance roles assigned.", "sf-governance-access-note"));
      const available = Object.entries(ROLES).filter(([role]) => !assigned.has(role));
      const addArea = node("div", null, "sf-governance-access-add");
      if (available.length) {
        const selectLabel = node("label", "Add governance role");
        const select = node("select");
        select.id = `sf-governance-add-role-${index}`;
        selectLabel.htmlFor = select.id;
        select.disabled = state.pending;
        available.forEach(([role, name]) => {
          const option = node("option", name);
          option.value = role;
          select.append(option);
        });
        const add = node("button", "Add Role");
        add.type = "button";
        add.disabled = state.pending;
        add.setAttribute("aria-label", `Add governance role to ${user.email || "user without email"}`);
        add.addEventListener("click", () => {
          changeRole(user, select.value, false).catch(() => {});
        });
        addArea.append(selectLabel, select, add);
      } else addArea.append(node("p", "All governance roles assigned.", "sf-governance-access-note"));
      row.append(identity, roleArea, addArea);
      list.append(row);
    });
    root.append(list);
  }

  return {
    element: root,
    setAccess({ enabled, resolving, userId }) {
      if (state.userId !== userId) { clear(); state.userId = userId; }
      if (resolving) {
        state.suspended = true;
        root.hidden = true;
        return;
      }
      if (!enabled) { clear(); return; }
      state.suspended = false;
      const newlyEnabled = !state.enabled;
      state.enabled = true;
      root.hidden = false;
      if (newlyEnabled) {
        if (state.loadBlocked) render();
        else loadDirectory();
      }
    },
  };
}
