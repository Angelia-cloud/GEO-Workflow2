import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
const lower = (A) =>
    String(A || "")
      .trim()
      .toLocaleLowerCase(),
  FOCUSABLE =
    'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
  emptyClientDraft = () => ({
    name: "",
    property: "",
    targetAudience: "",
    goals: "",
  });
function ClientPicker({ clients = [], selectedClient, onSelectClient, onCreateClient, createRequest = 0 }) {
  const [o, a] = useState(false),
    [r, l] = useState("list"),
    [s, c] = useState(""),
    [d, B] = useState(emptyClientDraft),
    [g, M] = useState({}),
    [h, U] = useState(""),
    [I, Q] = useState(false),
    [p, Y] = useState({
      left: 16,
      top: 80,
      width: 600,
      maxHeight: 560,
    }),
    E = useRef(null),
    u = useRef(null),
    F = useRef(null),
    m = useRef(null),
    j = useRef(null),
    w = useRef(null),
    z = useRef(false),
    C = useRef([]),
    N = `client-picker-${useId()}`,
    D = `${N}-search`,
    L = typeof onCreateClient == "function";
  useEffect(() => {
    if (!(!createRequest || !L)) {
      U("");
      M({});
      l("create");
      a(true);
    }
  }, [createRequest, L]);
  const H = useMemo(() => {
      const G = lower(s);
      return clients.filter((wA) => !G || [wA.name, wA.property].some((BA) => lower(BA).includes(G)));
    }, [clients, s]),
    pA = useCallback((G = true) => {
      if (!z.current) {
        a(false);
        if (G) {
          requestAnimationFrame(() =>
            E.current?.focus({
              preventScroll: true,
            }),
          );
        }
      }
    }, []);
  function O() {
    a(true);
  }
  useLayoutEffect(() => {
    if (!o) {
      return;
    }
    function G() {
      const wA = E.current?.getBoundingClientRect();
      if (!wA) {
        return;
      }
      const BA = document.documentElement.clientWidth,
        gA = window.innerHeight,
        uA = Math.min(r === "create" ? 780 : 600, BA - 32),
        y = Math.min(wA.bottom + 10, Math.max(8, gA - 180));
      Y({
        left: Math.max(16, Math.min(wA.left, BA - uA - 16)),
        top: y,
        width: uA,
        maxHeight: Math.min(r === "create" ? 700 : 580, gA - y - 16),
      });
    }
    G();
    (r === "create" ? m : F).current?.focus({
      preventScroll: true,
    });
    window.addEventListener("resize", G);
    window.addEventListener("scroll", G, true);
    return () => {
      window.removeEventListener("resize", G);
      window.removeEventListener("scroll", G, true);
    };
  }, [o, r]);
  useEffect(() => {
    if (!o) {
      return;
    }
    const G = (BA) => {
        if (BA.key === "Escape") {
          BA.preventDefault();
          BA.stopPropagation();
          pA();
        }
      },
      wA = (BA) => {
        u.current?.contains(BA.target) ||
          u.current?.querySelector(FOCUSABLE)?.focus({
            preventScroll: true,
          });
      };
    document.addEventListener("keydown", G, true);
    document.addEventListener("focusin", wA);
    return () => {
      document.removeEventListener("keydown", G, true);
      document.removeEventListener("focusin", wA);
    };
  }, [o, pA]);
  function EA(G) {
    onSelectClient?.(G);
    pA();
  }
  function v() {
    U("");
    M({});
    l("create");
  }
  function V() {
    if (!z.current) {
      l("list");
    }
  }
  function q(G, wA) {
    B((BA) => ({
      ...BA,
      [G]: wA,
    }));
    M((BA) => ({
      ...BA,
      [G]: "",
    }));
    U("");
  }
  useEffect(() => {
    h &&
      w.current?.scrollIntoView({
        block: "nearest",
      });
  }, [h]);
  async function iA(G) {
    if ((G.preventDefault(), z.current)) {
      return;
    }
    const wA = Object.fromEntries(Object.entries(d).map(([gA, uA]) => [gA, uA.trim()])),
      BA = {};
    if (
      (wA.name || (BA.name = "Enter a client or team name."),
      wA.property || (BA.property = "Enter a property name."),
      M(BA),
      Object.keys(BA).length)
    ) {
      (BA.name ? m : j).current?.focus();
      return;
    }
    z.current = true;
    Q(true);
    U("");
    try {
      if (!(await onCreateClient?.(wA))) {
        throw new Error("The client could not be created. Please try again.");
      }
      B(emptyClientDraft());
      M({});
      c("");
      l("list");
      z.current = false;
      pA();
    } catch (gA) {
      U(gA?.message || "The client could not be created. Please try again.");
    } finally {
      z.current = false;
      Q(false);
    }
  }
  function rA(G) {
    const wA = C.current[G];
    wA?.focus({
      preventScroll: true,
    });
    wA?.scrollIntoView({
      block: "nearest",
    });
  }
  function jA(G) {
    if (H.length) {
      if (G.key === "ArrowDown" || G.key === "ArrowUp") {
        G.preventDefault();
        rA(G.key === "ArrowDown" ? 0 : H.length - 1);
      } else if (G.key === "Enter") {
        G.preventDefault();
        EA(H[0]);
      }
    }
  }
  function RA(G, wA) {
    const BA = H.length - 1;
    if (G.key === "ArrowDown") {
      G.preventDefault();
      rA(Math.min(BA, wA + 1));
    } else if (G.key === "ArrowUp") {
      G.preventDefault();
      wA === 0 ? F.current?.focus() : rA(wA - 1);
    } else if (G.key === "Home" || G.key === "End") {
      G.preventDefault();
      rA(G.key === "Home" ? 0 : BA);
    }
  }
  function kA(G) {
    if (G.key !== "Tab") {
      return;
    }
    const wA = [...u.current.querySelectorAll(FOCUSABLE)].filter((uA) => uA.getClientRects().length);
    if (!wA.length) {
      G.preventDefault();
      return;
    }
    const BA = wA[0],
      gA = wA[wA.length - 1];
    if (G.shiftKey && G.target === BA) {
      G.preventDefault();
      gA?.focus();
    } else if (!G.shiftKey && G.target === gA) {
      G.preventDefault();
      BA?.focus();
    }
  }
  return (
    <div className="client-picker">
      <button
        ref={E}
        type="button"
        className="workspace-header-client"
        aria-label="Choose client"
        aria-describedby={`${N}-value`}
        aria-haspopup="dialog"
        aria-expanded={o}
        aria-controls={o ? N : undefined}
        title={selectedClient ? `Switch client: ${selectedClient.name}` : "Select a client"}
        onClick={() => (o ? pA() : O())}
        onKeyDown={(G) => {
          if (G.key === "ArrowDown" || G.key === "ArrowUp") {
            G.preventDefault();
            O();
          }
        }}
      >
        <span className="client-picker-value" id={`${N}-value`}>
          {selectedClient?.name || "Select a client"}
        </span>
        <span className="client-picker-chevron" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {o &&
        createPortal(
          <div className="client-picker-layer">
            <div
              className="client-picker-backdrop"
              aria-hidden="true"
              onPointerDown={(G) => {
                G.preventDefault();
                pA();
              }}
            />
            <section
              ref={u}
              id={N}
              className={`client-picker-panel${r === "create" ? " client-picker-panel-create" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={r === "create" ? "Add client" : "Choose a client"}
              style={p}
              onKeyDown={kA}
            >
              <header className="client-picker-heading">
                <div>
                  <h2>{r === "create" ? "Add client" : "Clients"}</h2>
                  {r === "list" && <span className="client-picker-count">{clients.length}</span>}
                </div>
                <button
                  type="button"
                  className="client-picker-close"
                  aria-label="Close client picker"
                  disabled={I}
                  onClick={() => pA()}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M6 18 18 6" />
                  </svg>
                </button>
              </header>
              {r === "create" ? (
                <form className="client-picker-create-form" onSubmit={iA} noValidate aria-busy={I}>
                  <div className="client-picker-form-body">
                    <button type="button" className="client-picker-back" onClick={V} disabled={I}>
                      <span aria-hidden="true">←</span>
                      {" Back to clients"}
                    </button>
                    <p className="client-picker-form-intro">
                      Client and property names are required. You can add the target audience and goals later.
                    </p>
                    <div className="client-picker-form-grid">
                      <div className="client-picker-field">
                        <label htmlFor={`${N}-name`}>
                          {"Client / team name "}
                          <span aria-hidden="true">*</span>
                        </label>
                        <input
                          maxLength={180}
                          ref={m}
                          id={`${N}-name`}
                          type="text"
                          value={d.name}
                          onChange={(G) => q("name", G.target.value)}
                          placeholder="e.g. InterContinental Sydney"
                          autoComplete="organization"
                          required
                          disabled={I}
                          aria-invalid={!!g.name}
                          aria-describedby={g.name ? `${N}-name-error` : undefined}
                        />
                        {g.name && (
                          <p className="client-picker-field-error" id={`${N}-name-error`}>
                            {g.name}
                          </p>
                        )}
                      </div>
                      <div className="client-picker-field">
                        <label htmlFor={`${N}-property`}>
                          {"Property name "}
                          <span aria-hidden="true">*</span>
                        </label>
                        <input
                          maxLength={180}
                          ref={j}
                          id={`${N}-property`}
                          type="text"
                          value={d.property}
                          onChange={(G) => q("property", G.target.value)}
                          placeholder="e.g. Coogee Beach"
                          autoComplete="off"
                          required
                          disabled={I}
                          aria-invalid={!!g.property}
                          aria-describedby={g.property ? `${N}-property-error` : undefined}
                        />
                        {g.property && (
                          <p className="client-picker-field-error" id={`${N}-property-error`}>
                            {g.property}
                          </p>
                        )}
                      </div>
                      <div className="client-picker-field client-picker-field-wide">
                        <label htmlFor={`${N}-audience`}>
                          {"Target audience "}
                          <span className="client-picker-optional">Optional</span>
                        </label>
                        <textarea
                          maxLength={2e3}
                          id={`${N}-audience`}
                          value={d.targetAudience}
                          onChange={(G) => q("targetAudience", G.target.value)}
                          placeholder="Who do you want to reach?"
                          rows="2"
                          disabled={I}
                        />
                      </div>
                      <div className="client-picker-field client-picker-field-wide">
                        <label htmlFor={`${N}-goals`}>
                          {"Goals "}
                          <span className="client-picker-optional">Optional</span>
                        </label>
                        <textarea
                          maxLength={4e3}
                          id={`${N}-goals`}
                          value={d.goals}
                          onChange={(G) => q("goals", G.target.value)}
                          placeholder="What does the client want to achieve?"
                          rows="3"
                          disabled={I}
                        />
                      </div>
                    </div>
                    {h && (
                      <p ref={w} className="client-picker-submit-error" role="alert">
                        {h}
                      </p>
                    )}
                  </div>
                  <footer className="client-picker-footer client-picker-form-footer">
                    <button type="button" className="client-picker-cancel" onClick={V} disabled={I}>
                      Cancel
                    </button>
                    <button type="submit" className="client-picker-create" disabled={I}>
                      {I ? "Creating client\u2026" : "Create client"}
                    </button>
                  </footer>
                </form>
              ) : (
                <>
                  <div className="client-picker-search">
                    <label className="client-picker-sr-only" htmlFor={D}>
                      Search clients
                    </label>
                    <svg
                      width="19"
                      height="19"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      aria-hidden="true"
                    >
                      <circle cx="10.5" cy="10.5" r="6.5" />
                      <path d="m16 16 5 5" />
                    </svg>
                    <input
                      ref={F}
                      id={D}
                      type="search"
                      value={s}
                      placeholder="Search clients"
                      autoComplete="off"
                      onChange={(G) => c(G.target.value)}
                      onKeyDown={jA}
                    />
                  </div>
                  <p className="client-picker-sr-only" aria-live="polite">
                    {H.length} {H.length === 1 ? "client" : "clients"}
                    {" found"}
                  </p>
                  <div className="client-picker-results" aria-label="Clients">
                    {H.length ? (
                      H.map((G, wA) => (
                        <button
                          type="button"
                          key={G.id}
                          ref={(BA) => {
                            C.current[wA] = BA;
                          }}
                          className="client-picker-row"
                          aria-pressed={G.id === selectedClient?.id}
                          onClick={() => EA(G)}
                          onKeyDown={(BA) => RA(BA, wA)}
                        >
                          <span className="client-picker-name">{G.name}</span>
                          {G.property && lower(G.property) !== lower(G.name) && (
                            <span className="client-picker-property">{G.property}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="client-picker-empty">
                        <strong>No clients found</strong>
                        <p>
                          {onCreateClient
                            ? "Try another name, or add a new client below."
                            : "Try another client name."}
                        </p>
                      </div>
                    )}
                  </div>
                  {onCreateClient && (
                    <footer className="client-picker-footer">
                      <button type="button" className="client-picker-add" onClick={v}>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Create new client
                      </button>
                    </footer>
                  )}
                </>
              )}
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
export { ClientPicker };
