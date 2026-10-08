const fmtDay = (A) =>
    A
      ? new Date(A).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
        })
      : "\u2013",
  fmtDateTime = (A) =>
    A
      ? new Date(A).toLocaleString("en-AU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "\u2013",
  shortPropertyName = (A) => (A?.includes("Coogee") ? "Coogee" : A || "your property"),
  workspaceSettings = new Map();
export { fmtDay, fmtDateTime, shortPropertyName };
function setWorkspaceSetting(A, e) {
  workspaceSettings.set(A, e);
}
export { setWorkspaceSetting };
