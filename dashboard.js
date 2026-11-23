/* =========================================================
   dashboard.js — Torre de control interactiva
   Hojas: Panel, KPI_Mensual, Pedidos_Diarios, Forecast_36M,
   SLA_Canales, Transportistas, Proveedores, Devoluciones,
   Costos_Operacion
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const D = window.AH_DASH;
  const DI = D.diarios; // [fecha, canal, pedidos, lineas, aTiempo, perfectos, backlog, ciclo_h, peak, cola_h]
  const CANALES = [...new Set(DI.map((d) => d[1]))];
  const metaCanal = { "E-commerce domicilio": 0.96, "Click & Collect": 0.97, "Reposición tiendas": 0.98 };
  const f = { canal: "", desde: DI[0][0], hasta: DI[DI.length - 1][0], gran: "semana", metric: "OTIF (%)" };

  const weekKey = (iso) => { const d = new Date(iso + "T12:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return AH.isoDate(d); };
  const keyOf = (iso) => (f.gran === "dia" ? iso : f.gran === "semana" ? weekKey(iso) : iso.slice(0, 7));
  const label = (k) => (f.gran === "mes" ? new Date(k + "-15").toLocaleDateString("es-CL", { month: "short", year: "2-digit" }) : new Date(k + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short" }));

  function rows() { return DI.filter((d) => d[0] >= f.desde && d[0] <= f.hasta && (!f.canal || d[1] === f.canal)); }

  function renderFiltered() {
    const r = rows();
    const sum = (i) => r.reduce((s, d) => s + d[i], 0);
    const ped = sum(2), at = sum(4), perf = sum(5);
    const dias = [...new Set(r.map((d) => d[0]))];
    const ultimo = dias[dias.length - 1];
    const backlog = r.filter((d) => d[0] === ultimo).reduce((s, d) => s + d[6], 0);
    const ciclo = r.reduce((s, d) => s + d[7] * d[2], 0) / (ped || 1);
    const cola = r.reduce((s, d) => s + d[9] * d[2], 0) / (ped || 1);
    const otif = at / (ped || 1);
    $("#dashKpis").innerHTML = `
      <div class="card kpi navy"><div class="label">OTIF del período</div><div class="value num">${fmt.pct(otif)}</div><div class="sub">Meta directorio 96% · brecha ${fmt.n1((otif - 0.96) * 100)} pp</div></div>
      <div class="card kpi"><div class="label">Pedido perfecto</div><div class="value num">${fmt.pct(perf / (ped || 1))}</div><div class="sub">${fmt.n(ped)} pedidos · ${fmt.n(ped - perf)} con falla</div></div>
      <div class="card kpi accent"><div class="label">Backlog al cierre</div><div class="value num">${fmt.n(backlog)}</div><div class="sub">pedidos al ${ultimo ? new Date(ultimo + "T12:00:00").toLocaleDateString("es-CL") : "—"}</div></div>
      <div class="card kpi"><div class="label">Ciclo real ponderado</div><div class="value num">${fmt.h(ciclo)}</div><div class="sub">de ellos ${fmt.h(cola)} en cola entre etapas</div></div>`;

    // series por período
    const keys = [...new Set(r.map((d) => keyOf(d[0])))];
    const canales = f.canal ? [f.canal] : CANALES;
    const agg = (canal, i) => keys.map((k) => r.filter((d) => keyOf(d[0]) === k && d[1] === canal).reduce((s, d) => s + d[i], 0));
    AH.chart("chPedidos", {
      type: "bar",
      data: { labels: keys.map(label), datasets: canales.map((c) => ({ label: c, data: agg(c, 2), backgroundColor: AH.canalColor[c], borderColor: "#fff", borderWidth: { top: 2 }, borderSkipped: false })) },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, title: { display: true, text: "Pedidos" } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n(c.raw)}`, footer: (it) => "Total: " + fmt.n(it.reduce((s, i) => s + i.raw, 0)) } } } },
    });
    const bl = keys.map((k) => { const ds = r.filter((d) => keyOf(d[0]) === k); const last = ds[ds.length - 1]?.[0]; return ds.filter((d) => d[0] === last).reduce((s, d) => s + d[6], 0); });
    const otifK = keys.map((k) => { const ds = r.filter((d) => keyOf(d[0]) === k); return ds.reduce((s, d) => s + d[4], 0) / (ds.reduce((s, d) => s + d[2], 0) || 1); });
    AH.chart("chBacklog", {
      type: "line",
      data: { labels: keys.map(label), datasets: [{ label: "Backlog al cierre", data: bl, borderColor: AH.colors.s2, backgroundColor: "rgba(235,104,52,.12)", fill: true, tension: 0.3 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "Backlog: " + fmt.n(c.raw) + " pedidos" } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: "Pedidos pendientes" } } } },
    });
    AH.chart("chOtifT", {
      type: "line",
      data: { labels: keys.map(label), datasets: [
        { label: "OTIF", data: otifK.map((v) => v * 100), borderColor: AH.colors.s1, tension: 0.3 },
        { label: "Meta 96%", data: keys.map(() => 96), borderColor: AH.colors.navy, borderDash: [5, 5], borderWidth: 1.5 },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n1(c.raw)}%` } } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: "%" } } } },
    });
    // OTIF por canal vs meta
    const oc = CANALES.map((c) => { const ds = r.filter((d) => d[1] === c); return ds.reduce((s, d) => s + d[4], 0) / (ds.reduce((s, d) => s + d[2], 0) || 1); });
    AH.chart("chOtifCanal", {
      type: "bar",
      data: { labels: CANALES, datasets: [
        { label: "OTIF real", data: oc.map((v) => v * 100), backgroundColor: CANALES.map((c) => AH.canalColor[c]) },
        { label: "Meta SLA", data: CANALES.map((c) => metaCanal[c] * 100), backgroundColor: "#c9d7e3" },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n1(c.raw)}%` } } }, scales: { x: { grid: { display: false } }, y: { min: 70, max: 100, title: { display: true, text: "%" } } } },
    });
  }

  function renderPanel() {
    const fmtK = (k, v) => k.includes("CLP") ? fmt.clp(v) : k.includes("(h)") ? fmt.h(v) : k.includes("kg") ? fmt.n2(v) + " kg" : fmt.pct(v);
    const peorSiMayor = (k) => /Dock|Costo|CO2|Ocupación/.test(k);
    $("#panelGrid").innerHTML = D.panel.map((p) => {
      const ok = peorSiMayor(p.kpi) ? p.jun <= p.meta : p.jun >= p.meta;
      return `<div class="card" style="padding:16px">
        <div class="label-sm">${esc(p.kpi)}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px"><b style="font-size:22px" class="num">${fmtK(p.kpi, p.jun)}</b><span class="badge ${ok ? "b-good" : "b-bad"}">${ok ? "✓ en meta" : "✗ fuera de meta"}</span></div>
        <p class="small muted">Jun-2026 · meta ${fmtK(p.kpi, p.meta)} · prom. 12M ${fmtK(p.kpi, p.prom12)}</p>
        <p class="small" style="margin-top:6px">${esc(p.lectura)}</p></div>`;
    }).join("");
  }

  const METRICS = { "OTIF (%)": 96, "Precisión picking (%)": 99.5, "Exactitud inventario (%)": 99.2, "Dock-to-stock (h)": 8, "Ciclo pedido (h)": 28.2, "Costo/pedido (CLP)": 5675, "CO2e/pedido (kg)": 1.545, "Ocupación (%)": 90, "Horas extra (%)": null, "Ausentismo (%)": null, "Devoluciones (%)": null, "Daño (%)": null, "Pedidos": null };
  function renderMensual() {
    const k = f.metric, meta = METRICS[k];
    const labels = D.kpi.map((r) => new Date(r.Mes + "-15").toLocaleDateString("es-CL", { month: "short", year: "2-digit" }));
    const ds = [{ label: k, data: D.kpi.map((r) => r[k]), borderColor: AH.colors.s1, backgroundColor: "rgba(42,120,214,.10)", fill: true, tension: 0.3, pointRadius: 3 }];
    if (meta != null) ds.push({ label: k === "Ciclo pedido (h)" ? "Proyección informe" : "Meta", data: D.kpi.map(() => meta), borderColor: AH.colors.s2, borderDash: [6, 5], borderWidth: 1.5, fill: false });
    AH.chart("chMensual", { type: "line", data: { labels, datasets: ds }, options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n2(c.raw)}` } } }, scales: { x: { grid: { display: false } } } } });
  }

  function renderStatic() {
    // forecast
    const fc = D.forecast;
    AH.chart("chForecast", {
      type: "line",
      data: { labels: fc.map((r) => new Date(r.Mes + "-15").toLocaleDateString("es-CL", { month: "short", year: "2-digit" })), datasets: [
        { label: "Real", data: fc.map((r) => r["Pedidos reales"] ?? null), borderColor: AH.colors.navy, pointRadius: 2 },
        { label: "Pronóstico base", data: fc.map((r) => r["Pronóstico base"]), borderColor: AH.colors.s1, borderDash: [4, 4] },
        { label: "Escenario alto", data: fc.map((r) => r["Escenario alto"]), borderColor: AH.colors.s2, borderWidth: 1.5 },
        { label: "Escenario bajo", data: fc.map((r) => r["Escenario bajo"]), borderColor: AH.colors.s3, borderWidth: 1.5 },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n(c.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: "Pedidos / mes" } } } },
    });
    // proveedores ASN
    const pv = [...D.proveedores].sort((a, b) => a["Cumplimiento ASN"] - b["Cumplimiento ASN"]);
    AH.chart("chAsn", {
      type: "bar",
      data: { labels: pv.map((p) => p.Proveedor.replace("Proveedor ", "P")), datasets: [{ label: "Cumplimiento ASN", data: pv.map((p) => p["Cumplimiento ASN"] * 100), backgroundColor: pv.map((p) => p["Cumplimiento ASN"] >= 0.85 ? AH.colors.s3 : p["Cumplimiento ASN"] >= 0.6 ? AH.colors.s4 : AH.colors.s2) }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => pv[it[0].dataIndex].Proveedor + " · " + pv[it[0].dataIndex].Origen, label: (c) => `ASN: ${fmt.n1(c.raw)}% (meta 85%)` } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { max: 100, title: { display: true, text: "%" } } } },
    });
    // transportistas
    const tr = [...new Set(D.transportistas.map((t) => t.Transportista))];
    const m = (t, k) => { const a = D.transportistas.filter((x) => x.Transportista === t); return a.reduce((s, x) => s + x[k], 0) / a.length; };
    AH.chart("chTrans", {
      type: "bar",
      data: { labels: tr, datasets: [
        { label: "Éxito 1er intento", data: tr.map((t) => m(t, "Éxito 1er intento") * 100), backgroundColor: AH.colors.s1 },
        { label: "Utilización", data: tr.map((t) => m(t, "Utilización") * 100), backgroundColor: AH.colors.s3 },
        { label: "POD digital", data: tr.map((t) => m(t, "POD digital") * 100), backgroundColor: AH.colors.s4 },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n1(c.raw)}%` } } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 100, title: { display: true, text: "%" } } } },
    });
    // pareto devoluciones
    const dv = D.devoluciones, tot = dv.reduce((s, d) => s + d.costo, 0);
    let acc = 0;
    $("#paretoList").innerHTML = dv.map((d) => { acc += d.costo; return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span><b>${esc(d.Motivo)}</b> · ${d.casos} casos</span><span class="num">${fmt.mm(d.costo)} · acum. ${fmt.pct(acc / tot, 0)}</span></div><div class="bar-mini" style="margin-top:4px"><i style="width:${(d.costo / dv[0].costo) * 100}%;background:${acc / tot <= 0.8 ? AH.colors.s2 : AH.colors.s1}"></i></div></div>`; }).join("");
    // costos
    AH.chart("chCostos", {
      type: "bar",
      data: { labels: D.costos.map((c) => new Date(c.Mes + "-15").toLocaleDateString("es-CL", { month: "short", year: "2-digit" })), datasets: [
        { label: "Presupuesto", data: D.costos.map((c) => c["Presupuesto CLP"] / 1e6), backgroundColor: "#c9d7e3" },
        { label: "Real", data: D.costos.map((c) => c["Real CLP"] / 1e6), backgroundColor: AH.colors.s1 },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${fmt.n1(c.raw)} MM`, footer: (it) => "Desviación: $" + fmt.n1(it[1].raw - it[0].raw) + " MM" } } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: "CLP millones" } } } },
    });
  }

  function renderLive() {
    const s = AH.agenda.stats(), m = AH.wms.metrics();
    $("#liveOps").innerHTML = `
      <div class="kv">
        <div><span>Citas de andén hoy</span><b>${s.hoy} (${s.rec} recepciones)</b></div>
        <div><span>Camiones en patio / andén</span><b>${s.enPatio}</b></div>
        <div><span>Recepciones hoy sin ASN</span><b style="color:${s.sinAsn ? "var(--bad)" : "inherit"}">${s.sinAsn}</b></div>
        <div><span>Exactitud inventario (WMS)</span><b>${fmt.pct(m.exactitud)}</b></div>
        <div><span>SKU fuera de zona ideal</span><b>${m.mism} (${fmt.pct(m.mismPct)})</b></div>
        <div><span>Movimientos WMS registrados</span><b>${AH.state.movs.length}</b></div>
      </div>`;
  }

  AH.dashboard = {
    init() {
      $("#dCanal").innerHTML = `<option value="">Todos los canales</option>` + CANALES.map((c) => `<option>${c}</option>`).join("");
      $("#dDesde").value = f.desde; $("#dHasta").value = f.hasta;
      $("#dDesde").min = $("#dHasta").min = DI[0][0]; $("#dDesde").max = $("#dHasta").max = DI[DI.length - 1][0];
      $("#dCanal").addEventListener("change", (e) => { f.canal = e.target.value; renderFiltered(); });
      $("#dDesde").addEventListener("change", (e) => { f.desde = e.target.value || DI[0][0]; renderFiltered(); });
      $("#dHasta").addEventListener("change", (e) => { f.hasta = e.target.value || DI[DI.length - 1][0]; renderFiltered(); });
      $$("#dGran button").forEach((b) => b.addEventListener("click", () => { f.gran = b.dataset.v; $$("#dGran button").forEach((x) => x.classList.toggle("on", x === b)); renderFiltered(); }));
      $$("[data-preset]").forEach((b) => b.addEventListener("click", () => {
        const p = b.dataset.preset;
        if (p === "peak") { f.desde = "2026-06-01"; f.hasta = "2026-06-30"; }
        else if (p === "pre") { f.desde = "2026-01-01"; f.hasta = "2026-05-31"; }
        else { f.desde = DI[0][0]; f.hasta = DI[DI.length - 1][0]; f.canal = ""; $("#dCanal").value = ""; }
        $("#dDesde").value = f.desde; $("#dHasta").value = f.hasta; renderFiltered();
      }));
      $("#dMetric").innerHTML = Object.keys(METRICS).map((k) => `<option>${k}</option>`).join("");
      $("#dMetric").addEventListener("change", (e) => { f.metric = e.target.value; renderMensual(); });
      renderPanel(); renderFiltered(); renderMensual(); renderStatic(); renderLive();
      AH.on("agenda-changed", renderLive); AH.on("wms-changed", renderLive);
    },
    refresh() { renderLive(); },
  };
})();
