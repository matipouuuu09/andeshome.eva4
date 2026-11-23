/* =========================================================
   dotacion.js — Simulador de distribución de empleados
   Usa la plantilla real de 180 colaboradores (hoja Turnos_Competencias:
   turno, área, contrato, competencias RF/WMS/Lean/MMC y ausentismo 90d),
   la demanda diaria por canal (Pedidos_Diarios), la mezcla de líneas
   Bulky y el tiempo de packing por canal (Lineas_Pedido) y los costos
   de la hoja Supuestos.
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const D = window.AH_PERS;
  const SUP = Object.fromEntries(((window.AH_DASH && window.AH_DASH.supuestos) || []).map((s) => [s.Supuesto, s.Valor]));
  const C_HORA = SUP["Costo hora directa promedio"] || 9500;
  const C_EXTRA = SUP["Costo hora extra promedio"] || 14500;
  const RECARGO_TEMP = 1.25; // supuesto: recargo de agencia sobre la hora directa

  const AREAS = ["Inbound", "Picking", "Bulky", "Packing", "Despacho", "Inventario"];
  const TURNOS = ["Mañana", "Tarde", "Noche"];
  const COLOR = { Inbound: "#2a78d6", Picking: "#eb6834", Bulky: "#eda100", Packing: "#6250d6", Despacho: "#1baf7a", Inventario: "#e87ba4" };
  const INFO = {
    Inbound: { driver: "Unidades recibidas", unidad: "unid./h-persona", req: "RF", ok: (c) => c.rf },
    Picking: { driver: "Líneas no Bulky", unidad: "líneas/h-persona", req: "RF", ok: (c) => c.rf },
    Bulky: { driver: "Líneas Bulky (pick + embalaje + carga)", unidad: "líneas/h-persona", req: "MMC", ok: (c) => c.mmc },
    Packing: { driver: "Pedidos equivalentes", unidad: "ped. eq./h-persona", req: "—", ok: () => true },
    Despacho: { driver: "Unidades despachadas", unidad: "unid./h-persona", req: "—", ok: () => true },
    Inventario: { driver: "Conteo cíclico (dotación fija)", unidad: "personas/día", req: "RF + WMS", ok: (c) => c.rf && c.wms },
  };

  const ROSTER = D.roster.map((r) => ({
    id: r[0], turno: r[1], area: r[2], contrato: r[3], antig: r[4],
    rf: !!r[5], wms: !!r[6], lean: !!r[7], mmc: !!r[8], sup: !!r[9], aus: r[10], brecha: r[11],
  }));

  const ESC = {
    base: { label: "Operación normal (prom. ene–may 2026)", dem: "base", mult: 1 },
    valle: { label: "Temporada baja (−15%)", dem: "base", mult: 0.85 },
    peak: { label: "Peak junio 2026 (CyberDay)", dem: "peak", mult: 1 },
    cyber27: { label: "CyberDay 2027 (junio +18%)", dem: "peak", mult: 1.18 },
  };

  const DEF = {
    esc: "base", ajuste: 0, horas: 8, util: 85, ausExtra: 0, heMax: 2,
    split: { Mañana: 38, Tarde: 38, Noche: 24 },
    poli: true, excluirExterno: true, protegerSuper: true,
  };
  const P = JSON.parse(JSON.stringify(DEF));
  let last = null, seed = 11;

  /* ---------- drivers de carga por área (por día) ---------- */
  function drivers(demKey, mult) {
    const dem = D.demanda[demKey];
    const canales = Object.keys(dem);
    const uni = canales.reduce((s, c) => s + dem[c].uni, 0);
    const lin = canales.reduce((s, c) => s + dem[c].lin, 0);
    const refPack = D.packSeg["E-commerce domicilio"] || 71;
    const pedEq = canales.reduce((s, c) => s + dem[c].ped * ((D.packSeg[c] || refPack) / refPack), 0);
    return {
      Inbound: uni * mult,
      Picking: lin * (1 - D.bulkyShare) * mult,
      Bulky: lin * D.bulkyShare * mult,
      Packing: pedEq * mult,
      Despacho: uni * mult,
      Inventario: 1,
      _ped: canales.reduce((s, c) => s + dem[c].ped, 0) * mult, _lin: lin * mult, _uni: uni * mult,
    };
  }

  const pres = (c, extra) => Math.max(0, 1 - Math.min(0.95, c.aus + extra));

  /* ---------- productividad estándar calibrada ----------
     Con la demanda base, 8 h y 85% de utilización objetivo, la plantilla
     actual de cada área cubre exactamente su carga diaria. Así el
     simulador parte de la realidad del CD y muestra cómo cambia la
     necesidad por área y turno al variar volumen, mezcla de canales,
     perfil horario y ausentismo. Se pueden editar en "Avanzado". */
  const PROD = {};
  (function calibrar() {
    const drv = drivers("base", 1);
    AREAS.forEach((a) => {
      const pr = ROSTER.filter((c) => c.area === a).reduce((s, c) => s + pres(c, 0), 0);
      PROD[a] = a === "Inventario" ? +pr.toFixed(1) : drv[a] / (pr * 8 * 0.85);
    });
  })();
  const PROD_DEF = { ...PROD };

  /* ---------- requerimiento por área y turno (personas presentes) ---------- */
  function requerido(p) {
    const e = ESC[p.esc];
    const mult = e.mult * (1 + p.ajuste / 100);
    const drv = drivers(e.dem, mult);
    const sumSplit = TURNOS.reduce((s, t) => s + (+p.split[t] || 0), 0) || 1;
    const req = {};
    AREAS.forEach((a) => {
      req[a] = {};
      const dia = a === "Inventario" ? PROD.Inventario : drv[a] / (PROD[a] * p.horas * (p.util / 100));
      TURNOS.forEach((t) => (req[a][t] = dia * ((+p.split[t] || 0) / sumSplit)));
    });
    return { req, drv, mult, sumSplit };
  }

  const elegible = (c, destino, p) =>
    INFO[destino].ok(c) && !(p.protegerSuper && c.sup) && !(p.excluirExterno && c.contrato === "Servicio externo");

  /* ---------- redistribución de polifuncionales dentro del mismo turno ---------- */
  function redistribuir(req, p) {
    const asg = Object.fromEntries(ROSTER.map((c) => [c.id, c.area]));
    const moves = [];
    if (!p.poli) return { asg, moves };
    const extra = p.ausExtra / 100;
    TURNOS.forEach((t) => {
      const gente = ROSTER.filter((c) => c.turno === t);
      const movidos = new Set();
      const gap = () => {
        const g = {}; AREAS.forEach((a) => (g[a] = -req[a][t]));
        gente.forEach((c) => (g[asg[c.id]] += pres(c, extra)));
        return g;
      };
      const bloqueadas = new Set();
      for (let it = 0; it < 300; it++) {
        const g = gap();
        const destino = AREAS.filter((a) => !bloqueadas.has(a) && g[a] < -0.3).sort((x, y) => g[x] - g[y])[0];
        if (!destino) break;
        const cands = gente.filter((c) => !movidos.has(c.id) && asg[c.id] !== destino && elegible(c, destino, p)
          && g[asg[c.id]] > 0.3 && g[asg[c.id]] - pres(c, extra) >= -0.15);
        if (!cands.length) { bloqueadas.add(destino); continue; }
        const skills = (c) => c.rf + c.wms + c.lean + c.mmc;
        cands.sort((x, y) => (g[asg[y.id]] - g[asg[x.id]]) || ((x.brecha === "Alta") - (y.brecha === "Alta")) || (skills(y) - skills(x)) || (y.antig - x.antig));
        const c = cands[0];
        moves.push({ c, de: asg[c.id], a: destino, deficit: -g[destino] });
        asg[c.id] = destino; movidos.add(c.id);
      }
    });
    return { asg, moves };
  }

  /* ---------- simulación principal ---------- */
  function simular(p) {
    const { req, drv, mult } = requerido(p);
    const { asg, moves } = redistribuir(req, p);
    const extra = p.ausExtra / 100;
    const disp = {}, nom = {};
    AREAS.forEach((a) => { disp[a] = {}; nom[a] = {}; TURNOS.forEach((t) => { disp[a][t] = 0; nom[a][t] = 0; }); });
    ROSTER.forEach((c) => { disp[asg[c.id]][c.turno] += pres(c, extra); nom[asg[c.id]][c.turno] += 1; });

    // cobertura del déficit: primero horas extra (tope por persona presente), luego temporales
    const cob = {}; let heH = 0, tempN = 0, deficitH = 0;
    TURNOS.forEach((t) => {
      cob[t] = { heH: 0, temp: 0, costo: 0, defH: 0 };
      AREAS.forEach((a) => {
        const falta = req[a][t] - disp[a][t];
        if (falta <= 0.05) return;
        const fh = falta * p.horas;
        const he = Math.min(fh, disp[a][t] * p.heMax);
        const tn = Math.ceil(Math.max(0, fh - he) / p.horas - 1e-9);
        cob[t].defH += fh; cob[t].heH += he; cob[t].temp += tn;
      });
      cob[t].costo = cob[t].heH * C_EXTRA + cob[t].temp * p.horas * C_HORA * RECARGO_TEMP;
      heH += cob[t].heH; tempN += cob[t].temp; deficitH += cob[t].defH;
    });
    const tot = (m) => AREAS.reduce((s, a) => s + TURNOS.reduce((x, t) => x + m[a][t], 0), 0);
    return {
      req, disp, nom, asg, moves, cob, drv, mult,
      totReq: tot(req), totDisp: tot(disp), heH, tempN, deficitH,
      costo: TURNOS.reduce((s, t) => s + cob[t].costo, 0),
    };
  }

  /* ---------- render ---------- */
  const sig = (v) => (Math.abs(v) < 0.05 ? "±0,0" : (v > 0 ? "+" : "") + fmt.n1(v));
  const celda = (d, r) => {
    const ratio = r > 0 ? d / r : 1;
    const cls = ratio < 0.95 ? "b-bad" : ratio > 1.15 ? "b-info" : "b-good";
    return `<td class="r"><div class="num"><b>${fmt.n1(d)}</b> <span class="muted">/ ${fmt.n1(r)}</span></div><span class="badge ${cls}">${sig(d - r)}</span></td>`;
  };

  function render() {
    const r = last = simular(P);
    const brecha = r.totDisp - r.totReq;
    const presentes = ROSTER.reduce((s, c) => s + pres(c, P.ausExtra / 100), 0);
    $("#dtKpis").innerHTML = `
      <div class="card kpi navy"><div class="label">Plantilla del CD</div><div class="value num">${fmt.n(ROSTER.length)} <span style="font-size:13px;font-weight:600">personas</span></div><div class="sub">${fmt.n1(presentes)} presentes esperados · ausentismo ${fmt.pct(1 - presentes / ROSTER.length)}</div></div>
      <div class="card kpi"><div class="label">Dotación requerida (día)</div><div class="value num">${fmt.n1(r.totReq)}</div><div class="sub">${fmt.n(r.drv._ped)} pedidos · ${fmt.n(r.drv._lin)} líneas · ${fmt.n(r.drv._uni)} unid.</div></div>
      <div class="card kpi ${brecha < 0 ? "accent" : ""}"><div class="label">Brecha neta</div><div class="value num" style="color:${brecha < -0.5 ? "var(--bad)" : "var(--good)"}">${sig(brecha)}</div><div class="sub">${r.moves.length} reasignaciones polifuncionales · ${fmt.n(r.deficitH)} h-persona sin cubrir</div></div>
      <div class="card kpi"><div class="label">Costo diario de cubrir déficit</div><div class="value num">${fmt.clp(r.costo)}</div><div class="sub">${fmt.n(r.heH)} h extra · ${fmt.n(r.tempN)} temporales</div></div>`;

    // matriz área × turno
    $("#dtMatriz").innerHTML = `<table><thead><tr><th>Área</th>${TURNOS.map((t) => `<th class="r">${t}</th>`).join("")}<th class="r">Total día</th><th>Requisito</th></tr></thead><tbody>
      ${AREAS.map((a) => { const d = TURNOS.reduce((s, t) => s + r.disp[a][t], 0), q = TURNOS.reduce((s, t) => s + r.req[a][t], 0);
        return `<tr><td><span class="dot" style="background:${COLOR[a]}"></span> <b>${a}</b></td>${TURNOS.map((t) => celda(r.disp[a][t], r.req[a][t])).join("")}${celda(d, q)}<td class="muted small">${INFO[a].req}</td></tr>`; }).join("")}
      <tr style="background:#f7fbfe"><td><b>Total</b></td>${TURNOS.map((t) => celda(AREAS.reduce((s, a) => s + r.disp[a][t], 0), AREAS.reduce((s, a) => s + r.req[a][t], 0))).join("")}${celda(r.totDisp, r.totReq)}<td></td></tr>
      </tbody></table>`;

    // cobertura por turno
    $("#dtCob").innerHTML = `<table><thead><tr><th>Turno</th><th class="r">Déficit h</th><th class="r">H. extra</th><th class="r">Temp.</th><th class="r">Costo/día</th></tr></thead><tbody>
      ${TURNOS.map((t) => { const c = r.cob[t];
        return `<tr><td><b>${t}</b> <span class="muted small">${ROSTER.filter((x) => x.turno === t).length} pers.</span></td><td class="r num">${fmt.n1(c.defH)}</td><td class="r num">${fmt.n1(c.heH)}</td><td class="r num">${c.temp}</td><td class="r num">${c.costo ? fmt.clp(c.costo) : '<span class="badge b-good">Sin costo</span>'}</td></tr>`; }).join("")}
      </tbody></table>`;

    // gráfico disponibles vs requeridos por área
    AH.chart("chDot", {
      type: "bar",
      data: { labels: AREAS, datasets: [
        { label: "Presentes asignados", data: AREAS.map((a) => TURNOS.reduce((s, t) => s + r.disp[a][t], 0)), backgroundColor: AREAS.map((a) => COLOR[a]) },
        { label: "Requeridos", data: AREAS.map((a) => TURNOS.reduce((s, t) => s + r.req[a][t], 0)), backgroundColor: "#c9d7e3" },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n1(c.raw)} personas`, footer: (it) => "Cobertura: " + fmt.pct(it[0].raw / (it[1].raw || 1), 0) } } }, scales: { x: { grid: { display: false } }, y: { title: { display: true, text: "Personas por día" } } } },
    });

    // reasignaciones
    $("#dtMoves").innerHTML = r.moves.length ? `<div class="table-wrap" style="max-height:320px"><table><thead><tr><th>Colaborador</th><th>Turno</th><th>De</th><th>A</th><th>Contrato</th><th>Competencias</th></tr></thead><tbody>
      ${r.moves.map((m) => `<tr><td><b>${m.c.id}</b></td><td>${m.c.turno}</td><td><span class="dot" style="background:${COLOR[m.de]}"></span> ${m.de}</td><td><span class="dot" style="background:${COLOR[m.a]}"></span> <b>${m.a}</b></td><td>${m.c.contrato}</td><td>${chips(m.c)}</td></tr>`).join("")}
      </tbody></table></div>`
      : `<div class="empty">${P.poli ? "No hace falta mover personas: cada área cubre su carga o no hay polifuncionales elegibles con holgura en su área." : "La redistribución de polifuncionales está desactivada."}</div>`;

    renderDiagnostico(r);
    renderPlantilla();
    $("#dtMC").innerHTML = `<div class="empty">Presiona <b>Simular 100 días</b> para medir el riesgo con ausencias y demanda aleatorias.</div>`;
  }

  const chips = (c) => [["RF", c.rf], ["WMS", c.wms], ["Lean", c.lean], ["MMC", c.mmc], ["Super", c.sup]].filter((x) => x[1]).map((x) => `<span class="badge ${x[0] === "Super" ? "b-accent" : "b-neutral"}">${x[0]}</span>`).join(" ");

  function renderDiagnostico(r) {
    const msgs = [];
    const celdas = [];
    AREAS.forEach((a) => TURNOS.forEach((t) => celdas.push({ a, t, g: r.disp[a][t] - r.req[a][t], q: r.req[a][t] })));
    const peor = celdas.filter((c) => c.g < -0.5).sort((x, y) => x.g - y.g);
    const holg = celdas.filter((c) => c.g > 1 && c.q > 0).sort((x, y) => y.g - x.g);
    if (!peor.length) msgs.push(["", `Con este escenario la dotación cubre todas las áreas y turnos${r.moves.length ? ` tras ${r.moves.length} reasignaciones polifuncionales` : ""}.`]);
    else msgs.push(["warn", `Déficit principal: <b>${peor.slice(0, 3).map((c) => `${c.a} ${c.t.toLowerCase()} (${fmt.n1(c.g)})`).join(", ")}</b>. Se cubre con ${fmt.n(r.heH)} h extra y ${r.tempN} temporales (${fmt.clp(r.costo)} al día).`]);
    if (holg.length) msgs.push(["", `Mayor holgura: ${holg.slice(0, 3).map((c) => `${c.a} ${c.t.toLowerCase()} (+${fmt.n1(c.g)})`).join(", ")}. Si no hay polifuncionales elegibles, esa holgura no se puede trasladar: es una brecha de formación.`]);
    const bloq = peor.filter((c) => !ROSTER.some((x) => x.turno === c.t && x.area !== c.a && INFO[c.a].ok(x)));
    if (bloq.length) msgs.push(["warn", `Sin personas habilitadas para mover a ${bloq.map((c) => c.a).filter((v, i, s) => s.indexOf(v) === i).join(", ")} (requiere ${bloq.map((c) => INFO[c.a].req).filter((v, i, s) => s.indexOf(v) === i).join(" / ")}).`]);
    const sinRF = ROSTER.filter((c) => !c.rf).length;
    msgs.push(["", `${sinRF} colaboradores no tienen RF y ${ROSTER.filter((c) => !c.mmc).length} no tienen MMC: capacitarlos amplía la polifuncionalidad (iniciativa I18).`]);
    $("#dtDiag").innerHTML = msgs.map(([cls, m]) => `<div class="note ${cls}" style="margin-bottom:8px">${m}</div>`).join("");
  }

  function renderPlantilla() {
    if (!last) return;
    const fa = $("#dtFArea").value, ft = $("#dtFTurno").value, fc = $("#dtFContrato").value, q = $("#dtQ").value.trim().toUpperCase(), solo = $("#dtSoloMov").checked;
    const rows = ROSTER.filter((c) => (!fa || last.asg[c.id] === fa || c.area === fa) && (!ft || c.turno === ft) && (!fc || c.contrato === fc) && (!q || c.id.includes(q)) && (!solo || last.asg[c.id] !== c.area));
    $("#dtPlantillaN").textContent = `${rows.length} de ${ROSTER.length}`;
    $("#dtPlantilla").innerHTML = `<table><thead><tr><th>Colaborador</th><th>Turno</th><th>Área base</th><th>Área asignada</th><th>Contrato</th><th class="r">Antig.</th><th>Competencias</th><th class="r">Ausentismo 90d</th><th>Brecha formación</th></tr></thead><tbody>
      ${rows.map((c) => { const mv = last.asg[c.id] !== c.area; return `<tr${mv ? ' style="background:var(--accent-soft)"' : ""}><td><b>${c.id}</b></td><td>${c.turno}</td><td>${c.area}</td><td>${mv ? `<b>→ ${last.asg[c.id]}</b>` : last.asg[c.id]}</td><td>${c.contrato}</td><td class="r num">${fmt.n1(c.antig)}</td><td>${chips(c)}</td>
        <td class="r num"><span class="badge ${c.aus > 0.1 ? "b-bad" : c.aus > 0.07 ? "b-warn" : "b-good"}">${fmt.pct(c.aus)}</span></td><td><span class="badge ${c.brecha === "Alta" ? "b-warn" : "b-neutral"}">${c.brecha}</span></td></tr>`; }).join("")}
      </tbody></table>`;
  }

  /* ---------- Monte Carlo: 100 días con ausencias y demanda aleatorias ---------- */
  function montecarlo() {
    const r = last || simular(P);
    const rnd = AH.rng(seed++ * 7919);
    const N = 100, VAR = 0.15, extra = P.ausExtra / 100;
    const res = {}; TURNOS.forEach((t) => (res[t] = { ok: 0, okHE: 0, temp: 0, falla: {} }));
    let costoTot = 0;
    for (let d = 0; d < N; d++) {
      const f = 1 + (rnd() * 2 - 1) * VAR;
      const disp = {}; AREAS.forEach((a) => { disp[a] = {}; TURNOS.forEach((t) => (disp[a][t] = 0)); });
      ROSTER.forEach((c) => { if (rnd() < pres(c, extra)) disp[r.asg[c.id]][c.turno] += 1; });
      TURNOS.forEach((t) => {
        let ok = true, okHE = true, temp = 0, he = 0;
        AREAS.forEach((a) => {
          const q = a === "Inventario" ? r.req[a][t] : r.req[a][t] * f;
          const falta = q - disp[a][t];
          if (falta > 0.05) {
            ok = false; res[t].falla[a] = (res[t].falla[a] || 0) + 1;
            const fh = falta * P.horas, h = Math.min(fh, disp[a][t] * P.heMax);
            he += h; const tn = Math.ceil(Math.max(0, fh - h) / P.horas - 1e-9); temp += tn; if (tn) okHE = false;
          }
        });
        if (ok) res[t].ok++; if (okHE) res[t].okHE++; res[t].temp += temp;
        costoTot += he * C_EXTRA + temp * P.horas * C_HORA * RECARGO_TEMP;
      });
    }
    $("#dtMC").innerHTML = `<table><thead><tr><th>Turno</th><th class="r">Días sin déficit</th><th class="r">Días cubiertos con HE</th><th class="r">Temporales prom./día</th><th>Área que más falla</th></tr></thead><tbody>
      ${TURNOS.map((t) => { const x = res[t]; const top = Object.entries(x.falla).sort((a, b) => b[1] - a[1])[0];
        return `<tr><td><b>${t}</b></td><td class="r"><span class="badge ${x.ok >= 90 ? "b-good" : x.ok >= 60 ? "b-warn" : "b-bad"}">${x.ok}%</span></td><td class="r"><span class="badge ${x.okHE >= 95 ? "b-good" : x.okHE >= 75 ? "b-warn" : "b-bad"}">${x.okHE}%</span></td><td class="r num">${fmt.n1(x.temp / N)}</td><td>${top ? `${top[0]} <span class="muted small">(${top[1]} días)</span>` : "—"}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="hint" style="margin-top:8px">Costo promedio de cubrir déficit: <b>${fmt.clp(costoTot / N)}</b> por día. Cada día se sortea la asistencia de cada colaborador según su ausentismo 90d y la demanda varía ±${VAR * 100}% sobre el escenario.</p>`;
  }

  /* ---------- parámetros ---------- */
  function syncInputs() {
    $("#dtEsc").value = P.esc;
    $("#dtAjuste").value = P.ajuste; $("#dtAjusteV").textContent = (P.ajuste > 0 ? "+" : "") + P.ajuste + "%";
    $("#dtHoras").value = P.horas; $("#dtUtil").value = P.util; $("#dtUtilV").textContent = P.util + "%";
    $("#dtAus").value = P.ausExtra; $("#dtAusV").textContent = (P.ausExtra > 0 ? "+" : "") + P.ausExtra + " pp";
    $("#dtHe").value = P.heMax;
    TURNOS.forEach((t) => ($(`[data-split="${t}"]`).value = P.split[t]));
    const s = TURNOS.reduce((x, t) => x + (+P.split[t] || 0), 0);
    $("#dtSplitTot").textContent = s === 100 ? "" : `(suma ${s}%, se normaliza)`;
    $("#dtPoli").checked = P.poli; $("#dtExt").checked = P.excluirExterno; $("#dtSup").checked = P.protegerSuper;
    AREAS.forEach((a) => ($(`[data-prod="${a}"]`).value = a === "Inventario" ? PROD[a] : +PROD[a].toFixed(1)));
  }
  const run = () => { syncInputs(); render(); };

  AH.dotacion = {
    init() {
      $("#dtEsc").innerHTML = Object.entries(ESC).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
      $("#dtSplit").innerHTML = TURNOS.map((t) => `<div class="field"><label>${t} (%)</label><input type="number" min="0" max="100" data-split="${t}"></div>`).join("");
      $("#dtProd").innerHTML = AREAS.map((a) => `<div class="field"><label><span class="dot" style="background:${COLOR[a]}"></span> ${a} <span class="muted">· ${INFO[a].unidad}</span></label><input type="number" min="0.1" step="0.1" data-prod="${a}"><span class="hint">${INFO[a].driver}</span></div>`).join("");
      ["Inbound", "Picking", "Bulky", "Packing", "Despacho", "Inventario"].forEach((a) => $("#dtFArea").insertAdjacentHTML("beforeend", `<option value="${a}">${a}</option>`));
      TURNOS.forEach((t) => $("#dtFTurno").insertAdjacentHTML("beforeend", `<option value="${t}">${t}</option>`));
      [...new Set(ROSTER.map((c) => c.contrato))].forEach((c) => $("#dtFContrato").insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`));

      $("#dtEsc").addEventListener("change", (e) => { P.esc = e.target.value; run(); });
      $("#dtAjuste").addEventListener("input", (e) => { P.ajuste = +e.target.value; run(); });
      $("#dtUtil").addEventListener("input", (e) => { P.util = +e.target.value; run(); });
      $("#dtAus").addEventListener("input", (e) => { P.ausExtra = +e.target.value; run(); });
      $("#dtHoras").addEventListener("change", (e) => { P.horas = Math.min(12, Math.max(4, +e.target.value || 8)); run(); });
      $("#dtHe").addEventListener("change", (e) => { P.heMax = Math.min(4, Math.max(0, +e.target.value || 0)); run(); });
      $("#dtSplit").addEventListener("change", (e) => { const t = e.target.dataset.split; if (t) { P.split[t] = Math.max(0, +e.target.value || 0); run(); } });
      $("#dtProd").addEventListener("change", (e) => { const a = e.target.dataset.prod; if (a) { PROD[a] = Math.max(0.1, +e.target.value || PROD_DEF[a]); run(); } });
      $("#dtPoli").addEventListener("change", (e) => { P.poli = e.target.checked; run(); });
      $("#dtExt").addEventListener("change", (e) => { P.excluirExterno = e.target.checked; run(); });
      $("#dtSup").addEventListener("change", (e) => { P.protegerSuper = e.target.checked; run(); });
      ["#dtFArea", "#dtFTurno", "#dtFContrato", "#dtSoloMov"].forEach((s) => $(s).addEventListener("change", renderPlantilla));
      $("#dtQ").addEventListener("input", renderPlantilla);
      $("#dtBtnMC").addEventListener("click", montecarlo);
      $("#dtBtnReset").addEventListener("click", () => { Object.assign(P, JSON.parse(JSON.stringify(DEF))); Object.assign(PROD, PROD_DEF); run(); AH.toast("Parámetros restablecidos a la situación actual"); });
      $("#dtBtnCyber").addEventListener("click", () => { Object.assign(P, { esc: "cyber27", ajuste: 0, ausExtra: 2, split: { Mañana: 40, Tarde: 38, Noche: 22 } }); run(); AH.toast("Escenario CyberDay 2027: demanda de junio +18% y +2 pp de ausentismo"); });
      $("#dtBtnCSV").addEventListener("click", () => {
        const rows = [["Colaborador", "Turno", "Área base", "Área asignada", "Contrato", "Antigüedad", "RF", "WMS", "Lean", "MMC", "Superusuario", "Ausentismo 90d", "Brecha formación"]];
        ROSTER.forEach((c) => rows.push([c.id, c.turno, c.area, last.asg[c.id], c.contrato, c.antig, c.rf ? "Sí" : "No", c.wms ? "Sí" : "No", c.lean ? "Sí" : "No", c.mmc ? "Sí" : "No", c.sup ? "Sí" : "No", c.aus, c.brecha]));
        AH.downloadCSV(`distribucion_empleados_${P.esc}.csv`, rows);
      });
      $("#dtSupuestos").innerHTML = `Productividades calibradas para que la plantilla actual cubra la demanda promedio ene–may con 8 h y 85% de utilización: ${AREAS.filter((a) => a !== "Inventario").map((a) => `${a} ${fmt.n1(PROD_DEF[a])} ${INFO[a].unidad}`).join(" · ")}; Inventario ${fmt.n1(PROD_DEF.Inventario)} personas/día fijas.`;
      run();
    },
    rerender() { if (last) render(); },
  };
})();
