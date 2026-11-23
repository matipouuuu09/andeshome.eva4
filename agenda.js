/* =========================================================
   agenda.js — Agendamiento de camiones en línea (YMS ligero)
   Andenes, bloques horarios, validaciones, check-in y cierre
   integrado con el Mini WMS. Base: hojas Recepciones,
   Proveedores, Transportistas y Rutas.
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const D = window.AH_DASH;
  const REC = window.AH_REC;

  /* ---------- configuración operativa ---------- */
  const CFG = {
    andenes: 24,
    rec: { andenes: [1, 12], desde: 6 * 60, hasta: 18 * 60 },   // recepción 06:00–18:00
    des: { andenes: [13, 24], desde: 6 * 60, hasta: 22 * 60 },  // despacho 06:00–22:00
    paso: 30,
  };
  const VEH = {
    "Furgón": { pallets: 6 }, "Camión 3/4": { pallets: 10 }, "Camión 12 t": { pallets: 16 }, "Rampla / contenedor 40'": { pallets: 26 },
  };
  const CARGA = { "Paletizada": 1, "Mixta": 1.35, "Granel / a piso": 1.9, "Bulky": 1.5 };
  const proveedores = D.proveedores.map((p) => p.Proveedor);
  const provInfo = Object.fromEntries(D.proveedores.map((p) => [p.Proveedor, p]));
  const transportistas = [...new Set(D.transportistas.map((t) => t.Transportista))];
  const zonasDestino = [...new Set(D.transportistas.map((t) => t.Zona))];

  // tiempos base derivados de la hoja Recepciones (min por pallet de descarga)
  const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const minPallet = avg(REC.map((r) => r.descarga / r.pallets));          // ≈ 4,0 min/pallet
  const qcPallet = avg(REC.map((r) => r.qc / r.pallets));

  /** Duración estimada de la operación en andén (min), redondeada al bloque */
  const duracion = (tipo, pallets, carga) => {
    const base = 20; // maniobra, documentación y sello
    const porPallet = tipo === "rec" ? minPallet : minPallet * 0.75;
    const raw = base + pallets * porPallet * (CARGA[carga] || 1);
    return Math.max(CFG.paso, Math.ceil(raw / CFG.paso) * CFG.paso);
  };

  const A = AH.agenda = {};
  const activa = (c) => !["cancelada", "noshow"].includes(c.estado);
  A.citasDe = (fecha) => AH.state.citas.filter((c) => c.fecha === fecha);

  /** andenes libres para [ini, ini+dur) */
  const libres = (fecha, tipo, ini, dur, ignoreId) => {
    const [a, b] = CFG[tipo].andenes;
    const occ = A.citasDe(fecha).filter((c) => activa(c) && c.id !== ignoreId);
    const out = [];
    for (let n = a; n <= b; n++) {
      const choque = occ.some((c) => c.anden === n && ini < c.ini + c.dur && c.ini < ini + dur);
      if (!choque) out.push(n);
    }
    return out;
  };

  const nuevoCodigo = (fecha) => {
    const n = AH.state.citas.filter((c) => c.fecha === fecha).length + 1;
    return `AH-${fecha.replace(/-/g, "").slice(2)}-${String(n).padStart(3, "0")}`;
  };

  /* ---------- semilla: citas de ejemplo construidas desde la base ---------- */
  function seed() {
    if (AH.state.seeded) return;
    const rnd = AH.rng(20261123);
    const hoy = AH.today();
    const placas = () => { const L = "BCDFGHJKLPRSTVWXYZ"; let p = ""; for (let i = 0; i < 4; i++) p += L[Math.floor(rnd() * L.length)]; return p + String(Math.floor(rnd() * 90) + 10); };
    const nombres = ["Juan Pérez", "Luis Soto", "Carlos Muñoz", "Pedro Rojas", "Marcela Díaz", "Jorge Contreras", "Andrés Silva", "Claudia Morales", "Felipe Araya", "Rodrigo Fuentes"];
    const ruts = ["12345678-5", "15678234-2", "9876543-3", "16789012-K", "13456789-0", "17890123-9", "11222333-9", "18765432-7"];
    for (let d = 0; d < 3; d++) {
      const fecha = AH.addDays(hoy, d);
      // recepciones: muestra de la hoja Recepciones manteniendo hora de cita, proveedor, pallets y ASN
      const pool = [...REC].sort(() => rnd() - 0.5).slice(0, 16);
      pool.forEach((r) => {
        const carga = r.pallets > 18 ? "Mixta" : "Paletizada";
        const veh = r.pallets <= 6 ? "Furgón" : r.pallets <= 10 ? "Camión 3/4" : r.pallets <= 16 ? "Camión 12 t" : "Rampla / contenedor 40'";
        const dur = duracion("rec", r.pallets, carga);
        let ini = AH.toMin(r.cita);
        let la = libres(fecha, "rec", ini, dur);
        if (!la.length) { ini += 60; la = libres(fecha, "rec", ini, dur); }
        if (!la.length || ini + dur > CFG.rec.hasta) return;
        const skus = [...window.AH_SKU].sort(() => rnd() - 0.5).slice(0, 2).map((s) => ({ sku: s.sku, cant: Math.max(10, Math.round(r.unidades / 2)) }));
        AH.state.citas.push({
          id: nuevoCodigo(fecha), fecha, tipo: "rec", contraparte: r.proveedor, origen: r.origenTipo === "Importado" ? provInfo[r.proveedor]?.Origen || "Importado" : r.origen,
          vehiculo: veh, patente: placas(), conductor: nombres[Math.floor(rnd() * nombres.length)], rut: ruts[Math.floor(rnd() * ruts.length)], fono: "+56 9 " + Math.floor(rnd() * 9e7 + 1e7),
          pallets: r.pallets, unidades: r.unidades, carga, asn: r.asn === "Sí" ? `ASN-${r.id.slice(4)}${d}` : "", skus,
          ini, dur, anden: la[0], estado: "programada", hist: r.id, atrasoHist: r.atrasoMin, obs: "", creada: new Date().toISOString(),
        });
      });
      // despachos: rutas de los 3 transportistas
      for (let k = 0; k < 12; k++) {
        const tr = transportistas[k % transportistas.length];
        const pallets = 4 + Math.floor(rnd() * 12);
        const veh = pallets <= 6 ? "Furgón" : pallets <= 10 ? "Camión 3/4" : "Camión 12 t";
        const dur = duracion("des", pallets, "Paletizada");
        const ini = CFG.des.desde + Math.floor(rnd() * 26) * 30;
        const la = libres(fecha, "des", ini, dur);
        if (!la.length || ini + dur > CFG.des.hasta) continue;
        AH.state.citas.push({
          id: nuevoCodigo(fecha), fecha, tipo: "des", contraparte: tr, origen: zonasDestino[Math.floor(rnd() * zonasDestino.length)],
          vehiculo: veh, patente: placas(), conductor: nombres[Math.floor(rnd() * nombres.length)], rut: ruts[Math.floor(rnd() * ruts.length)], fono: "+56 9 " + Math.floor(rnd() * 9e7 + 1e7),
          pallets, unidades: pallets * 60, carga: "Paletizada", asn: "", skus: [], ini, dur, anden: la[0], estado: "programada", obs: "", creada: new Date().toISOString(),
        });
      }
    }
    // estados coherentes con la hora actual para hoy
    const now = AH.nowMin();
    A.citasDe(hoy).forEach((c) => {
      const atraso = Math.max(-30, Math.min(90, c.atrasoHist ?? Math.round((rnd() - 0.4) * 40)));
      if (c.ini + c.dur + 30 < now) { c.estado = "cerrada"; c.arribo = c.ini + atraso; c.inicioOp = Math.max(c.ini, c.arribo); c.fin = c.inicioOp + c.dur; }
      else if (c.ini <= now && now < c.ini + c.dur + 30) { c.estado = "descargando"; c.arribo = c.ini + Math.min(atraso, now - c.ini); c.inicioOp = Math.max(c.ini, c.arribo); }
    });
    AH.state.seeded = true;
    AH.save();
  }

  /* ---------- formulario ---------- */
  const form = { tipo: "rec", slot: null, skus: [] };

  function fillSelects() {
    $("#fContraparte").innerHTML = (form.tipo === "rec" ? proveedores : transportistas).map((p) => `<option>${p}</option>`).join("");
    $("#fOrigen").innerHTML = form.tipo === "rec"
      ? ["RM", "Valparaíso", "O'Higgins", "Maule", "Biobío", "Puerto San Antonio", "Puerto Valparaíso"].map((o) => `<option>${o}</option>`).join("")
      : zonasDestino.map((z) => `<option>${z}</option>`).join("");
    $("#lblContraparte").textContent = form.tipo === "rec" ? "Proveedor *" : "Transportista *";
    $("#lblOrigen").textContent = form.tipo === "rec" ? "Origen de la carga" : "Zona de destino";
    $$(".only-rec").forEach((e) => (e.style.display = form.tipo === "rec" ? "" : "none"));
    provHint();
  }
  function provHint() {
    if (form.tipo !== "rec") { $("#provHint").innerHTML = ""; return; }
    const p = provInfo[$("#fContraparte").value]; if (!p) return;
    const asn = p["Cumplimiento ASN"];
    $("#provHint").innerHTML = `${p.Origen} · ${p.Segmento} · ASN histórico <b style="color:${asn < 0.6 ? "var(--bad)" : "inherit"}">${fmt.pct(asn, 0)}</b> · a tiempo ${fmt.pct(p["Entrega a tiempo"], 0)} · dock-to-stock ${fmt.n1(p["Dock-to-stock h"])} h`;
  }

  const getDur = () => duracion(form.tipo, Math.max(1, +$("#fPallets").value || 1), $("#fCarga").value);

  function renderSlots() {
    const fecha = $("#fFecha").value;
    const dur = getDur();
    $("#durHint").textContent = `Tiempo estimado en andén: ${fmt.min(dur)} (20 min maniobra + ${fmt.n1(form.tipo === "rec" ? minPallet : minPallet * 0.75)} min/pallet según historial de recepciones).`;
    if (!fecha) { $("#slotGrid").innerHTML = '<p class="hint">Selecciona una fecha.</p>'; return; }
    const { desde, hasta } = CFG[form.tipo];
    const esHoy = fecha === AH.today(), now = AH.nowMin();
    let html = "";
    for (let t = desde; t + dur <= hasta; t += CFG.paso) {
      const n = libres(fecha, form.tipo, t, dur).length;
      const past = esHoy && t < now + 30;
      const dis = n === 0 || past;
      if (form.slot === t && dis) form.slot = null;
      html += `<button type="button" class="slot ${form.slot === t ? "on" : ""} ${n > 0 && n <= 2 ? "low" : ""}" data-t="${t}" ${dis ? "disabled" : ""}>${fmt.hhmm(t)}<small>${past ? "pasado" : n + " libres"}</small></button>`;
    }
    $("#slotGrid").innerHTML = html || '<p class="hint">No hay bloques que permitan esta duración.</p>';
    renderAndenSelect();
  }
  function renderAndenSelect() {
    const fecha = $("#fFecha").value;
    const sel = $("#fAnden");
    if (form.slot == null) { sel.innerHTML = `<option value="">Selecciona un bloque</option>`; return; }
    const la = libres(fecha, form.tipo, form.slot, getDur());
    sel.innerHTML = `<option value="">Automático (andén ${la[0]})</option>` + la.map((n) => `<option value="${n}">Andén ${n}</option>`).join("");
  }

  function renderSkuRows() {
    $("#skuRows").innerHTML = form.skus.map((s, i) => `<div class="toolbar" style="margin-bottom:6px">
      <input list="skuList" placeholder="SKU (ej. SKU-0001)" value="${esc(s.sku)}" data-i="${i}" data-f="sku" style="flex:2;min-width:0">
      <input type="number" min="1" placeholder="Cant." value="${s.cant || ""}" data-i="${i}" data-f="cant" style="flex:1;min-width:0">
      <button type="button" class="btn ghost sm" data-rm="${i}">✕</button></div>`).join("");
  }

  function validar() {
    const err = {};
    const v = (id) => $(id).value.trim();
    if (!v("#fFecha")) err.fFecha = "Indica la fecha.";
    else if (v("#fFecha") < AH.today()) err.fFecha = "La fecha no puede ser pasada.";
    if (form.slot == null) err.slot = "Elige un bloque horario disponible.";
    if (!AH.validPatente(v("#fPatente"))) err.fPatente = "Patente chilena inválida (ej. ABCD12 o AB1234).";
    if (v("#fConductor").length < 3) err.fConductor = "Nombre del conductor requerido.";
    if (!AH.validRut(v("#fRut"))) err.fRut = "RUT inválido (revisa el dígito verificador).";
    if (!/^\+?56\s?9\s?\d{4}\s?\d{4}$/.test(v("#fFono").replace(/\s+/g, " ")) && !/^\+?569\d{8}$/.test(v("#fFono").replace(/\s/g, ""))) err.fFono = "Formato +56 9 XXXX XXXX.";
    const pallets = +v("#fPallets");
    const max = VEH[v("#fVehiculo")].pallets;
    if (!(pallets >= 1)) err.fPallets = "Ingresa al menos 1 pallet.";
    else if (pallets > max) err.fPallets = `Un ${v("#fVehiculo")} admite hasta ${max} pallets.`;
    if (!(+v("#fUnidades") >= 1)) err.fUnidades = "Ingresa las unidades.";
    if (form.tipo === "rec") {
      const asn = v("#fAsn");
      if (AH.state.config.exigirASN && !asn) err.fAsn = "Política vigente: toda recepción requiere ASN.";
      if (asn && !/^ASN-[\w-]{3,}$/i.test(asn)) err.fAsn = "Formato ASN-XXXX.";
      form.skus.forEach((s) => { if (s.sku && !AH.wms.get(s.sku.toUpperCase())) err.skus = `SKU ${s.sku} no existe en el maestro.`; });
    }
    $$("#agendaForm .invalid").forEach((e) => e.classList.remove("invalid"));
    $$("#agendaForm .err-msg").forEach((e) => (e.textContent = ""));
    Object.entries(err).forEach(([k, m]) => { const inp = $("#" + k); if (inp) inp.classList.add("invalid"); const em = $(`[data-err="${k}"]`); if (em) em.textContent = m; });
    return Object.keys(err).length === 0;
  }

  function submit(e) {
    e.preventDefault();
    if (!validar()) { AH.toast("Revisa los campos marcados", "bad"); return; }
    const fecha = $("#fFecha").value, dur = getDur();
    const la = libres(fecha, form.tipo, form.slot, dur);
    const anden = +$("#fAnden").value || la[0];
    if (!la.includes(anden)) { AH.toast("El andén ya no está disponible, elige otro bloque", "bad"); renderSlots(); return; }
    const c = {
      id: nuevoCodigo(fecha), fecha, tipo: form.tipo, contraparte: $("#fContraparte").value, origen: $("#fOrigen").value,
      vehiculo: $("#fVehiculo").value, patente: $("#fPatente").value.replace(/[\s-]/g, "").toUpperCase(), conductor: $("#fConductor").value.trim(),
      rut: AH.formatRut($("#fRut").value), fono: $("#fFono").value.trim(), pallets: +$("#fPallets").value, unidades: +$("#fUnidades").value,
      carga: $("#fCarga").value, asn: form.tipo === "rec" ? $("#fAsn").value.trim().toUpperCase() : "",
      skus: form.tipo === "rec" ? form.skus.filter((s) => s.sku && s.cant > 0).map((s) => ({ sku: s.sku.toUpperCase(), cant: +s.cant })) : [],
      ini: form.slot, dur, anden, estado: "programada", obs: $("#fObs").value.trim(), creada: new Date().toISOString(),
    };
    AH.state.citas.push(c); AH.save();
    ticket(c);
    $("#agendaForm").reset(); form.slot = null; form.skus = []; renderSkuRows();
    $("#fFecha").value = fecha; fillSelects(); renderSlots();
    state.fecha = fecha; $("#agDate").value = fecha; renderBoard();
    AH.emit("agenda-changed");
  }

  function ticket(c) {
    const body = AH.openDrawer("Cita confirmada", "Comprobante de reserva de andén", `
      <div class="ticket">
        <p class="eyebrow">Código de reserva</p><p class="code">${c.id}</p>
        <div class="kv mt">
          <div><span>Fecha</span><b>${AH.dateLabel(c.fecha)}</b></div><div><span>Horario</span><b>${fmt.hhmm(c.ini)} – ${fmt.hhmm(c.ini + c.dur)}</b></div>
          <div><span>Andén</span><b>N° ${c.anden}</b></div><div><span>Operación</span><b>${c.tipo === "rec" ? "Recepción" : "Despacho"}</b></div>
          <div><span>${c.tipo === "rec" ? "Proveedor" : "Transportista"}</span><b>${esc(c.contraparte)}</b></div><div><span>Vehículo</span><b>${esc(c.vehiculo)} · ${c.patente}</b></div>
          <div><span>Conductor</span><b>${esc(c.conductor)}</b></div><div><span>RUT</span><b>${c.rut}</b></div>
          <div><span>Carga</span><b>${c.pallets} pallets · ${fmt.n(c.unidades)} u</b></div><div><span>ASN</span><b>${c.asn || (c.tipo === "rec" ? "Sin ASN" : "No aplica")}</b></div>
        </div>
        <p class="hint mt">Presentarse en portería 15 minutos antes. Tolerancia de atraso: 30 minutos; pasado ese plazo la cita puede reasignarse. CD Pudahuel · AndesHome Chile S.A.</p>
      </div>
      ${c.tipo === "rec" && !c.asn ? `<div class="note warn mt">Recepción sin ASN: el historial muestra un dock-to-stock de ${fmt.n2(dts.sin)} h sin ASN ni cita, frente a ${fmt.n2(dts.ambos)} h con ambos.</div>` : ""}
      <div class="toolbar mt"><button class="btn" id="tPrint">Imprimir comprobante</button><button class="btn ghost" id="tClose">Cerrar</button></div>`);
    $("#tPrint", body).onclick = () => {
      const w = window.open("", "_blank", "width=640,height=760");
      if (!w) return AH.toast("Permite ventanas emergentes para imprimir", "bad");
      w.document.write(`<html><head><title>${c.id}</title><link rel="stylesheet" href="css/styles.css"></head><body style="background:#fff;padding:24px">${$(".ticket", body).outerHTML}<script>setTimeout(()=>print(),400)<\/script></body></html>`);
      w.document.close();
    };
    $("#tClose", body).onclick = AH.closeDrawer;
  }

  /* ---------- tablero del día ---------- */
  const state = { fecha: AH.today(), q: "", tipo: "" };
  const ESTADOS = { programada: ["Programada", "b-info"], enpuerta: ["En portería", "b-warn"], descargando: ["En andén", "b-accent"], cerrada: ["Cerrada", "b-good"], noshow: ["No-show", "b-bad"], cancelada: ["Cancelada", "b-neutral"] };

  function renderBoard() {
    const all = A.citasDe(state.fecha).sort((a, b) => a.ini - b.ini || a.anden - b.anden);
    // KPIs del día
    const act = all.filter(activa);
    const rec = act.filter((c) => c.tipo === "rec");
    const conAsn = rec.filter((c) => c.asn).length;
    const minDisp = (CFG.rec.hasta - CFG.rec.desde) * 12 + (CFG.des.hasta - CFG.des.desde) * 12;
    const minOcup = act.reduce((s, c) => s + c.dur, 0);
    const llegadas = all.filter((c) => c.arribo != null);
    const puntuales = llegadas.filter((c) => c.arribo - c.ini <= 15).length;
    $("#agKpis").innerHTML = `
      <div class="card kpi navy"><div class="label">Citas del día</div><div class="value num">${act.length}</div><div class="sub">${rec.length} recepciones · ${act.length - rec.length} despachos</div></div>
      <div class="card kpi"><div class="label">Ocupación de andenes</div><div class="value num">${fmt.pct(minOcup / minDisp)}</div><div class="sub">${fmt.n(minOcup / 60)} h reservadas de ${fmt.n(minDisp / 60)} h</div></div>
      <div class="card kpi accent"><div class="label">Recepciones con ASN</div><div class="value num">${fmt.pct(rec.length ? conAsn / rec.length : 0, 0)}</div><div class="sub">Meta propuesta ≥ 85% (I8)</div></div>
      <div class="card kpi"><div class="label">Puntualidad</div><div class="value num">${llegadas.length ? fmt.pct(puntuales / llegadas.length, 0) : "—"}</div><div class="sub">Arribo ≤ 15 min de la cita · ${llegadas.length} llegadas</div></div>`;
    renderTimeline(all);
    // tabla
    const q = state.q.trim().toUpperCase();
    const rows = all.filter((c) => (!state.tipo || c.tipo === state.tipo) && (!q || c.id.includes(q) || c.patente.includes(q) || c.contraparte.toUpperCase().includes(q)));
    $("#agTable").innerHTML = rows.length ? `<table><thead><tr><th>Código</th><th>Horario</th><th>Andén</th><th>Tipo</th><th>Proveedor / transportista</th><th>Patente</th><th class="r">Pallets</th><th>ASN</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      ${rows.map((c) => { const [lbl, cls] = ESTADOS[c.estado]; return `<tr>
        <td><a href="#" data-det="${c.id}"><b>${c.id}</b></a></td><td class="num">${fmt.hhmm(c.ini)}–${fmt.hhmm(c.ini + c.dur)}</td><td>${c.anden}</td>
        <td>${c.tipo === "rec" ? '<span class="badge b-info">Recepción</span>' : '<span class="badge b-accent">Despacho</span>'}</td>
        <td>${esc(c.contraparte)}</td><td class="num">${c.patente}</td><td class="r">${c.pallets}</td>
        <td>${c.tipo === "des" ? "—" : c.asn ? '<span class="badge b-good">Sí</span>' : '<span class="badge b-bad">No</span>'}</td>
        <td><span class="badge ${cls}">${lbl}</span>${c.arribo != null && c.arribo - c.ini > 15 ? ` <span class="badge b-warn">+${c.arribo - c.ini} min</span>` : ""}</td>
        <td><div class="toolbar" style="flex-wrap:nowrap;gap:6px">${acciones(c)}</div></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No hay citas para este filtro. Usa el formulario para agendar una.</div>`;
  }
  function acciones(c) {
    const b = (act, t, cls = "ghost") => `<button class="btn ${cls} sm" data-act="${act}" data-id="${c.id}">${t}</button>`;
    switch (c.estado) {
      case "programada": return b("checkin", "Check-in") + b("noshow", "No-show", "danger") + b("cancel", "Cancelar");
      case "enpuerta": return b("start", c.tipo === "rec" ? "Iniciar descarga" : "Iniciar carga", "");
      case "descargando": return b("close", "Cerrar", "good");
      default: return `<span class="muted small">—</span>`;
    }
  }
  function accion(id, act) {
    const c = AH.state.citas.find((x) => x.id === id); if (!c) return;
    const now = c.fecha === AH.today() ? AH.nowMin() : c.ini;
    if (act === "checkin") { c.estado = "enpuerta"; c.arribo = now; AH.toast(`Check-in ${c.patente} registrado (${now - c.ini > 0 ? "+" : ""}${now - c.ini} min vs cita)`); }
    if (act === "start") { c.estado = "descargando"; c.inicioOp = Math.max(now, c.arribo ?? now); }
    if (act === "noshow") { if (!confirm("¿Marcar como no-show y liberar el andén?")) return; c.estado = "noshow"; }
    if (act === "cancel") { if (!confirm("¿Cancelar la cita y liberar el andén?")) return; c.estado = "cancelada"; }
    if (act === "close") {
      c.estado = "cerrada"; c.fin = Math.max(now, (c.inicioOp ?? c.ini) + 5);
      if (c.tipo === "rec") {
        let n = 0; c.skus.forEach((s) => { if (AH.wms.receive(s.sku, s.cant, c.id)) n++; });
        if (!c.skus.length) AH.wms.log("Recepción", "—", c.unidades, `Recepción sin detalle de SKU (${c.pallets} pallets) · pendiente de putaway`, c.id);
        AH.toast(n ? `Recepción cerrada: ${n} SKU ingresados al WMS` : "Recepción cerrada y registrada en el WMS", "good");
        AH.emit("wms-changed");
      } else AH.toast("Despacho cerrado", "good");
    }
    AH.save(); renderBoard(); AH.emit("agenda-changed");
  }
  function detalle(id) {
    const c = AH.state.citas.find((x) => x.id === id);
    const [lbl, cls] = ESTADOS[c.estado];
    AH.openDrawer(c.id, `${c.tipo === "rec" ? "Recepción" : "Despacho"} · ${AH.dateLabel(c.fecha)}`, `
      <span class="badge ${cls}">${lbl}</span>
      <div class="kv mt">
        <div><span>Horario reservado</span><b>${fmt.hhmm(c.ini)} – ${fmt.hhmm(c.ini + c.dur)}</b></div><div><span>Andén</span><b>N° ${c.anden}</b></div>
        <div><span>${c.tipo === "rec" ? "Proveedor" : "Transportista"}</span><b>${esc(c.contraparte)}</b></div><div><span>${c.tipo === "rec" ? "Origen" : "Destino"}</span><b>${esc(c.origen)}</b></div>
        <div><span>Vehículo</span><b>${esc(c.vehiculo)}</b></div><div><span>Patente</span><b>${c.patente}</b></div>
        <div><span>Conductor</span><b>${esc(c.conductor)}</b></div><div><span>RUT · Teléfono</span><b>${c.rut} · ${esc(c.fono)}</b></div>
        <div><span>Carga</span><b>${c.pallets} pallets · ${fmt.n(c.unidades)} u · ${c.carga}</b></div><div><span>ASN</span><b>${c.asn || "—"}</b></div>
        <div><span>Arribo real</span><b>${c.arribo != null ? fmt.hhmm(c.arribo) : "—"}</b></div><div><span>Inicio / fin operación</span><b>${c.inicioOp != null ? fmt.hhmm(c.inicioOp) : "—"} / ${c.fin != null ? fmt.hhmm(c.fin) : "—"}</b></div>
      </div>
      ${c.skus.length ? `<div class="section-title">Detalle de SKU</div><div class="table-wrap"><table><tbody>${c.skus.map((s) => `<tr><td><b>${s.sku}</b></td><td class="r">${fmt.n(s.cant)} u</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${c.hist ? `<p class="hint mt">Cita de ejemplo generada desde el registro ${c.hist} de la hoja Recepciones.</p>` : ""}
      ${c.obs ? `<div class="note mt">${esc(c.obs)}</div>` : ""}`);
  }

  function renderTimeline(all) {
    const desde = 6 * 60, hasta = 22 * 60, span = hasta - desde, hours = span / 60;
    const tl = $("#timeline");
    const filas = [];
    for (let n = 1; n <= CFG.andenes; n++) {
      const tipo = n <= CFG.rec.andenes[1] ? "rec" : "des";
      const blocks = all.filter((c) => c.anden === n).map((c) => {
        const left = ((c.ini - desde) / span) * 100, w = (c.dur / span) * 100;
        return `<div class="tl-block ${c.tipo} st-${c.estado}" style="left:${left}%;width:${w}%" data-det="${c.id}" data-tip="${esc(c.id)} · ${esc(c.contraparte)}<br>${fmt.hhmm(c.ini)}–${fmt.hhmm(c.ini + c.dur)} · ${c.pallets} pallets · ${ESTADOS[c.estado][0]}">${esc(c.contraparte)}</div>`;
      }).join("");
      filas.push(`<div class="tl-row-label"><span class="dot" style="background:${tipo === "rec" ? AH.colors.s1 : AH.colors.s2}"></span>A${String(n).padStart(2, "0")}</div><div class="tl-row" style="background-size:${100 / hours}% 100%">${blocks}</div>`);
    }
    const head = `<div class="tl-cell-h" style="border:0">Andén</div><div style="display:grid;grid-template-columns:repeat(${hours},1fr)">${Array.from({ length: hours }, (_, i) => `<div class="tl-cell-h">${String(6 + i).padStart(2, "0")}:00</div>`).join("")}</div>`;
    const now = AH.nowMin();
    const nowLine = state.fecha === AH.today() && now > desde && now < hasta ? `<div class="tl-now" style="left:calc(70px + (100% - 70px) * ${(now - desde) / span})"></div>` : "";
    tl.innerHTML = `<div class="tl-grid" style="grid-template-columns:70px 1fr">${head}${filas.join("")}${nowLine}</div>`;
  }

  /* ---------- analítica histórica (hoja Recepciones) ---------- */
  const dts = {};
  function historico() {
    const g = (f) => REC.filter(f);
    const grupos = [
      ["ASN + cita", g((r) => r.asn === "Sí" && r.citaAnden === "Sí")],
      ["Solo ASN", g((r) => r.asn === "Sí" && r.citaAnden === "No")],
      ["Solo cita", g((r) => r.asn === "No" && r.citaAnden === "Sí")],
      ["Sin ASN ni cita", g((r) => r.asn === "No" && r.citaAnden === "No")],
    ];
    dts.ambos = avg(grupos[0][1].map((r) => r.d2s)); dts.sin = avg(grupos[3][1].map((r) => r.d2s));
    AH.chart("chD2S", {
      type: "bar",
      data: { labels: grupos.map((x) => `${x[0]} (${x[1].length})`), datasets: [
        { label: "Espera", data: grupos.map((x) => avg(x[1].map((r) => r.espera)) / 60), backgroundColor: AH.colors.s2 },
        { label: "Descarga", data: grupos.map((x) => avg(x[1].map((r) => r.descarga)) / 60), backgroundColor: AH.colors.s1 },
        { label: "QC", data: grupos.map((x) => avg(x[1].map((r) => r.qc)) / 60), backgroundColor: AH.colors.s3 },
        { label: "Putaway", data: grupos.map((x) => avg(x[1].map((r) => r.putaway)) / 60), backgroundColor: AH.colors.s4 },
      ] },
      options: { indexAxis: "y", scales: { x: { stacked: true, title: { display: true, text: "Horas promedio" } }, y: { stacked: true } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n2(c.raw)} h`, footer: (items) => "Dock-to-stock: " + fmt.n2(items.reduce((s, i) => s + i.raw, 0)) + " h" } } } },
    });
    const bins = [["Adelantado", (m) => m < -10], ["A tiempo (±10)", (m) => m >= -10 && m <= 10], ["10–30 min", (m) => m > 10 && m <= 30], ["30–60 min", (m) => m > 30 && m <= 60], ["> 60 min", (m) => m > 60]];
    AH.chart("chPuntual", {
      type: "bar",
      data: { labels: bins.map((b) => b[0]), datasets: [{ label: "Recepciones", data: bins.map((b) => REC.filter((r) => b[1](r.atrasoMin)).length), backgroundColor: [AH.colors.s3, AH.colors.s1, AH.colors.s4, AH.colors.s2, AH.colors.bad] }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: "N° recepciones" } } } },
    });
    const sorted = [...D.proveedores].sort((a, b) => a["Cumplimiento ASN"] - b["Cumplimiento ASN"]);
    $("#provTable").innerHTML = `<table><thead><tr><th>Proveedor</th><th>Origen</th><th>Segmento</th><th class="r">Cumpl. ASN</th><th class="r">A tiempo</th><th class="r">Defectos</th><th class="r">Fill rate</th><th class="r">Dock-to-stock</th><th>Plan</th></tr></thead><tbody>
      ${sorted.map((p) => `<tr><td><b>${p.Proveedor}</b></td><td>${p.Origen}</td><td>${p.Segmento}</td>
        <td class="r"><span class="badge ${p["Cumplimiento ASN"] >= 0.85 ? "b-good" : p["Cumplimiento ASN"] >= 0.6 ? "b-warn" : "b-bad"}">${fmt.pct(p["Cumplimiento ASN"], 0)}</span></td>
        <td class="r">${fmt.pct(p["Entrega a tiempo"], 0)}</td><td class="r">${fmt.pct(p.Defectos)}</td><td class="r">${fmt.pct(p["Fill rate"], 0)}</td><td class="r">${fmt.n1(p["Dock-to-stock h"])} h</td>
        <td>${p["Plan de acción"] === "Portal ASN" ? '<span class="badge b-accent">Portal ASN</span>' : p["Plan de acción"] === "Calidad" ? '<span class="badge b-warn">Calidad</span>' : '<span class="badge b-neutral">Mantener</span>'}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------- init ---------- */
  A.init = () => {
    seed();
    AH.bindTabs($("#view-agenda"));
    // vehículos, carga
    $("#fVehiculo").innerHTML = Object.entries(VEH).map(([k, v]) => `<option value="${k}">${k} (máx. ${v.pallets} pallets)</option>`).join("");
    $("#fVehiculo").value = "Camión 3/4";
    $("#fCarga").innerHTML = Object.keys(CARGA).map((k) => `<option>${k}</option>`).join("");
    $("#skuList").innerHTML = window.AH_SKU.map((s) => `<option value="${s.sku}">${s.fam} · ${s.abc}</option>`).join("");
    const fFecha = $("#fFecha"); fFecha.min = AH.today(); fFecha.value = AH.today();
    $("#agDate").value = state.fecha;
    $("#exigirAsn").checked = !!AH.state.config.exigirASN;
    fillSelects();
    $$("#tipoSeg button").forEach((b) => b.addEventListener("click", () => {
      form.tipo = b.dataset.v; form.slot = null;
      $$("#tipoSeg button").forEach((x) => x.classList.toggle("on", x === b));
      fillSelects(); renderSlots();
    }));
    $("#fContraparte").addEventListener("change", provHint);
    ["#fFecha", "#fPallets", "#fCarga", "#fVehiculo"].forEach((id) => $(id).addEventListener("input", renderSlots));
    $("#slotGrid").addEventListener("click", (e) => { const b = e.target.closest(".slot"); if (!b || b.disabled) return; form.slot = +b.dataset.t; renderSlots(); });
    $("#fRut").addEventListener("blur", (e) => { if (e.target.value) e.target.value = AH.formatRut(e.target.value); });
    $("#fPatente").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)));
    $("#addSku").onclick = () => { form.skus.push({ sku: "", cant: "" }); renderSkuRows(); };
    $("#skuRows").addEventListener("input", (e) => { const i = e.target.dataset.i; if (i != null) form.skus[i][e.target.dataset.f] = e.target.dataset.f === "cant" ? +e.target.value : e.target.value; });
    $("#skuRows").addEventListener("click", (e) => { const i = e.target.dataset.rm; if (i != null) { form.skus.splice(i, 1); renderSkuRows(); } });
    $("#agendaForm").addEventListener("submit", submit);
    $("#agendaForm").addEventListener("reset", () => setTimeout(() => { form.slot = null; form.skus = []; renderSkuRows(); $("#fFecha").value = AH.today(); $$("#agendaForm .invalid").forEach((x) => x.classList.remove("invalid")); $$("#agendaForm .err-msg").forEach((x) => (x.textContent = "")); renderSlots(); }));
    $("#exigirAsn").addEventListener("change", (e) => { AH.state.config.exigirASN = e.target.checked; AH.save(); AH.toast(e.target.checked ? "Política activada: recepciones sin ASN se bloquean" : "Política ASN obligatoria desactivada"); });
    // tablero
    $("#agDate").addEventListener("change", (e) => { state.fecha = e.target.value || AH.today(); renderBoard(); });
    $("#agPrev").onclick = () => { state.fecha = AH.addDays(state.fecha, -1); $("#agDate").value = state.fecha; renderBoard(); };
    $("#agNext").onclick = () => { state.fecha = AH.addDays(state.fecha, 1); $("#agDate").value = state.fecha; renderBoard(); };
    $("#agQ").addEventListener("input", (e) => { state.q = e.target.value; renderBoard(); });
    $("#agTipo").addEventListener("change", (e) => { state.tipo = e.target.value; renderBoard(); });
    $("#agExport").onclick = () => AH.downloadCSV(`citas_${state.fecha}.csv`, [["Codigo", "Fecha", "Inicio", "Fin", "Anden", "Tipo", "Contraparte", "Patente", "Conductor", "RUT", "Pallets", "Unidades", "ASN", "Estado"],
      ...A.citasDe(state.fecha).map((c) => [c.id, c.fecha, fmt.hhmm(c.ini), fmt.hhmm(c.ini + c.dur), c.anden, c.tipo === "rec" ? "Recepcion" : "Despacho", c.contraparte, c.patente, c.conductor, c.rut, c.pallets, c.unidades, c.asn, ESTADOS[c.estado][0]])]);
    const view = $("#view-agenda");
    view.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]"); if (a) { accion(a.dataset.id, a.dataset.act); return; }
      const d = e.target.closest("[data-det]"); if (d) { e.preventDefault(); detalle(d.dataset.det); }
    });
    // tooltip del timeline
    const tip = $("#tlTip");
    $("#timeline").addEventListener("mousemove", (e) => { const b = e.target.closest(".tl-block"); if (!b) { tip.style.display = "none"; return; } tip.innerHTML = b.dataset.tip; tip.style.display = "block"; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; });
    $("#timeline").addEventListener("mouseleave", () => (tip.style.display = "none"));
    historico(); renderSlots(); renderBoard();
    setInterval(() => { if (state.fecha === AH.today() && $("#view-agenda").classList.contains("active")) renderBoard(); }, 60000);
  };
  A.stats = () => {
    const hoy = A.citasDe(AH.today()).filter(activa);
    return { hoy: hoy.length, rec: hoy.filter((c) => c.tipo === "rec").length, enPatio: hoy.filter((c) => c.estado === "enpuerta" || c.estado === "descargando").length, sinAsn: hoy.filter((c) => c.tipo === "rec" && !c.asn).length };
  };
})();
