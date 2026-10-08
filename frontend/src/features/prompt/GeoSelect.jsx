import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Searchable dropdown used inside the Prompt wizard. It renders the same markup the
 * original "enhanced select" produced: a hidden native <select> followed by a
 * `.geo-select` trigger and a floating `.select-menu`.
 *
 * options: [{ value, label, detail? }]. An option with value "create" is shown as the
 * footer action ("+ Create a new …").
 */
export function GeoSelect({ id, label, value, options, disabled = false, onChange, searchable = true, className }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const selected = options.find((option) => option.value === value);
  const create = options.find((option) => option.value === "create");
  const choices = options.filter((option) => option.value && option.value !== "create" && !option.disabled);
  const q = query.trim().toLowerCase();
  const matches = choices.filter((option) => `${option.label} ${option.detail || ""}`.toLowerCase().includes(q));

  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  function choose(next) {
    close(true);
    if (next !== value) onChange?.(next);
  }

  function position() {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    const list = listRef.current;
    if (!trigger || !menu || !list) return;
    const win = trigger.ownerDocument.defaultView;
    const box = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(box.width, 0), 640, win.innerWidth - 32);
    const below = win.innerHeight - box.bottom - 24;
    const above = box.top - 24;
    const up = below < 220 && above > below;
    const available = Math.max(140, up ? above : below);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(16, Math.min(box.left, win.innerWidth - width - 16))}px`;
    const overhead = menu.offsetHeight - list.offsetHeight;
    list.style.maxHeight = `${Math.max(56, Math.min(280, available - overhead))}px`;
    menu.style.top = `${up ? Math.max(16, box.top - menu.offsetHeight - 8) : box.bottom + 8}px`;
  }

  useLayoutEffect(() => {
    if (!open) return;
    position();
  });

  useEffect(() => {
    if (!open) return undefined;
    const doc = wrapperRef.current.ownerDocument;
    const win = doc.defaultView;
    (searchRef.current || listRef.current?.querySelector('[aria-selected="true"]') || listRef.current?.firstElementChild)?.focus({
      preventScroll: true,
    });
    const outside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) close();
    };
    const onScroll = (event) => {
      if (!menuRef.current?.contains(event.target)) close();
    };
    const onResize = () => close();
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("focusin", outside);
    doc.addEventListener("scroll", onScroll, true);
    win.addEventListener("resize", onResize);
    return () => {
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("focusin", outside);
      doc.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onTriggerKey(event) {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      setOpen(true);
    }
  }

  function onWrapperKey(event) {
    if (!open) return;
    const items = Array.from(listRef.current?.querySelectorAll('[role="option"]') || []);
    const doc = wrapperRef.current.ownerDocument;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if ((event.key === "Home" || event.key === "End") && event.target === searchRef.current) return;
      event.preventDefault();
      const current = items.indexOf(doc.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? Math.min(items.length - 1, current + 1)
              : Math.max(0, current - 1);
      items[next]?.focus();
    } else if (event.key === "Enter" && event.target === searchRef.current) {
      event.preventDefault();
      items[0]?.click();
    }
  }

  const labelId = `${id}-label`;
  return (
    <div className={className}>
      <span id={labelId}>{label}</span>
      <select id={id} hidden tabIndex={-1} value={value} disabled={disabled} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} data-detail={option.detail}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="geo-select" ref={wrapperRef} onKeyDown={onWrapperKey}>
        <button
          className={`select-trigger${value ? "" : " is-placeholder"}`}
          type="button"
          id={`${id}-trigger`}
          ref={triggerRef}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open ? "true" : "false"}
          aria-controls={`${id}-list`}
          aria-labelledby={`${labelId} ${id}-value`}
          onClick={() => (open ? close(true) : (setQuery(""), setOpen(true)))}
          onKeyDown={onTriggerKey}
        >
          <span className="select-value" id={`${id}-value`}>
            {selected?.label.replace(/^\+\s*/, "") || "Select an option"}
          </span>
          <svg
            className="select-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div className="select-menu" hidden={!open} ref={menuRef}>
          {searchable && (
            <div className="select-search">
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                spellCheck="false"
                placeholder={`Search ${String(label).toLowerCase()}`}
                aria-label={`Search ${String(label).toLowerCase()}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <div className="select-options" id={`${id}-list`} role="listbox" aria-label={label} ref={listRef}>
            {open &&
              matches.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="select-option"
                  role="option"
                  aria-selected={String(option.value === value)}
                  tabIndex={-1}
                  data-value={option.value}
                  onClick={() => choose(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    {option.detail ? <small>{option.detail}</small> : null}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </button>
              ))}
          </div>
          <p className="select-empty" role="status" hidden={matches.length > 0}>
            No matches found.
          </p>
          <div className="select-menu-footer" hidden={!create}>
            {create && (
              <button type="button" onClick={() => choose("create")}>
                {create.label.replace(/^\+\s*/, "+ ")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
