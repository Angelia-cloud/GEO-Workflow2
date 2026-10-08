import { apiFetch } from "../../api/client";

/**
 * Workspace sign-in. Team accounts come from the backend (`team_members` table); the chosen account
 * is remembered for the browser session and recorded as the reviewer on every decision.
 */
const ACCOUNT_KEY = "komosion.geo.account.v3";
export const DEFAULT_ACCOUNT = { id: "vy-huynh", name: "Vy Huynh", role: "Team member", initials: "VH" };

export async function loadTeam() {
  try {
    const team = await apiFetch("/api/team");
    return team.length ? team : [DEFAULT_ACCOUNT];
  } catch {
    return [DEFAULT_ACCOUNT];
  }
}

export function restoreAccount() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) || "null");
    return saved && typeof saved.name == "string" ? saved : null;
  } catch {
    return null;
  }
}

export function rememberAccount(account) {
  try {
    if (account) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else sessionStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* storage unavailable: the session lasts until the page closes */
  }
}

export const initialsOf = (account) =>
  account?.initials || String(account?.name || "").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
