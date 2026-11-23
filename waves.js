/* =========================================================
   waves.js — Simulación de productividad por olas (waves) de picking
   Usa órdenes y líneas reales (Ordenes_Muestra, Lineas_Pedido),
   productividad observada (Productividad), ubicación de SKU del
   Mini WMS y tasas de error del informe (0,69% normal / 2,44% peak).
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const D = window.AH_DASH;
  const ZONAS = ["A-Rápida", "B-Media", "C-Lenta", "D-Bulky"];
  const DIST = { "A-Rápida": 35, "B-Media": 72, "C-Lenta": 118, "D-Bulky": 154 };
  const SUP = Object.fromEntries(D.supuestos.map((s) => [s.Supuesto, s.Valor]));
  const C_HORA = SUP["Costo hora directa promedio"] || 9500;
  const C_EXTRA = SUP["Costo hora extra promedio"] || 14500;
  const C_ERROR = SUP["Costo por error de preparación"] || 18500;
  const ERR = { normal: 0.0069, peak: 0.0244 };

  const ORD = window.AH_ORD;
  const linesBy = {}; window.AH_LIN.forEach((l) => (linesBy[l[0]] ||= []).push(l));
  // [pedido, sku, abc, zona, cantPedida, cantPrep, error, pickSeg, packSeg, dist, peso]

  // productividad observada por zona (líneas/hora-persona)
  const obs = (z, peak) => D.prodZona.find((p) => p.Zona === z && p.Peak === peak)?.lh || 30;
  // distancia promedio por zona en las líneas reales
  const avgDist = {}; ZONAS.forEach((z) => { const ls = window.AH_LIN.filter((l) => l[3] === z); avgDist[z] = ls.reduce((s, l) => s + l[9], 0) / ls.length; });

  const SLA = { "Click & Collect": 24, "Reposición tiendas": 30, "E-commerce domicilio": 48, "Bulky domicilio": 72 };
  const CORTE_DEF = { "Click & Collect": 4, "Reposición tiendas": 6, "E-commerce domicilio": 8, "Bulky domicilio": 8 };
  const ESC = {
    normal: { label: "Operación normal", peak: false, pedidos: 1800, mult: 1 },
    peak: { label: "Peak CyberDay 2026", peak: true, pedidos: 3200, mult: 1 },
    cyber27: { label: "CyberDay 2027 (+18%)", peak: true, pedidos: 3200, mult: 1.18 },
  };

  const P = {
    esc: "normal", pedidos: 1800, olas: 8, modo: "fija", wip: 2, estrategia: "discreto", batch: 4, prioridad: "sla",
    slotting: "wms", turno: 8, vel: 1.2, packers: 17, packFijo: 30, seed: 7,
    dot: { "A-Rápida": 24, "B-Media": 19, "C-Lenta": 14, "D-Bulky": 11 },
  };

  /* ---------- muestreo de órdenes del turno ---------- */
  function muestra() {
    const e = ESC[P.esc];
    const pool = ORD.filter((o) => !o[10] && (e.peak ? true : !o[13]));
    // en peak se sobre-representan las órdenes marcadas Peak (mix observado en CyberDay)
    const peakPool = pool.filter((o) => o[13]);
    const rnd = AH.rng(P.seed * 9973 + P.pedidos);
    const n = Math.round(P.pedidos * e.mult);
    const out = [];
    for (let i = 0; i < n; i++) {
      const src = e.peak && rnd() < 0.6 && peakPool.length ? peakPool : pool;
      const o = src[Math.floor(rnd() * src.length)];
      out.push({ id: o[0] + "#" + i, canal: o[2], prio: o[4], promesa: o[7], creada: o[1], lines: linesBy[o[0]] || [] });
    }
    return out;
  }

  /* ---------- tiempo por línea ---------- */
  function lineModel(peak) {
    // handling calibrado: 3600/lh_observada − distancia_media/velocidad  => el escenario discreto reproduce la productividad real
    const handling = {}; ZONAS.forEach((z) => (handling[z] = Math.max(8, 3600 / obs(z, peak) - avgDist[z] / P.vel)));
    return handling;
  }
  function zonaYdist(l) {
    let zona = l[3], dist = l[9];
    if (P.slotting !== "linea") {
      const s = AH.wms.get(l[1]);
      if (s) {
        const z2 = P.slotting === "ideal" ? s.zonaIdeal : s.zona;
        if (z2 !== zona) { dist = dist * (DIST[z2] / DIST[zona]); zona = z2; }
      }
    }
    return [zona, dist];
  }

  /* ---------- simulación ---------- */
  function simular() {
    const e = ESC[P.esc];
    const handling = lineModel(e.peak);
    const orders = muestra();
    // orden de liberación
    if (P.prioridad === "sla") orders.sort((a, b) => (SLA[a.canal] - SLA[b.canal]) || ((a.prio === "Alta" ? 0 : 1) - (b.prio === "Alta" ? 0 : 1)));
    else orders.sort((a, b) => (a.creada < b.creada ? -1 : 1));
    const nO = orders.length, nW = Math.max(1, Math.min(P.olas, nO));
    const per = Math.ceil(nO / nW);
    const turnoS = P.turno * 3600;
    const batchB = P.estrategia === "lotes" ? Math.max(1, P.batch) : 1;
    const travelF = P.estrategia === "lotes" ? 1 / Math.sqrt(batchB) : P.estrategia === "zona" ? 0.85 : 1;
    const handlingF = P.estrategia === "lotes" ? 1 + 0.04 * (batchB - 1) : P.estrategia === "zona" ? 1.03 : 1; // clasificación en carro / consolidación

    const waves = [];
    for (let w = 0; w < nW; w++) {
      const os = orders.slice(w * per, (w + 1) * per); if (!os.length) break;
      const work = {}; const lines = {}; ZONAS.forEach((z) => { work[z] = 0; lines[z] = 0; });
      let pack = 0, dist = 0, nl = 0;
      os.forEach((o) => {
        o.lines.forEach((l) => {
          const [z, d] = zonaYdist(l);
          const t = handling[z] * handlingF + (d / P.vel) * travelF;
          work[z] += t; lines[z]++; dist += d * travelF; nl++;
          pack += l[8];
        });
        pack += P.packFijo;
      });
      waves.push({ n: w + 1, orders: os, work, lines, pack, dist, nl });
    }

    // programación (flow shop: zonas en paralelo → consolidación → packing)
    const zEnd = Object.fromEntries(ZONAS.map((z) => [z, 0])), zBusy = Object.fromEntries(ZONAS.map((z) => [z, 0]));
    let packEnd = 0, packBusy = 0;
    waves.forEach((w, i) => {
      const durs = ZONAS.map((z) => (w.lines[z] ? w.work[z] / Math.max(1, P.dot[z]) : 0));
      let rel;
      if (P.modo === "fija") rel = (i * turnoS) / waves.length;
      else {
        // liberación dinámica "pull": la ola se libera para terminar su picking justo cuando packing
        // se desocupa, dejando un colchón de (WIP − 1) olas en espera
        const prevPack = i ? waves[i - 1].packDur : 0;
        rel = i === 0 ? 0 : Math.max(0, packEnd - (P.wip - 1) * prevPack - Math.max(...durs));
      }
      w.release = rel;
      w.zone = {};
      ZONAS.forEach((z) => {
        const dur = w.lines[z] ? w.work[z] / Math.max(1, P.dot[z]) : 0;
        const st = Math.max(rel, zEnd[z]);
        w.zone[z] = { st, en: st + dur, dur };
        if (dur) { zEnd[z] = st + dur; zBusy[z] += dur; }
      });
      w.pickEnd = Math.max(rel, ...ZONAS.map((z) => (w.lines[z] ? w.zone[z].en : rel)));
      w.packStart = Math.max(w.pickEnd, packEnd);
      w.packDur = w.pack / Math.max(1, P.packers);
      w.packEnd = w.packStart + w.packDur; packEnd = w.packEnd; packBusy += w.packDur;
      w.queue = w.packStart - w.pickEnd;
    });

    const r_busy = (z) => (zBusy[z] * P.dot[z]) / 3600; // horas-persona efectivas
    // WIP promedio (olas esperando entre picking y packing)
    const makespan = Math.max(packEnd, ...ZONAS.map((z) => zEnd[z]));
    const queueAvg = waves.reduce((s, w) => s + w.queue, 0) / waves.length;
    // congestión en pasillos: olas simultáneas en picking (promedio en el tiempo)
    const floorWaves = waves.reduce((s, w) => s + (w.pickEnd - w.release), 0) / Math.max(1, makespan);
    // métricas
    const totLines = waves.reduce((s, w) => s + w.nl, 0);
    const pickers = ZONAS.reduce((s, z) => s + P.dot[z], 0);
    let hReg = 0, hExt = 0;
    ZONAS.forEach((z) => { hReg += P.dot[z] * P.turno; hExt += P.dot[z] * Math.max(0, zEnd[z] - turnoS) / 3600; });
    const packExt = P.packers * Math.max(0, packEnd - turnoS) / 3600;
    const hRegTot = hReg + P.packers * P.turno, hExtTot = hExt + packExt;
    const costoMO = hRegTot * C_HORA + hExtTot * C_EXTRA;
    const errRate = (e.peak ? ERR.peak : ERR.normal) * (1 + 0.15 * Math.max(0, Math.min(4, floorWaves - 1))) * (P.estrategia === "lotes" ? 1 + 0.02 * (batchB - 1) : 1);
    const errores = totLines * errRate;
    const ciclo = waves.reduce((s, w) => s + (w.packEnd - w.release) * w.orders.length, 0) / nO;
    // cumplimiento de corte por canal
    const canal = {};
    waves.forEach((w) => w.orders.forEach((o) => {
      const c = (canal[o.canal] ||= { n: 0, ok: 0, fin: 0 });
      c.n++; c.fin += w.packEnd; if (w.packEnd <= CORTE_DEF[o.canal] * 3600) c.ok++;
    }));
    const dentroTurno = waves.filter((w) => w.packEnd <= turnoS).reduce((s, w) => s + w.orders.length, 0);
    return {
      waves, makespan, turnoS, zBusy, packBusy, totLines, nO, pickers, hRegTot, hExtTot, costoMO, errores, errRate, ciclo, queueAvg, canal, dentroTurno,
      prodPick: totLines / (hReg + hExt), prodEf: totLines / (ZONAS.reduce((s, z) => s + r_busy(z), 0) || 1), utilPick: ZONAS.reduce((s, z) => s + r_busy(z), 0) / (hReg + hExt), km: waves.reduce((s, w) => s + w.dist, 0) / 1000, costoPed: (costoMO + errores * C_ERROR) / nO, handling,
    };
  }

  /* ---------- render ---------- */
  let last = null;
  function render() {
    const r = (last = simular());
    const okTurno = r.dentroTurno / r.nO;
    $("#wvKpis").innerHTML = `
      <div class="card kpi navy"><div class="label">Productividad efectiva picking</div><div class="value num">${fmt.n1(r.prodEf)} <span style="font-size:13px;font-weight:600">líneas/h</span></div><div class="sub">por hora trabajada · ${fmt.n1(r.prodPick)} por hora pagada · utilización ${fmt.pct(r.utilPick, 0)}</div></div>
      <div class="card kpi ${okTurno < 1 ? "accent" : ""}"><div class="label">Pedidos listos en el turno</div><div class="value num">${fmt.pct(okTurno)}</div><div class="sub">${fmt.n(r.dentroTurno)} de ${fmt.n(r.nO)} · fin real ${fmt.hhmm(r.makespan / 60)} h de turno</div></div>
      <div class="card kpi"><div class="label">Ciclo interno promedio</div><div class="value num">${fmt.min(r.ciclo / 60)}</div><div class="sub">liberación → packing · espera media ${fmt.min(r.queueAvg / 60)}</div></div>
      <div class="card kpi"><div class="label">Costo MO + errores / pedido</div><div class="value num">${fmt.clp(r.costoPed)}</div><div class="sub">${fmt.n1(r.hExtTot)} h extra · ${fmt.n(r.errores)} errores (${fmt.pct(r.errRate, 2)})</div></div>`;
    renderGantt(r);
    // carga vs capacidad
    const cap = ZONAS.map((z) => P.dot[z] * P.turno);
    const carga = ZONAS.map((z) => r.zBusy[z] * P.dot[z] / 3600);
    AH.chart("chCarga", {
      type: "bar",
      data: { labels: [...ZONAS, "Packing"], datasets: [
        { label: "Carga de trabajo (h-persona)", data: [...carga, r.packBusy * P.packers / 3600], backgroundColor: [...ZONAS.map((z) => AH.zonaColor[z]), AH.zonaColor.Packing] },
        { label: "Capacidad del turno (h-persona)", data: [...cap, P.packers * P.turno], backgroundColor: "#c9d7e3" },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n1(c.raw)} h`, footer: (it) => "Utilización: " + fmt.pct(it[0].raw / it[1].raw) } } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: "Horas-persona" } } } },
    });
    // tabla por zona
    $("#wvZonas").innerHTML = `<table><thead><tr><th>Zona</th><th class="r">Dotación</th><th class="r">Líneas</th><th class="r">Seg/línea</th><th class="r">Líneas/h-pers.</th><th class="r">Fin zona</th><th class="r">Utilización</th></tr></thead><tbody>
      ${ZONAS.map((z) => { const L = r.waves.reduce((s, w) => s + w.lines[z], 0), Wk = r.waves.reduce((s, w) => s + w.work[z], 0); const fin = Math.max(...r.waves.map((w) => (w.lines[z] ? w.zone[z].en : 0))); const u = (r.zBusy[z]) / Math.max(r.turnoS, fin);
        return `<tr><td><span class="dot" style="background:${AH.zonaColor[z]}"></span> <b>${z}</b></td><td class="r">${P.dot[z]}</td><td class="r num">${fmt.n(L)}</td><td class="r num">${fmt.n1(Wk / (L || 1))}</td><td class="r num">${fmt.n1(L / (Wk / 3600 || 1))}</td>
          <td class="r num" style="color:${fin > r.turnoS ? "var(--bad)" : "inherit"}">${fmt.hhmm(fin / 60)}</td><td class="r"><span class="badge ${u > 0.95 ? "b-bad" : u > 0.8 ? "b-good" : "b-warn"}">${fmt.pct(u, 0)}</span></td></tr>`; }).join("")}
      <tr><td><span class="dot" style="background:${AH.zonaColor.Packing}"></span> <b>Packing</b></td><td class="r">${P.packers}</td><td class="r num">${fmt.n(r.nO)} ped.</td><td class="r">—</td><td class="r">—</td><td class="r num" style="color:${r.waves.at(-1).packEnd > r.turnoS ? "var(--bad)" : "inherit"}">${fmt.hhmm(r.waves.at(-1).packEnd / 60)}</td><td class="r"><span class="badge b-info">${fmt.pct(r.packBusy / Math.max(r.turnoS, r.makespan), 0)}</span></td></tr></tbody></table>`;
    // canal
    $("#wvCanal").innerHTML = `<table><thead><tr><th>Canal</th><th class="r">Pedidos</th><th class="r">Corte</th><th class="r">Al corte</th><th class="r">Fin prom.</th></tr></thead><tbody>
      ${Object.keys(CORTE_DEF).filter((c) => r.canal[c]).map((c) => { const x = r.canal[c], p = x.ok / x.n; return `<tr><td><span class="dot" style="background:${AH.canalColor[c]}"></span> ${c}</td><td class="r">${fmt.n(x.n)}</td><td class="r">${CORTE_DEF[c]} h</td><td class="r"><span class="badge ${p >= 0.96 ? "b-good" : p >= 0.85 ? "b-warn" : "b-bad"}">${fmt.pct(p)}</span></td><td class="r num">${fmt.hhmm(x.fin / x.n / 60)} h</td></tr>`; }).join("")}</tbody></table>`;
    $("#wvSupuestos").innerHTML = `Tiempo de manipulación calibrado por zona (s/línea): ${ZONAS.map((z) => `${z} ${fmt.n1(r.handling[z])}`).join(" · ")}. Recorrido = distancia real de la línea ÷ ${fmt.n1(P.vel)} m/s${P.estrategia === "lotes" ? ` × 1/√${P.batch}` : P.estrategia === "zona" ? " × 0,85" : ""}. Recorrido total del turno: ${fmt.n1(r.km)} km.`;
  }

  function renderGantt(r) {
    const total = Math.max(r.makespan, r.turnoS) * 1.02;
    const pct = (s) => (s / total) * 100;
    const pal = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6", "#008300", "#e34948"];
    const bar = (w, st, en, lbl) => en > st ? `<div class="g-bar" style="left:${pct(st)}%;width:${Math.max(0.3, pct(en - st))}%;background:${pal[(w.n - 1) % pal.length]}" title="Ola ${w.n} · ${lbl} · ${fmt.hhmm(st / 60)}–${fmt.hhmm(en / 60)} · ${w.orders.length} pedidos">${pct(en - st) > 3 ? "O" + w.n : ""}</div>` : "";
    const rows = ZONAS.map((z) => `<div class="g-row"><div class="g-label">${z} <span class="muted small">(${P.dot[z]})</span></div><div class="g-track">${r.waves.map((w) => bar(w, w.zone[z].st, w.zone[z].en, z)).join("")}<div class="g-shift" style="left:${pct(r.turnoS)}%"></div></div></div>`);
    rows.push(`<div class="g-row"><div class="g-label">Cola packing</div><div class="g-track">${r.waves.map((w) => (w.queue > 30 ? `<div class="g-bar" style="left:${pct(w.pickEnd)}%;width:${pct(w.queue)}%;background:repeating-linear-gradient(45deg,#c9373a55,#c9373a55 4px,#fff0 4px,#fff0 8px);color:var(--bad)" title="Ola ${w.n} espera ${fmt.min(w.queue / 60)}"></div>` : "")).join("")}<div class="g-shift" style="left:${pct(r.turnoS)}%"></div></div></div>`);
    rows.push(`<div class="g-row"><div class="g-label">Packing <span class="muted small">(${P.packers})</span></div><div class="g-track">${r.waves.map((w) => bar(w, w.packStart, w.packEnd, "Packing")).join("")}<div class="g-shift" style="left:${pct(r.turnoS)}%"></div></div></div>`);
    const hrs = Math.ceil(total / 3600);
    const ticks = Array.from({ length: hrs + 1 }, (_, h) => h * 3600 <= total ? `<span style="left:${pct(h * 3600)}%">${h} h</span>` : "").join("");
    $("#gantt").innerHTML = `<div class="gantt-inner">${rows.join("")}<div class="g-axis"><div></div><div class="ticks">${ticks}</div></div></div>`;
  }

  /* ---------- escenarios guardados ---------- */
  function guardar() {
    if (!last) return;
    const nombre = prompt("Nombre del escenario", `${ESC[P.esc].label} · ${P.olas} olas ${P.modo === "dinamica" ? "dinámicas" : "fijas"} · ${P.estrategia}`);
    if (!nombre) return;
    AH.state.escenarios.push({ nombre, prod: last.prodEf, turno: last.dentroTurno / last.nO, ciclo: last.ciclo / 60, extra: last.hExtTot, err: last.errores, costo: last.costoPed, km: last.km });
    if (AH.state.escenarios.length > 6) AH.state.escenarios.shift();
    AH.save(); renderComp(); AH.toast("Escenario guardado", "good");
  }
  function renderComp() {
    const E = AH.state.escenarios;
    if (!E.length) { $("#wvComp").innerHTML = `<div class="empty">Guarda escenarios para compararlos (por ejemplo: olas fijas vs. olas dinámicas con límite WIP).</div>`; return; }
    const best = (k, max) => { const v = E.map((e) => e[k]); return max ? Math.max(...v) : Math.min(...v); };
    const worst = (k, max) => { const v = E.map((e) => e[k]); return max ? Math.min(...v) : Math.max(...v); };
    const cell = (e, k, f, max) => `<td class="r num ${E.length > 1 && e[k] === best(k, max) ? "better" : E.length > 1 && e[k] === worst(k, max) ? "worse" : ""}">${f(e[k])}</td>`;
    $("#wvComp").innerHTML = `<div class="table-wrap"><table class="compare"><thead><tr><th>Escenario</th><th class="r">Líneas/h-pers.</th><th class="r">Listos en turno</th><th class="r">Ciclo interno</th><th class="r">Horas extra</th><th class="r">Errores</th><th class="r">Recorrido</th><th class="r">Costo/pedido</th><th></th></tr></thead><tbody>
      ${E.map((e, i) => `<tr><td style="white-space:normal"><b>${esc(e.nombre)}</b></td>${cell(e, "prod", fmt.n1, true)}${cell(e, "turno", (v) => fmt.pct(v), true)}${cell(e, "ciclo", (v) => fmt.min(v), false)}${cell(e, "extra", (v) => fmt.n1(v) + " h", false)}${cell(e, "err", fmt.n, false)}${cell(e, "km", (v) => fmt.n1(v) + " km", false)}${cell(e, "costo", fmt.clp, false)}<td><button class="btn ghost sm" data-del="${i}">✕</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- controles ---------- */
  function syncInputs() {
    $("#pEsc").value = P.esc; $("#pPed").value = P.pedidos; $("#pPedV").textContent = fmt.n(Math.round(P.pedidos * ESC[P.esc].mult));
    $("#pOlas").value = P.olas; $("#pOlasV").textContent = P.olas;
    $("#pWip").value = P.wip; $("#pWipV").textContent = P.wip; $("#wipField").style.opacity = P.modo === "dinamica" ? 1 : 0.4; $("#pWip").disabled = P.modo !== "dinamica";
    $("#pBatch").value = P.batch; $("#pBatchV").textContent = P.batch; $("#batchField").style.opacity = P.estrategia === "lotes" ? 1 : 0.4; $("#pBatch").disabled = P.estrategia !== "lotes";
    $("#pPrio").value = P.prioridad; $("#pSlot").value = P.slotting; $("#pTurno").value = P.turno; $("#pVel").value = P.vel; $("#pVelV").textContent = fmt.n1(P.vel);
    $("#pPack").value = P.packers;
    ZONAS.forEach((z) => ($(`[data-dot="${z}"]`).value = P.dot[z]));
    $$("#pModo button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.modo));
    $$("#pEstr button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.estrategia));
    $("#dotTotal").textContent = ZONAS.reduce((s, z) => s + P.dot[z], 0) + " pickers + " + P.packers + " packers";
  }
  let t = null;
  const run = () => { clearTimeout(t); t = setTimeout(() => { syncInputs(); render(); }, 60); };

  AH.waves = {
    init() {
      $("#pEsc").innerHTML = Object.entries(ESC).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
      $("#dotInputs").innerHTML = ZONAS.map((z) => `<div class="field"><label><span class="dot" style="background:${AH.zonaColor[z]}"></span> ${z}</label><input type="number" min="1" max="60" data-dot="${z}"></div>`).join("");
      $("#pEsc").addEventListener("change", (e) => { P.esc = e.target.value; P.pedidos = ESC[P.esc].pedidos; run(); });
      const num = (id, k, parse = Number) => $(id).addEventListener("input", (e) => { const v = parse(e.target.value); if (!isNaN(v) && v > 0) { P[k] = v; run(); } });
      num("#pPed", "pedidos"); num("#pOlas", "olas"); num("#pWip", "wip"); num("#pBatch", "batch"); num("#pTurno", "turno"); num("#pVel", "vel"); num("#pPack", "packers");
      $("#pPrio").addEventListener("change", (e) => { P.prioridad = e.target.value; run(); });
      $("#pSlot").addEventListener("change", (e) => { P.slotting = e.target.value; run(); });
      $$("#pModo button").forEach((b) => b.addEventListener("click", () => { P.modo = b.dataset.v; run(); }));
      $$("#pEstr button").forEach((b) => b.addEventListener("click", () => { P.estrategia = b.dataset.v; run(); }));
      $("#dotInputs").addEventListener("input", (e) => { const z = e.target.dataset.dot; const v = parseInt(e.target.value, 10); if (z && v > 0) { P.dot[z] = v; run(); } });
      $("#btnBalance").onclick = () => {
        if (!last) return;
        const keys = [...ZONAS, "Packing"];
        const total = ZONAS.reduce((s, z) => s + P.dot[z], 0) + P.packers;
        const w = [...ZONAS.map((z) => last.waves.reduce((s, x) => s + x.work[z], 0)), last.waves.reduce((s, x) => s + x.pack, 0)];
        const sw = w.reduce((a, b) => a + b, 0);
        const raw = w.map((x) => (x / sw) * total);
        const fl = raw.map((x) => Math.max(1, Math.floor(x)));
        let rest = total - fl.reduce((a, b) => a + b, 0);
        raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { fl[i]++; rest--; } });
        ZONAS.forEach((z, i) => (P.dot[z] = fl[i])); P.packers = fl[4];
        AH.toast(`Dotación polivalente rebalanceada (I18): ${keys.map((z, i) => z.split("-")[0] + " " + fl[i]).join(" · ")}`, "good"); run();
      };
      $("#btnReset").onclick = () => { Object.assign(P, { esc: "normal", pedidos: 1800, olas: 8, modo: "fija", wip: 2, estrategia: "discreto", batch: 4, prioridad: "sla", slotting: "wms", turno: 8, vel: 1.2, packers: 17, dot: { "A-Rápida": 24, "B-Media": 19, "C-Lenta": 14, "D-Bulky": 11 } }); run(); };
      $("#btnPropuesta").onclick = () => { Object.assign(P, { olas: 10, modo: "dinamica", wip: 1, estrategia: "lotes", batch: 4, prioridad: "sla", slotting: "ideal" }); AH.toast("Configuración propuesta del informe: olas dinámicas (I4) + lotes (I5) + slotting ABC (I6) + prioridad SLA (I3)"); run(); };
      $("#btnSave").onclick = guardar;
      $("#wvComp").addEventListener("click", (e) => { const i = e.target.dataset.del; if (i != null) { AH.state.escenarios.splice(+i, 1); AH.save(); renderComp(); } });
      $("#btnClearComp").onclick = () => { AH.state.escenarios = []; AH.save(); renderComp(); };
      syncInputs(); render(); renderComp();
      AH.on("wms-changed", () => { if (P.slotting === "wms") run(); });
    },
    rerender() { if (last) render(); },
  };
})();
