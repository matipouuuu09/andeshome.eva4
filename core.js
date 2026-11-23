/* =========================================================
   core.js — utilidades, estado persistente y helpers de UI
   ========================================================= */
const AH = window.AH = {};

/* ---------- formato (es-CL) ---------- */
const nf0 = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
AH.fmt = {
  n: (v) => (v == null || isNaN(v) ? "—" : nf0.format(v)),
  n1: (v) => (v == null || isNaN(v) ? "—" : nf1.format(v)),
  n2: (v) => (v == null || isNaN(v) ? "—" : nf2.format(v)),
  pct: (v, d = 1) => (v == null || isNaN(v) ? "—" : (d === 0 ? nf0 : nf1).format(v * 100) + "%"),
  clp: (v) => (v == null || isNaN(v) ? "—" : "$" + nf0.format(Math.round(v))),
  mm: (v) => (v == null || isNaN(v) ? "—" : "$" + nf1.format(v / 1e6) + " MM"),
  h: (v) => (v == null || isNaN(v) ? "—" : nf1.format(v) + " h"),
  min: (m) => { m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} h ${String(mm).padStart(2, "0")} min` : `${mm} min`; },
  hhmm: (mins) => { mins = Math.round(mins); const h = Math.floor(mins / 60) % 24, m = mins % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; },
};
AH.toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
AH.today = () => { const d = new Date(); return AH.isoDate(d); };
AH.isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
AH.addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return AH.isoDate(d); };
AH.nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
AH.dateLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
AH.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- DOM ---------- */
AH.$ = (sel, root = document) => root.querySelector(sel);
AH.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
AH.el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/* ---------- RNG determinista (semillas reproducibles) ---------- */
AH.rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/* ---------- toast ---------- */
AH.toast = (msg, type = "") => {
  const box = AH.$("#toasts");
  const t = AH.el(`<div class="toast ${type}">${AH.esc(msg)}</div>`);
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
};

/* ---------- drawer ---------- */
AH.openDrawer = (title, subtitle, bodyHtml) => {
  AH.$("#drawerTitle").textContent = title;
  AH.$("#drawerSub").textContent = subtitle || "";
  AH.$("#drawerBody").innerHTML = bodyHtml;
  AH.$("#drawer").classList.add("open");
  AH.$("#overlay").classList.add("open");
  return AH.$("#drawerBody");
};
AH.closeDrawer = () => { AH.$("#drawer").classList.remove("open"); AH.$("#overlay").classList.remove("open"); };

/* ---------- tabs genéricos ---------- */
AH.bindTabs = (root) => {
  AH.$$(".tabs button", root).forEach((b) => b.addEventListener("click", () => {
    AH.$$(".tabs button", root).forEach((x) => x.classList.toggle("on", x === b));
    AH.$$(".tab-pane", root).forEach((p) => p.classList.toggle("on", p.id === b.dataset.tab));
    root.dispatchEvent(new CustomEvent("tabchange", { detail: b.dataset.tab }));
  }));
};

/* ---------- CSV export ---------- */
AH.downloadCSV = (filename, rows) => {
  const csv = rows.map((r) => r.map((v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- estado persistente (localStorage) ---------- */
const KEY = "andeshome-cd-v1";
AH.state = { citas: [], skuOv: {}, movs: [], seq: 1, config: { exigirASN: false }, escenarios: [], seeded: false };
AH.load = () => {
  try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(AH.state, JSON.parse(raw)); } catch (e) { /* almacenamiento no disponible */ }
};
AH.save = () => { try { localStorage.setItem(KEY, JSON.stringify(AH.state)); } catch (e) { /* sin persistencia */ } };
AH.resetAll = () => { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };

/* bus de eventos simple para refrescar módulos entre sí */
AH.bus = new EventTarget();
AH.emit = (name, detail) => AH.bus.dispatchEvent(new CustomEvent(name, { detail }));
AH.on = (name, fn) => AH.bus.addEventListener(name, (e) => fn(e.detail));

/* ---------- Chart.js: estilo común ---------- */
AH.colors = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", s5: "#e87ba4", s6: "#6250d6", navy: "#0b2e4f", grid: "#e6eef4", ink2: "#3d5670", muted: "#7a8ea3", good: "#128a5b", bad: "#c9373a" };
AH.canalColor = { "E-commerce domicilio": "#2a78d6", "Click & Collect": "#eb6834", "Reposición tiendas": "#1baf7a", "Bulky domicilio": "#eda100" };
AH.zonaColor = { "A-Rápida": "#2a78d6", "B-Media": "#eb6834", "C-Lenta": "#1baf7a", "D-Bulky": "#eda100", "Packing": "#6250d6" };
if (window.Chart) {
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue("--font") || "system-ui";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = AH.colors.ink2;
  Chart.defaults.borderColor = AH.colors.grid;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.useBorderRadius = true;
  Chart.defaults.plugins.legend.labels.borderRadius = 3;
  Chart.defaults.plugins.legend.position = "top";
  Chart.defaults.plugins.legend.align = "end";
  Chart.defaults.plugins.tooltip.backgroundColor = "#0b2e4f";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = { duration: 450 };
  Chart.defaults.transitions.resize = { animation: { duration: 0 } };
  Chart.defaults.interaction.mode = "index";
  Chart.defaults.interaction.intersect = false;
  Chart.defaults.scale.grid.color = AH.colors.grid;
  Chart.defaults.scale.grid.drawTicks = false;
  Chart.defaults.scale.border.display = false;
  Chart.defaults.scale.ticks.padding = 6;
}
AH.charts = {};
AH.chart = (id, config) => {
  const cv = document.getElementById(id);
  if (!cv || !window.Chart) return null;
  if (AH.charts[id]) AH.charts[id].destroy();
  AH.charts[id] = new Chart(cv, config);
  return AH.charts[id];
};

/* ---------- validaciones chilenas ---------- */
AH.validRut = (rut) => {
  const clean = String(rut).replace(/[.\s]/g, "").toUpperCase();
  const m = clean.match(/^(\d{7,8})-?([\dK])$/);
  if (!m) return false;
  let sum = 0, mul = 2;
  for (let i = m[1].length - 1; i >= 0; i--) { sum += Number(m[1][i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (sum % 11);
  const dv = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return dv === m[2];
};
AH.formatRut = (rut) => {
  const c = String(rut).replace(/[^\dkK]/g, "").toUpperCase();
  if (c.length < 2) return c;
  const body = c.slice(0, -1), dv = c.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
};
AH.validPatente = (p) => /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(String(p).replace(/[\s-]/g, "").toUpperCase());
