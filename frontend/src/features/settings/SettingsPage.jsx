import { useEffect, useRef } from "react";
function ImportIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12m-4-4 4 4 4-4M4 14v6h16v-6" />
    </svg>
  );
}
export { ImportIcon };
function SettingsButton({ onClick, active }) {
  return (
    <button
      type="button"
      className="workspace-settings-button"
      aria-label="Settings"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9.5 3-.6 2.2-1.7 1L5 5.6 2.5 10l1.6 1.6v1.8L2.5 15 5 19.4l2.2-.6 1.7 1 .6 2.2h5l.6-2.2 1.7-1 2.2.6 2.5-4.4-1.6-1.6v-1.8L21.5 10 19 5.6l-2.2.6-1.7-1-.6-2.2z" />
        <circle cx="12" cy="12.5" r="3" />
      </svg>
      <span className="workspace-settings-tooltip" aria-hidden="true">
        Settings
      </span>
    </button>
  );
}
export { SettingsButton };
function SettingsPage({ onOpenImports }) {
  const e = useRef(null);
  useEffect(() => {
    e.current?.focus({
      preventScroll: true,
    });
  }, []);
  return (
    <section className="workspace-settings-page" aria-labelledby="workspaceSettingsTitle">
      <header>
        <h1 id="workspaceSettingsTitle" ref={e} tabIndex="-1">
          Settings
        </h1>
        <p>Manage your workspace files and import history.</p>
      </header>
      <button type="button" className="workspace-settings-card" onClick={onOpenImports} aria-label="Imports">
        <span className="workspace-settings-card-icon">
          <ImportIcon />
        </span>
        <span className="workspace-settings-card-copy">
          <strong>Imports</strong>
          <span>
            View Prompt and Rankscale import history, download original files and open saved reports.
          </span>
          <span className="workspace-settings-card-types">
            {"Prompt "}
            <span aria-hidden="true">·</span>
            {" Rankscale"}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
    </section>
  );
}
export { SettingsPage };
