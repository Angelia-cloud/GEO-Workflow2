import { createElement } from "react";
import { belongsToClient } from "../clients/clients";
const EXPORTABLE_STATUSES = new Set(["Generated", "Edited", "Approved"]);
function exportablePrompts(A) {
  return !A || A.type !== "sheet" || !Array.isArray(A.prompts)
    ? []
    : A.prompts
        .filter(
          (e) =>
            e &&
            typeof e == "object" &&
            EXPORTABLE_STATUSES.has(e.status) &&
            String(e.text || e.prompt || "").trim(),
        )
        .map((e) => ({
          client: A.client,
          engine: e.engine || e.engineName || (A.engines?.length === 1 ? A.engines[0] : "Not recorded"),
          intent: e.intent || "",
          audience: e.audience || "",
          prompt: e.text || e.prompt,
          status: e.status,
          reviewer: (e.status === "Approved" && (e.reviewer || A.reviewedBy)) || "",
          reviewedAt: (e.status === "Approved" && (e.reviewedAt || A.createdAt)) || "",
          sample: !!A.sample,
        }));
}
function csvField(A) {
  let e = String(A ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(e) || /^[\t\r\n]/.test(e)) {
    e = `'${e}`;
  }
  return `"${e.replaceAll('"', '""')}"`;
}
function promptsCsv(A) {
  const e = exportablePrompts(A);
  return (
    "\uFEFF" +
    [
      [
        "Client",
        "AI engine",
        "Intent",
        "Audience",
        "Prompt",
        "Status",
        "Reviewed by",
        "Reviewed at",
        "Data type",
      ],
      ...e.map((t) => [
        t.client,
        t.engine,
        t.intent,
        t.audience,
        t.prompt,
        t.status,
        t.reviewer,
        t.reviewedAt,
        (t.status === "Approved" ? "Reviewed" : t.status) + (t.sample ? " example prompts" : " prompts"),
      ]),
    ].map((t) => t.map(csvField).join(",")).join(`\r
`)
  );
}
function PromptExports({ entries = [], selectedClient, onStartWorkflow }) {
  const i = selectedClient
    ? entries.filter((o) => belongsToClient(o, selectedClient) && exportablePrompts(o).length)
    : [];
  function n(o) {
    const a = URL.createObjectURL(
        new Blob([promptsCsv(o)], {
          type: "text/csv;charset=utf-8",
        }),
      ),
      r = document.createElement("a");
    r.href = a;
    r.download = `Komosion-Prompts-${String(selectedClient?.name || "client").replace(/[^a-z0-9_-]/gi, "-")}-${String(o.createdAt || "").slice(0, 10)}.csv`;
    r.click();
    setTimeout(() => URL.revokeObjectURL(a), 1e3);
  }
  return (
    <section className="prompt-exports" aria-label="Prompt CSV exports">
      <header className="pe-heading">
        <span className="guided-eyebrow">Prompt</span>
        <h1>CSV exports</h1>
        <p>
          {"Download your saved prompts for "}
          {selectedClient?.name || "your selected client"}.
        </p>
      </header>
      {i.length ? (
        i.map((o) => {
          const a = exportablePrompts(o);
          return (
            <article className="pe-record" key={o.id}>
              <div className="pe-record-head">
                <div>
                  <h2>{o.title || "Generated prompt set"}</h2>
                  <p>
                    {"Saved "}
                    {new Date(o.createdAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {" \xB7 "}
                    {o.reviewedBy || o.createdBy}
                  </p>
                </div>
                <button className="guided-primary" onClick={() => n(o)}>
                  Download CSV
                </button>
              </div>
              <div className="pe-meta">
                <span>
                  <strong>{a.length}</strong>
                  {" prompts"}
                </span>
                <span>
                  <strong>{new Set(a.map((r) => r.engine)).size}</strong>
                  {" AI engines"}
                </span>
                {o.sample && <span>Example prompts</span>}
              </div>
              <details className="pe-preview">
                <summary>Preview prompts</summary>
                <div
                  className="library-table-scroll"
                  tabIndex="0"
                  role="region"
                  aria-label="Saved prompt preview"
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">AI engine</th>
                        <th scope="col">Intent</th>
                        <th scope="col">Prompt</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.slice(0, 15).map((r, l) => (
                        <tr key={l}>
                          <td>{r.engine}</td>
                          <td>{r.intent || "Not recorded"}</td>
                          <td>{r.prompt}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {a.length > 15 && (
                  <p className="pe-note">
                    {"Showing 15 of "}
                    {a.length}. Download the CSV for all prompts.
                  </p>
                )}
              </details>
            </article>
          );
        })
      ) : (
        <div className="pe-empty">
          <h2>{selectedClient ? "Your generated prompts will appear here" : "Choose a client"}</h2>
          <p>
            {selectedClient
              ? "Upload a transcript, generate prompts and save your prompt set. Editing is optional; no approval is required. Your CSV includes the engine, audience and content status."
              : "Select a client from the top bar to see their exports."}
          </p>
          <button className="guided-primary" onClick={() => onStartWorkflow?.(1)}>
            {"Upload & process"}
          </button>
        </div>
      )}
      <p className="pe-note">
        Generated and edited prompts are ready to export. Any older human approvals keep their recorded status
        and reviewer. This prototype uses example prompts and is not connected to a live prompt-generation
        service.
      </p>
    </section>
  );
}
export { PromptExports };
