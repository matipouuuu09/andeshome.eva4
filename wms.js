/* =========================================================
   wms.js — Mini WMS: inventario, ubicaciones, movimientos,
   órdenes y calidad de datos (hojas SKU_Master, Inventario,
   Layout_Capacidad, Equipos_MHE, Ordenes_Muestra, Lineas_Pedido)
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const D = window.AH_DASH;
  const ZONAS = ["A-Rápida", "B-Media", "C-Lenta", "D-Bulky"];
  const DIST_ZONA = { "A-Rápida": 35, "B-Media": 72, "C-Lenta": 118, "D-Bulky": 154 };

  /* ---------- modelo ---------- */
  const base = window.AH_SKU;
  const W = AH.wms = {};
  W.skus = () => base.map((s) => ({ ...s, ...(AH.state.skuOv[s.sku] || {}) }));
  W.get = (sku) => { const b = base.find((s) => s.sku === sku); return b ? { ...b, ...(AH.state.skuOv[sku] || {}) } : null; };
  const patch = (sku, obj) => { AH.state.skuOv[sku] = { ...(AH.state.skuOv[sku] || {}), ...obj }; };
  W.log = (tipo, sku, cant, detalle, ref = "") => {
    AH.state.movs.unshift({ id: "MOV-" + String(AH.state.seq++).padStart(5, "0"), ts: new Date().toISOString(), tipo, sku, cant, detalle, ref });
    if (AH.state.movs.length > 2000) AH.state.movs.length = 2000;
  };
  /** Ingreso de stock (recepción): suma a sistema y físico */
  W.receive = (sku, qty, ref) => {
    const s = W.get(sku); if (!s || qty <= 0) return false;
    patch(sku, { sis: s.sis + qty, fis: s.fis + qty });
    W.log("Recepción", sku, +qty, `Ingreso a ${s.zona}`, ref);
    return true;
  };
  W.issue = (sku, qty, ref) => {
    const s = W.get(sku); if (!s || qty <= 0 || qty > s.fis) return false;
    patch(sku, { sis: s.sis - qty, fis: s.fis - qty });
    W.log("Salida", sku, -qty, `Despacho desde ${s.zona}`, ref);
    return true;
  };
  W.count = (sku, counted) => {
    const s = W.get(sku); if (!s || counted < 0) return false;
    const diff = counted - s.sis;
    patch(sku, { sis: counted, fis: counted, diasConteo: 0 });
    W.log("Conteo cíclico", sku, diff, `Sistema ${fmt.n(s.sis)} → físico ${fmt.n(counted)}`);
    return true;
  };
  W.relocate = (sku, zona, silent) => {
    const s = W.get(sku); if (!s || s.zona === zona) return false;
    patch(sku, { zona, dist: DIST_ZONA[zona] });
    if (!silent) W.log("Reubicación", sku, 0, `${s.zona} → ${zona}`);
    return true;
  };
  W.metrics = () => {
    const all = W.skus();
    let sumAcc = 0, diffVal = 0, mism = 0, mismA = 0, nA = 0, unidades = 0, valor = 0, extraM = 0;
    all.forEach((s) => {
      const acc = s.fis > 0 ? Math.max(0, 1 - Math.abs(s.sis - s.fis) / s.fis) : 1;
      sumAcc += acc; diffVal += Math.abs(s.sis - s.fis) * s.valor; unidades += s.fis; valor += s.fis * s.valor;
      const mm = s.zona !== s.zonaIdeal; if (mm) { mism++; extraM += (DIST_ZONA[s.zona] - DIST_ZONA[s.zonaIdeal]) * s.visitas; }
      if (s.abc === "A") { nA++; if (mm) mismA++; }
    });
    return { exactitud: sumAcc / all.length, diffVal, mism, mismPct: mism / all.length, mismA: mismA / nA, unidades, valor, extraM, n: all.length };
  };

  /* ---------- UI: inventario ---------- */
  const inv = { q: "", zona: "", abc: "", fam: "", flag: "", sort: "sku", dir: 1, page: 0, size: 20 };
  const fams = [...new Set(base.map((s) => s.fam))].sort();

  function renderKpis() {
    const m = W.metrics();
    $("#wmsKpis").innerHTML = `
      <div class="card kpi navy"><div class="label">Exactitud de inventario</div><div class="value num">${fmt.pct(m.exactitud)}</div><div class="sub">Promedio por SKU (450) · meta 99,2% · ${m.exactitud >= 0.992 ? "cumple" : "bajo meta"}</div></div>
      <div class="card kpi"><div class="label">Diferencia valorizada</div><div class="value num">${fmt.mm(m.diffVal)}</div><div class="sub">|sistema − físico| × valor unitario</div></div>
      <div class="card kpi accent"><div class="label">SKU fuera de zona ideal</div><div class="value num">${fmt.pct(m.mismPct)}</div><div class="sub">${m.mism} SKU · clase A: ${fmt.pct(m.mismA)}</div></div>
      <div class="card kpi"><div class="label">Recorrido extra por slotting</div><div class="value num">${fmt.n(m.extraM / 1000)} km/día</div><div class="sub">Visitas/día × Δ distancia a zona ideal</div></div>`;
  }

  function filtered() {
    const q = inv.q.trim().toLowerCase();
    let rows = W.skus().filter((s) =>
      (!q || s.sku.toLowerCase().includes(q) || s.fam.toLowerCase().includes(q)) &&
      (!inv.zona || s.zona === inv.zona) && (!inv.abc || s.abc === inv.abc) && (!inv.fam || s.fam === inv.fam) &&
      (!inv.flag || (inv.flag === "mismatch" && s.zona !== s.zonaIdeal) || (inv.flag === "dif" && s.sis !== s.fis) ||
        (inv.flag === "mmc" && s.mmc) || (inv.flag === "conteo" && s.diasConteo > 90) || (inv.flag === "interno" && s.codigo !== "EAN-13")));
    const k = inv.sort, d = inv.dir;
    const val = (s) => k === "dif" ? s.sis - s.fis : k === "acc" ? (s.fis ? 1 - Math.abs(s.sis - s.fis) / s.fis : 1) : s[k];
    rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
    return rows;
  }

  function renderInv() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / inv.size));
    inv.page = Math.min(inv.page, pages - 1);
    const slice = rows.slice(inv.page * inv.size, (inv.page + 1) * inv.size);
    const arrow = (k) => (inv.sort === k ? (inv.dir > 0 ? " ▲" : " ▼") : "");
    const th = (k, t, cls = "") => `<th class="sortable ${cls}" data-k="${k}">${t}${arrow(k)}</th>`;
    $("#invTable").innerHTML = `<table><thead><tr>
      ${th("sku", "SKU")}${th("fam", "Familia")}${th("abc", "ABC")}${th("zona", "Zona actual")}${th("zonaIdeal", "Zona ideal")}
      ${th("sis", "Stock sistema", "r")}${th("fis", "Stock físico", "r")}${th("dif", "Dif.", "r")}${th("acc", "Exactitud", "r")}${th("valor", "Valor unit.", "r")}${th("diasConteo", "Días s/conteo", "r")}
      </tr></thead><tbody>${slice.map((s) => {
        const dif = s.sis - s.fis, acc = s.fis ? 1 - Math.abs(dif) / s.fis : 1;
        return `<tr class="clickable" data-sku="${s.sku}">
          <td><b>${s.sku}</b>${s.mmc ? ' <span class="badge b-warn" title="Manipulación manual > 25 kg">MMC</span>' : ""}</td>
          <td>${esc(s.fam)}</td><td><span class="badge ${s.abc === "A" ? "b-info" : s.abc === "B" ? "b-neutral" : "b-neutral"}">${s.abc}</span></td>
          <td>${s.zona}</td><td>${s.zona === s.zonaIdeal ? '<span class="badge b-good">✓ ' + s.zonaIdeal + "</span>" : '<span class="badge b-accent">→ ' + s.zonaIdeal + "</span>"}</td>
          <td class="r num">${fmt.n(s.sis)}</td><td class="r num">${fmt.n(s.fis)}</td>
          <td class="r num" style="color:${dif === 0 ? "inherit" : "var(--bad)"}">${dif > 0 ? "+" : ""}${fmt.n(dif)}</td>
          <td class="r"><span class="badge ${acc >= 0.992 ? "b-good" : acc >= 0.97 ? "b-warn" : "b-bad"}">${fmt.pct(acc)}</span></td>
          <td class="r num">${fmt.clp(s.valor)}</td>
          <td class="r num" style="color:${s.diasConteo > 90 ? "var(--bad)" : "inherit"}">${s.diasConteo}</td></tr>`;
      }).join("") || `<tr><td colspan="11" class="empty">Sin resultados para el filtro.</td></tr>`}</tbody></table>`;
    $("#invPager").innerHTML = `<span>${fmt.n(rows.length)} SKU · página ${inv.page + 1} de ${pages}</span>
      <span class="toolbar"><button class="btn ghost sm" data-p="-1" ${inv.page === 0 ? "disabled" : ""}>← Anterior</button><button class="btn ghost sm" data-p="1" ${inv.page >= pages - 1 ? "disabled" : ""}>Siguiente →</button></span>`;
  }

  function skuDrawer(code) {
    const s = W.get(code);
    const movs = AH.state.movs.filter((m) => m.sku === code).slice(0, 8);
    const body = AH.openDrawer(s.sku, `${s.fam} · Clase ${s.abc} · ${s.codigo}`, `
      <div class="kv">
        <div><span>Zona actual</span><b>${s.zona}</b></div><div><span>Zona ideal</span><b>${s.zonaIdeal}</b></div>
        <div><span>Stock sistema</span><b class="num">${fmt.n(s.sis)}</b></div><div><span>Stock físico</span><b class="num">${fmt.n(s.fis)}</b></div>
        <div><span>Demanda mensual</span><b class="num">${fmt.n(s.dem)} u</b></div><div><span>CV demanda</span><b>${fmt.n2(s.cv)}</b></div>
        <div><span>Visitas pick/día</span><b>${fmt.n1(s.visitas)}</b></div><div><span>Distancia pick</span><b>${fmt.n(s.dist)} m</b></div>
        <div><span>Dimensiones (cm)</span><b>${s.dims.join(" × ")}</b></div><div><span>Peso</span><b>${fmt.n1(s.peso)} kg ${s.mmc ? "· MMC" : ""}</b></div>
        <div><span>Valor unitario</span><b>${fmt.clp(s.valor)}</b></div><div><span>Valor en stock</span><b>${fmt.mm(s.fis * s.valor)}</b></div>
      </div>
      ${s.zona !== s.zonaIdeal ? `<div class="note warn mt">Este SKU está en <b>${s.zona}</b> y su zona ideal por rotación es <b>${s.zonaIdeal}</b>. Reubicarlo ahorra ≈ <b>${fmt.n((DIST_ZONA[s.zona] - DIST_ZONA[s.zonaIdeal]) * s.visitas)} m</b> de recorrido al día.</div>` : ""}
      <div class="section-title">Conteo cíclico</div>
      <div class="toolbar"><input id="dCount" type="number" min="0" placeholder="Unidades contadas" value="${s.fis}"><button class="btn" id="dCountBtn">Registrar conteo</button></div>
      <p class="hint" style="margin-top:6px">Último conteo hace ${s.diasConteo} días. Ajusta el stock de sistema al conteo físico.</p>
      <div class="section-title">Reubicación</div>
      <div class="toolbar"><select id="dZona">${ZONAS.map((z) => `<option ${z === s.zona ? "selected" : ""}>${z}</option>`).join("")}</select><button class="btn" id="dMoveBtn">Mover</button></div>
      <div class="section-title">Movimiento manual</div>
      <div class="toolbar"><input id="dQty" type="number" min="1" placeholder="Cantidad"><button class="btn good" id="dIn">+ Ingreso</button><button class="btn danger" id="dOut">− Salida</button></div>
      <div class="section-title">Últimos movimientos</div>
      ${movs.length ? `<div class="table-wrap"><table><tbody>${movs.map((m) => `<tr><td>${new Date(m.ts).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}</td><td>${m.tipo}</td><td class="r num">${m.cant > 0 ? "+" : ""}${fmt.n(m.cant)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted small">Sin movimientos registrados en esta sesión.</p>'}`);
    const done = (msg) => { AH.save(); AH.toast(msg, "good"); refresh(); skuDrawer(code); };
    $("#dCountBtn", body).onclick = () => { const v = parseInt($("#dCount", body).value, 10); if (isNaN(v) || v < 0) return AH.toast("Ingresa un conteo válido", "bad"); W.count(code, v); done("Conteo registrado"); };
    $("#dMoveBtn", body).onclick = () => { if (W.relocate(code, $("#dZona", body).value)) done("SKU reubicado"); };
    $("#dIn", body).onclick = () => { const q = parseInt($("#dQty", body).value, 10); if (!(q > 0)) return AH.toast("Cantidad inválida", "bad"); W.receive(code, q, "Manual"); done("Ingreso registrado"); };
    $("#dOut", body).onclick = () => { const q = parseInt($("#dQty", body).value, 10); if (!(q > 0)) return AH.toast("Cantidad inválida", "bad"); if (!W.issue(code, q, "Manual")) return AH.toast("Stock físico insuficiente", "bad"); done("Salida registrada"); };
  }

  /* ---------- UI: ubicaciones ---------- */
  function renderZonas() {
    const all = W.skus();
    const by = {}; ZONAS.forEach((z) => (by[z] = { n: 0, u: 0, v: 0, mm: 0, vis: 0 }));
    all.forEach((s) => { const b = by[s.zona]; b.n++; b.u += s.fis; b.v += s.fis * s.valor; b.vis += s.visitas; if (s.zona !== s.zonaIdeal) b.mm++; });
    const lay = Object.fromEntries(D.layout.map((l) => [l.Zona, l]));
    $("#zoneCards").innerHTML = D.layout.map((l) => {
      const b = by[l.Zona];
      const u = l.Utilización;
      return `<div class="card zone-card">
        <h3>${l.Zona} <span class="badge ${u >= 0.95 ? "b-bad" : u >= 0.9 ? "b-warn" : "b-good"}">${fmt.pct(u)}</span></h3>
        <p class="muted small">${l.Función} · ${fmt.n(l["Área m2"])} m² · ${esc(l.Observación)}</p>
        <div class="bar-mini mt"><i style="width:${Math.min(100, u * 100)}%;background:${u >= 0.95 ? "var(--bad)" : u >= 0.9 ? "var(--s4)" : "var(--s3)"}"></i></div>
        <p class="small mt">Capacidad ${fmt.n(l["Capacidad operativa"])} · uso ${fmt.n(l["Uso actual"])}${l["Distancia media m"] ? " · distancia media " + l["Distancia media m"] + " m" : ""}</p>
        ${b ? `<p class="small" style="margin-top:6px"><b>${b.n}</b> SKU muestra · <b>${fmt.n(b.u)}</b> u · ${fmt.mm(b.v)} · <b>${fmt.n(b.vis)}</b> visitas/día · <span style="color:${b.mm ? "var(--bad)" : "inherit"}">${b.mm} fuera de zona</span></p>` : ""}
      </div>`;
    }).join("");
    // matriz zona actual vs ideal
    const mat = {}; ZONAS.forEach((a) => ZONAS.forEach((b) => (mat[a + b] = 0)));
    all.forEach((s) => mat[s.zona + s.zonaIdeal]++);
    $("#slotMatrix").innerHTML = `<table><thead><tr><th>Actual \\ Ideal</th>${ZONAS.map((z) => `<th class="r">${z}</th>`).join("")}</tr></thead><tbody>
      ${ZONAS.map((a) => `<tr><td><b>${a}</b></td>${ZONAS.map((b) => { const v = mat[a + b]; return `<td class="r num" style="background:${a === b ? "#e1f5ec" : v ? `rgba(235,104,52,${Math.min(0.5, v / 60)})` : "transparent"}">${v}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
    $("#mheTable").innerHTML = `<table><thead><tr><th>Equipo</th><th class="r">Unidades</th><th class="r">Disponibles</th><th class="r">Operativas peak</th><th class="r">Disponibilidad</th><th>Hallazgo</th></tr></thead><tbody>
      ${D.mhe.map((m) => `<tr><td><b>${m.Equipo}</b></td><td class="r">${m.Unidades}</td><td class="r">${m.Disponibles}</td><td class="r">${m["Operativas peak"]}</td><td class="r"><span class="badge ${m.Disponibilidad >= 0.85 ? "b-good" : m.Disponibilidad >= 0.8 ? "b-warn" : "b-bad"}">${fmt.pct(m.Disponibilidad, 0)}</span></td><td>${esc(m.Hallazgo)}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------- UI: movimientos ---------- */
  function renderMovs() {
    const t = $("#movFilter").value;
    const rows = AH.state.movs.filter((m) => !t || m.tipo === t);
    $("#movTable").innerHTML = rows.length ? `<table><thead><tr><th>ID</th><th>Fecha y hora</th><th>Tipo</th><th>SKU</th><th class="r">Cantidad</th><th>Detalle</th><th>Referencia</th></tr></thead><tbody>
      ${rows.slice(0, 300).map((m) => `<tr><td>${m.id}</td><td>${new Date(m.ts).toLocaleString("es-CL")}</td><td><span class="badge ${m.tipo === "Recepción" ? "b-good" : m.tipo === "Salida" ? "b-bad" : m.tipo === "Reubicación" ? "b-info" : "b-warn"}">${m.tipo}</span></td><td><b>${m.sku}</b></td><td class="r num">${m.cant > 0 ? "+" : ""}${fmt.n(m.cant)}</td><td>${esc(m.detalle)}</td><td>${esc(m.ref)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Aún no hay movimientos. Registra un conteo, una reubicación o cierra una cita de recepción en Agendamiento para verlos aquí.</div>`;
  }

  /* ---------- UI: órdenes ---------- */
  const O = window.AH_ORD; // [id, creación, canal, región, prioridad, líneas, unidades, promesa, aTiempo, perfecto, cancelado, venta, costo, peak]
  const linesBy = {}; window.AH_LIN.forEach((l) => (linesBy[l[0]] ||= []).push(l));
  const ord = { q: "", canal: "", perf: "", peak: "", page: 0, size: 15 };
  function renderOrd() {
    const q = ord.q.trim().toUpperCase();
    const rows = O.filter((o) => (!q || o[0].includes(q)) && (!ord.canal || o[2] === ord.canal) &&
      (ord.perf === "" || String(o[9]) === ord.perf) && (ord.peak === "" || String(o[13]) === ord.peak));
    const n = rows.length, perf = rows.filter((o) => o[9]).length;
    const cP = rows.filter((o) => o[9]), cN = rows.filter((o) => !o[9]);
    const avg = (a) => a.reduce((s, o) => s + o[12], 0) / (a.length || 1);
    $("#ordKpis").innerHTML = `<span class="badge b-info">${fmt.n(n)} órdenes</span>
      <span class="badge ${perf / n >= 0.9 ? "b-good" : "b-warn"}">Pedido perfecto ${fmt.pct(perf / (n || 1))}</span>
      <span class="badge b-neutral">Costo log. perfecto ${fmt.clp(avg(cP))}</span><span class="badge b-bad">No perfecto ${fmt.clp(avg(cN))}</span>`;
    const pages = Math.max(1, Math.ceil(n / ord.size)); ord.page = Math.min(ord.page, pages - 1);
    $("#ordTable").innerHTML = `<table><thead><tr><th>Pedido</th><th>Creación</th><th>Canal</th><th>Región</th><th>Prioridad</th><th class="r">Líneas</th><th class="r">Unid.</th><th class="r">Promesa</th><th>A tiempo</th><th>Perfecto</th><th class="r">Venta</th><th class="r">Costo log.</th></tr></thead><tbody>
      ${rows.slice(ord.page * ord.size, (ord.page + 1) * ord.size).map((o) => `<tr class="clickable" data-o="${o[0]}"><td><b>${o[0]}</b>${o[13] ? ' <span class="badge b-accent">Peak</span>' : ""}</td><td>${o[1]}</td>
        <td><span class="dot" style="background:${AH.canalColor[o[2]]}"></span> ${o[2]}</td><td>${o[3]}</td><td>${o[4] === "Alta" ? '<span class="badge b-warn">Alta</span>' : "Normal"}</td>
        <td class="r">${o[5]}</td><td class="r">${o[6]}</td><td class="r">${o[7]} h</td><td>${o[8] ? "✓" : '<span style="color:var(--bad)">✗</span>'}</td>
        <td>${o[10] ? '<span class="badge b-neutral">Cancelado</span>' : o[9] ? '<span class="badge b-good">Sí</span>' : '<span class="badge b-bad">No</span>'}</td>
        <td class="r num">${fmt.clp(o[11])}</td><td class="r num">${fmt.clp(o[12])}</td></tr>`).join("") || '<tr><td colspan="12" class="empty">Sin órdenes.</td></tr>'}</tbody></table>`;
    $("#ordPager").innerHTML = `<span>Página ${ord.page + 1} de ${pages}</span><span class="toolbar"><button class="btn ghost sm" data-p="-1" ${ord.page === 0 ? "disabled" : ""}>← Anterior</button><button class="btn ghost sm" data-p="1" ${ord.page >= pages - 1 ? "disabled" : ""}>Siguiente →</button></span>`;
  }
  function ordDrawer(id) {
    const o = O.find((x) => x[0] === id); const ls = linesBy[id] || [];
    AH.openDrawer(id, `${o[2]} · ${o[3]} · creado ${o[1]}`, `
      <div class="kv"><div><span>Promesa</span><b>${o[7]} h</b></div><div><span>Prioridad</span><b>${o[4]}</b></div>
      <div><span>Venta</span><b>${fmt.clp(o[11])}</b></div><div><span>Costo logístico</span><b>${fmt.clp(o[12])}</b></div></div>
      <div class="section-title">Líneas de picking (${ls.length})</div>
      <div class="table-wrap"><table><thead><tr><th>SKU</th><th>Zona</th><th class="r">Pedida</th><th class="r">Preparada</th><th class="r">Pick s</th><th class="r">Dist. m</th><th>Error</th></tr></thead><tbody>
      ${ls.map((l) => `<tr><td><b>${l[1]}</b> <span class="badge b-neutral">${l[2]}</span></td><td>${l[3]}</td><td class="r">${l[4]}</td><td class="r" style="color:${l[5] < l[4] ? "var(--bad)" : "inherit"}">${l[5]}</td><td class="r">${fmt.n1(l[7])}</td><td class="r">${fmt.n(l[9])}</td><td>${l[6] ? '<span class="badge b-bad">Sí</span>' : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint mt">Total recorrido estimado: ${fmt.n(ls.reduce((s, l) => s + l[9], 0))} m · tiempo de pick ${fmt.min(ls.reduce((s, l) => s + l[7], 0) / 60)}</p>`);
  }

  /* ---------- UI: calidad de datos ---------- */
  function renderDQ() {
    $("#dqTable").innerHTML = `<table><thead><tr><th>ID</th><th>Hoja</th><th>Registro</th><th>Hallazgo</th><th>Criticidad</th><th>Acción sugerida</th></tr></thead><tbody>
      ${window.AH_DQ.map((d) => `<tr><td><b>${d.ID}</b></td><td>${d.Hoja}</td><td>${d["Registro/segmento"]}</td><td style="white-space:normal">${esc(d.Hallazgo)}</td><td><span class="badge ${d.Criticidad === "Alta" ? "b-bad" : "b-warn"}">${d.Criticidad}</span></td><td style="white-space:normal">${esc(d["Acción sugerida de validación"])}</td></tr>`).join("")}</tbody></table>`;
  }

  function refresh() { renderKpis(); renderInv(); renderZonas(); renderMovs(); }
  W.refresh = refresh;

  /* ---------- init ---------- */
  W.init = () => {
    const root = $("#view-wms");
    AH.bindTabs(root);
    $("#invFam").innerHTML = `<option value="">Todas las familias</option>` + fams.map((f) => `<option>${f}</option>`).join("");
    $("#invZona").innerHTML = `<option value="">Todas las zonas</option>` + ZONAS.map((z) => `<option>${z}</option>`).join("");
    const bind = (id, key, obj, render) => $(id).addEventListener("input", (e) => { obj[key] = e.target.value; obj.page = 0; render(); });
    bind("#invQ", "q", inv, renderInv); bind("#invZona", "zona", inv, renderInv); bind("#invAbc", "abc", inv, renderInv);
    bind("#invFam", "fam", inv, renderInv); bind("#invFlag", "flag", inv, renderInv);
    $("#invTable").addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (th) { const k = th.dataset.k; inv.dir = inv.sort === k ? -inv.dir : 1; inv.sort = k; renderInv(); return; }
      const tr = e.target.closest("tr[data-sku]"); if (tr) skuDrawer(tr.dataset.sku);
    });
    $("#invPager").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { inv.page += +b.dataset.p; renderInv(); } });
    $("#invExport").onclick = () => AH.downloadCSV("inventario_andeshome.csv", [["SKU", "Familia", "ABC", "Zona actual", "Zona ideal", "Stock sistema", "Stock fisico", "Valor unitario", "Dias desde conteo"],
      ...filtered().map((s) => [s.sku, s.fam, s.abc, s.zona, s.zonaIdeal, s.sis, s.fis, s.valor, s.diasConteo])]);
    $("#reslotBtn").onclick = () => {
      const mm = W.skus().filter((s) => s.zona !== s.zonaIdeal);
      if (!mm.length) return AH.toast("Todos los SKU ya están en su zona ideal");
      if (!confirm(`Se reubicarán ${mm.length} SKU a su zona ideal según rotación ABC. ¿Continuar?`)) return;
      const ahorro = W.metrics().extraM;
      mm.forEach((s) => { W.relocate(s.sku, s.zonaIdeal, true); });
      W.log("Reubicación", "MASIVO", 0, `Re-slotting ABC de ${mm.length} SKU · ahorro ≈ ${fmt.n(ahorro / 1000)} km/día`, "I6");
      AH.save(); refresh(); AH.toast(`Re-slotting aplicado a ${mm.length} SKU`, "good"); AH.emit("wms-changed");
    };
    $("#movFilter").addEventListener("change", renderMovs);
    $("#movExport").onclick = () => AH.downloadCSV("movimientos_wms.csv", [["ID", "Fecha", "Tipo", "SKU", "Cantidad", "Detalle", "Referencia"], ...AH.state.movs.map((m) => [m.id, m.ts, m.tipo, m.sku, m.cant, m.detalle, m.ref])]);
    // órdenes
    $("#ordCanal").innerHTML = `<option value="">Todos los canales</option>` + Object.keys(AH.canalColor).map((c) => `<option>${c}</option>`).join("");
    bind("#ordQ", "q", ord, renderOrd); bind("#ordCanal", "canal", ord, renderOrd); bind("#ordPerf", "perf", ord, renderOrd); bind("#ordPeak", "peak", ord, renderOrd);
    $("#ordTable").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-o]"); if (tr) ordDrawer(tr.dataset.o); });
    $("#ordPager").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { ord.page += +b.dataset.p; renderOrd(); } });
    renderOrd(); renderDQ(); refresh();
    AH.on("wms-changed", refresh);
  };
})();
