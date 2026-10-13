import { useEffect, useState } from "react";

export function ReportNavigation({ sections }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!els.length || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) setActive(seen[0].target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav aria-label="Report sections">
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} className={active === s.id ? "active" : ""}
          onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActive(s.id); }}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
