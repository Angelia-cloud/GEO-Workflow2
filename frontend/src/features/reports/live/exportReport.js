import { REFERENCE_CSS } from "./referenceCss.js";
import { pctTip } from "./reportModel.js";

/**
 * Interactive behaviour of the exported report — the same as the approved reference file:
 * sticky-nav highlighting, the trend view toggle, chart tooltips, the "See the trend" jumps and the
 * Evidence / Mockup & plan buttons. Serialised with Function#toString, so it must not use outer variables.
 */
function reportBehaviour(dataset) {
  const bs = [...document.querySelectorAll(".trend-toggle button")];
  const views = { all22: document.getElementById("view-all22"), comp17: document.getElementById("view-comp17") };
  const tooltip = document.getElementById("chart-tooltip");
  const chartWrap = document.querySelector(".chart-wrap");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function buildTooltip(i) {
    const active = document.querySelector(".trend-toggle button.active")?.dataset.view || "all22";
    if (active === "all22") {
      return `<div class="tt-title">${esc(dataset.periodsAll22[i])}</div><table><tr><th>${esc(dataset.allLabel)}</th><td>${esc(dataset.all22[i])}</td></tr></table>`;
    }
    const rows = dataset.comp17.map((s) => `<tr><th>${esc(s.name)}</th><td>${esc(s.values[i])}</td></tr>`).join("");
    return `<div class="tt-title">${esc(dataset.periods[i])}</div><div class="tt-sub" style="margin-top:0;padding-top:0;border-top:0">${esc(dataset.compLabel)}</div><table>${rows}</table>`;
  }
  function place(tip, wrap, target) {
    const wrapRect = wrap.getBoundingClientRect();
    const pointRect = target.getBoundingClientRect();
    let left = pointRect.left - wrapRect.left + 14;
    let top = pointRect.top - wrapRect.top - 10;
    const ttRect = tip.getBoundingClientRect();
    if (left + ttRect.width > wrapRect.width - 8) left = pointRect.left - wrapRect.left - ttRect.width - 14;
    if (left < 8) left = 8;
    if (top + ttRect.height > wrapRect.height - 8) top = wrapRect.height - ttRect.height - 8;
    if (top < 8) top = 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function showTooltip(evt) {
    const idx = Number(evt.target.dataset.periodIndex);
    if (Number.isNaN(idx) || !tooltip) return;
    tooltip.innerHTML = buildTooltip(idx);
    tooltip.style.display = "block";
    place(tooltip, chartWrap, evt.target);
  }
  function hideTooltip() { if (tooltip) tooltip.style.display = "none"; }
  function setTrendView(key) {
    bs.forEach((x) => x.classList.toggle("active", x.dataset.view === key));
    Object.entries(views).forEach(([k, v]) => { if (v) v.hidden = k !== key; });
    hideTooltip();
  }
  bs.forEach((b) => { b.onclick = () => setTrendView(b.dataset.view); });
  document.querySelectorAll(".trend-jump").forEach((link) => link.addEventListener("click", function () { setTrendView(this.dataset.view || "all22"); }));
  document.querySelectorAll(".hover-point").forEach((el) => {
    el.addEventListener("mouseenter", showTooltip);
    el.addEventListener("mousemove", showTooltip);
    el.addEventListener("mouseleave", hideTooltip);
  });

  const assistantTooltip = document.getElementById("assistant-tooltip");
  const assistantChart = document.querySelector(".assistant-chartcard");
  function showAssistantTooltip(evt) {
    if (!assistantTooltip || !assistantChart) return;
    const p = evt.currentTarget;
    assistantTooltip.innerHTML = `<div class="tt-title">${esc(p.dataset.month || "")}</div><table><tr><th>${esc(p.dataset.assistant || "")}</th><td>${esc(p.dataset.value || "")}</td></tr></table>`;
    assistantTooltip.style.display = "block";
    place(assistantTooltip, assistantChart, p);
  }
  document.querySelectorAll(".assistant-hover-point").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", showAssistantTooltip);
    el.addEventListener("mousemove", showAssistantTooltip);
    el.addEventListener("mouseleave", () => { if (assistantTooltip) assistantTooltip.style.display = "none"; });
  });

  const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
  const sections = navLinks.map((l) => document.querySelector(l.getAttribute("href"))).filter(Boolean);
  const setActiveNav = (id) => navLinks.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === `#${id}`));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length) setActiveNav(visible[0].target.id);
    }, { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.05, 0.2, 0.5] });
    sections.forEach((s) => io.observe(s));
  }
  setActiveNav("glance");
  navLinks.forEach((l) => l.addEventListener("click", () => setActiveNav(l.getAttribute("href").slice(1))));

  function fit(fig) {
    const frame = fig.querySelector(".mock-frame"), inner = fig.querySelector(".mock-inner"), ifr = fig.querySelector("iframe");
    if (!frame || !ifr || !frame.clientWidth) return;
    let h = 1200;
    try { h = ifr.contentDocument.documentElement.scrollHeight || h; } catch (e) { /* cross-origin */ }
    const s = frame.clientWidth / 1440;
    ifr.style.height = `${h}px`; ifr.style.transform = `scale(${s})`; inner.style.height = `${h * s}px`;
  }
  document.querySelectorAll(".mock iframe").forEach((ifr) => ifr.addEventListener("load", () => fit(ifr.closest(".mock"))));
  window.addEventListener("resize", () => document.querySelectorAll(".mock").forEach(fit));
  document.querySelectorAll(".rt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = document.getElementById(btn.getAttribute("aria-controls"));
      if (!p) return;
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", open);
      p.hidden = !open;
      if (open) p.querySelectorAll(".mock").forEach((f) => setTimeout(() => fit(f), 30));
    });
  });
  document.querySelectorAll(".mock-open").forEach((b) => b.addEventListener("click", () => {
    const ifr = b.closest(".mock").querySelector("iframe");
    window.open(URL.createObjectURL(new Blob([ifr.srcdoc], { type: "text/html" })), "_blank");
  }));
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function exportFilename(propertyName, from, to) {
  const property = propertyName.trim().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "Property";
  return `${property}_GEO_Report_${from}_to_${to}.html`;
}

/** Builds the standalone report file: reference stylesheet, the rendered report in its initial state, behaviour script. */
export function buildReportHtml(wrap, model, title) {
  if (!wrap) throw new Error("The report is not ready to export yet.");
  const copy = wrap.cloneNode(true);
  copy.querySelectorAll("[data-noexport], .report-controls, .opp-form").forEach((el) => el.remove());
  copy.querySelectorAll("input, select, textarea, form").forEach((el) => el.remove());
  copy.querySelectorAll("nav a").forEach((a) => a.classList.remove("active"));
  copy.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
  copy.querySelectorAll(".trend-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === "all22"));
  copy.querySelectorAll(".trend-view").forEach((v) => { if (v.id === "view-all22") v.removeAttribute("hidden"); else v.setAttribute("hidden", ""); });
  copy.querySelectorAll(".rt-panel").forEach((p) => p.setAttribute("hidden", ""));
  copy.querySelectorAll(".rt-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
  copy.querySelectorAll(".chart-tooltip").forEach((t) => { t.removeAttribute("style"); t.innerHTML = ""; });
  const t = model.trend;
  const dataset = {
    allLabel: `All ${t.trackedQuestions} questions`,
    compLabel: `${t.comparisonQuestions} comparison questions`,
    periods: t.trend.map((p) => p.label),
    periodsAll22: t.periodNames,
    all22: t.all.map(pctTip),
    comp17: t.comparison.map((s) => ({ name: s.name, values: s.values.map(pctTip) })),
  };
  const script = `(${reportBehaviour.toString()})(${JSON.stringify(dataset).replace(/</g, "\\u003c")});`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${REFERENCE_CSS}</style>
</head>
<body><div class="wrap">
${copy.innerHTML}
</div>
<script>
${script.replace(/<\/script/gi, "<\\/script")}
</script>
</body></html>
`;
}

export function downloadReportHtml(wrap, model, title, filename) {
  const html = buildReportHtml(wrap, model, title);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
