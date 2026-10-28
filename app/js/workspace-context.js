let active = null;
let revision = 0;

export function getActiveWorkspace() { return active; }
export function getWorkspaceRevision() { return revision; }
export function setActiveWorkspace(workspace) {
  active = workspace ? Object.freeze({ ...workspace }) : null;
  revision++;
  return active;
}
export function assertWorkspaceCurrent(workspace) {
  if (!workspace || workspace !== active) {
    throw new Error("Workspace changed. Reopen this action in the intended workspace.");
  }
}
export function workspaceHeaders() {
  if (!active) throw new Error("Choose a workspace before accessing portfolio data.");
  return { "x-steerfold-organization-id": active.id };
}
export function isDemoWorkspace() { return active?.isDemo === true; }
export function canWriteWorkspace() { return active?.canWrite === true; }
export function requireWritableWorkspace() {
  if (!canWriteWorkspace()) throw new Error("This workspace is read-only or unavailable.");
  return active;
}
