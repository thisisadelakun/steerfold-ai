// Deployment configuration for this demo organization, not a Steerfold default.
// Supabase remains authoritative once organization settings have been loaded.
let organizationName = "Brisk & Zip";
export const ORGANIZATION_CONFIG = Object.freeze({
  get name() { return organizationName; },
  get shortName() { return organizationName; },
  currencyCode: "CAD",
});

export function acceptOrganizationName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    throw new Error("The organization name is invalid.");
  }
  organizationName = name.trim();
}
