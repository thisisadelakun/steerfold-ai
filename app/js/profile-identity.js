let identity = null;

export function setProfileIdentity(userId, fullName) {
  identity = userId ? { userId, fullName: typeof fullName === "string" ? fullName : "" } : null;
}

function nameParts(user) {
  return identity && user && identity.userId === user.id
    ? identity.fullName.trim().split(/\s+/).filter(Boolean) : [];
}

export function profileDisplayName(user) {
  return nameParts(user)[0] || "Account";
}

export function profileInitials(user) {
  const parts = nameParts(user);
  if (parts.length) {
    const initials = `${[...parts[0]][0]}${parts.length > 1 ? [...parts.at(-1)][0] : ""}`;
    return [...initials.toLocaleUpperCase()].slice(0, 2).join("");
  }
  return "?";
}
