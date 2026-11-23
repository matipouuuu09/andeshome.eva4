/* =========================================================
   sim3d.js — Simulación 3D del CD Pudahuel (figuras low-poly)
   Cada figura es un colaborador real de Turnos_Competencias que
   asistió al turno. Toma la dotación, la demanda y la productividad
   del simulador de distribución de personal (AH.dotacion) y las
   convierte en un modelo de agentes: llegan líneas, pallets y
   camiones; las personas caminan, preparan, embalan, ubican y
   despachan. Si falta gente en un área, su cola crece.
   Motor 3D: Three.js r149 (MIT), incluido en el sitio.
   ========================================================= */
(() => {
  const { $, $$, fmt, esc } = AH;
  const TH = window.THREE;

  /* ---------- layout del CD (metros) ---------- */
  const CROSS = [-26, 12];                       // pasillos transversales
  const RACK_Z = [-22, 8];                       // largo de los racks
  const ZONAS = {
    "C-Lenta": { aisles: [-29, -22], h: 6.6, peso: 0.427, color: "#1baf7a" },
    "B-Media": { aisles: [-12, -5], h: 4.9, peso: 0.320, color: "#eb6834" },
    "A-Rápida": { aisles: [3.5, 10], h: 3.3, peso: 0.212, color: "#2a78d6" },
  };                                             // peso = mezcla de líneas por zona (Lineas_Pedido)
  const DOCKS = [-18, -6, 6, 18];
  const INICIO = { Mañana: 6 * 60, Tarde: 14 * 60, Noche: 22 * 60 };
  const T_PICK = 12, T_BULKY = 20, UNI_PALLET = 72.6, PALLETS_CAMION = 18, PAQ_CAMION = 30;
  const VEL = [1, 3, 6, 12];

  const S = { speed: 3, turno: "Mañana", playing: true, seed: 3 };
  let inited = false, visible = false, raf = 0, lastTs = 0, lastHud = 0, sig = "";
  let renderer, scene, camera, ray, root, statics, cam = { theta: 0.38, phi: 0.9, r: 130, tx: -7, tz: 4 };
  let W = null, sel = null;
  const MAT = {};
  const mat = (c, o = {}) => (MAT[c + JSON.stringify(o)] ||= new TH.MeshLambertMaterial({ color: c, flatShading: true, ...o }));

  /* ---------- utilidades geométricas ---------- */
  const box = (w, h, d, c, x = 0, y = 0, z = 0, cast = true) => { const m = new TH.Mesh(new TH.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m; };
  const inRack = (p) => p.x > -33 && p.x < 13.5 && p.z > -23.5 && p.z < 9.5;
  function ruta(a, b) {
    const cruza = (inRack(a) || inRack(b)) || (Math.min(a.x, b.x) < 13.5 && Math.max(a.x, b.x) > -33 && Math.max(a.z, b.z) > -23.5 && Math.min(a.z, b.z) < 9.5);
    if (!cruza) return [b];
    const cz = CROSS.reduce((best, c) => (Math.abs(a.z - c) + Math.abs(b.z - c) < Math.abs(a.z - best) + Math.abs(b.z - best) ? c : best), CROSS[0]);
    return [{ x: a.x, z: cz }, { x: b.x, z: cz }, b];
  }
  function label(text, color = "#0b2e4f", scale = 1) {
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "rgba(255,255,255,.92)"; g.beginPath(); if (g.roundRect) g.roundRect(4, 20, 504, 88, 44); else g.rect(4, 20, 504, 88); g.fill();
    g.fillStyle = color; g.font = "700 44px 'Plus Jakarta Sans', Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 66);
    const sp = new TH.Sprite(new TH.SpriteMaterial({ map: new TH.CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.scale.set(12 * scale, 3 * scale, 1); sp.renderOrder = 10; return sp;
  }
  function instanced(geo, material, list, colors) {
    const m = new TH.InstancedMesh(geo, material, Math.max(1, list.length));
    const o = new TH.Object3D();
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.ry || 0, 0); o.scale.set(p.sx || 1, p.sy || 1, p.sz || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); if (colors) m.setColorAt(i, new TH.Color(colors[i])); });
    m.count = list.length; m.castShadow = true; m.receiveShadow = true; return m;
  }

  /* ---------- escena estática ---------- */
  function construirEstatico() {
    statics = new TH.Group(); scene.add(statics);
    // piso y zonas
    const piso = new TH.Mesh(new TH.PlaneGeometry(112, 70), mat("#e3ecf3")); piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true; statics.add(piso);
    const afuera = new TH.Mesh(new TH.PlaneGeometry(260, 200), mat("#b9cbd8")); afuera.rotation.x = -Math.PI / 2; afuera.position.y = -0.05; afuera.receiveShadow = true; statics.add(afuera);
    const zona = (x0, x1, z0, z1, c, txt) => {
      const m = new TH.Mesh(new TH.PlaneGeometry(x1 - x0, z1 - z0), new TH.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.22 }));
      m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); m.receiveShadow = true; statics.add(m);
      if (txt) { const l = label(txt, "#0b2e4f", 1.3); l.position.set((x0 + x1) / 2, 12, (z0 + z1) / 2); statics.add(l); }
    };
    zona(-53, -36, -25, 25, "#2a78d6", "Recepción");
    zona(-33, -17.5, -24, 10, ZONAS["C-Lenta"].color, "C-Lenta");
    zona(-15.5, -1.5, -24, 10, ZONAS["B-Media"].color, "B-Media");
    zona(0.5, 13.5, -24, 10, ZONAS["A-Rápida"].color, "A-Rápida");
    zona(-33, 13.5, 15, 31, "#eda100", "Bulky");
    zona(16, 30, -25, 11, "#6250d6", "Packing");
    zona(33, 53, -25, 25, "#1baf7a", "Despacho");
    zona(16, 30, 15, 31, "#e87ba4", "Inventario");
    // líneas de pasillo
    CROSS.forEach((z) => { const m = new TH.Mesh(new TH.PlaneGeometry(50, 0.25), mat("#f2c94c")); m.rotation.x = -Math.PI / 2; m.position.set(-10, 0.03, z - 1.6); statics.add(m); const m2 = m.clone(); m2.position.z = z + 1.6; statics.add(m2); });
    // muros bajos con andenes
    const muro = "#9fb2c4";
    [[0, -35, 112, 0.5], [0, 35, 112, 0.5]].forEach(([x, z, w, d]) => statics.add(box(w, 1.6, d, muro, x, 0.8, z)));
    [-56, 56].forEach((x) => {
      let prev = -35;
      DOCKS.concat([35 + 2.2]).forEach((dz) => { const a = prev, b = dz - 2.2; if (b > a) statics.add(box(0.5, 1.6, b - a, muro, x, 0.8, (a + b) / 2)); prev = dz + 2.2; });
      DOCKS.forEach((dz, i) => { const n = label(`Andén ${x < 0 ? i + 1 : i + 13}`, "#3d5670", 0.45); n.position.set(x + (x < 0 ? 2 : -2), 3.2, dz); statics.add(n); });
    });
    // racks (instanciados)
    const ups = [], beams = [], cajas = [], colCajas = [];
    const pal = ["#c69c6d", "#b8875a", "#d8b48a", "#a8794b", "#e0c39b"];
    const rnd = AH.rng(42);
    Object.entries(ZONAS).forEach(([z, Z]) => Z.aisles.forEach((ax) => [-1, 1].forEach((s) => {
      const rx = ax + s * 2.25, niveles = Math.max(2, Math.round(Z.h / 1.6));
      for (let zz = RACK_Z[0]; zz <= RACK_Z[1] + 0.01; zz += 2.5) ups.push({ x: rx, y: Z.h / 2, z: zz, sy: Z.h });
      for (let n = 0; n < niveles; n++) {
        const y = 0.15 + n * (Z.h / niveles);
        beams.push({ x: rx, y, z: (RACK_Z[0] + RACK_Z[1]) / 2, sy: 1 });
        for (let zz = RACK_Z[0] + 0.7; zz < RACK_Z[1]; zz += 1.25) if (rnd() < 0.78) { const hh = 0.6 + rnd() * 0.5; cajas.push({ x: rx + (rnd() - 0.5) * 0.2, y: y + 0.08 + hh / 2, z: zz, sx: 1, sy: hh, sz: 1 }); colCajas.push(pal[Math.floor(rnd() * pal.length)]); }
      }
    })));
    statics.add(instanced(new TH.BoxGeometry(0.18, 1, 0.18), mat("#2f5d8a"), ups));
    statics.add(instanced(new TH.BoxGeometry(1.5, 0.12, RACK_Z[1] - RACK_Z[0]), mat("#eb6834"), beams));
    statics.add(instanced(new TH.BoxGeometry(1.2, 1, 1), new TH.MeshLambertMaterial({ color: "#ffffff", flatShading: true }), cajas, colCajas));
    // pilas bulky
    const bk = [], bkc = [];
    for (let x = -30; x <= 10; x += 4) for (let z = 21; z <= 29; z += 3.2) { const n = 1 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) { bk.push({ x: x + (rnd() - 0.5), y: 0.75 + k * 1.5, z, sx: 2.6, sy: 1.4, sz: 2.2, ry: (rnd() - 0.5) * 0.2 }); bkc.push(pal[Math.floor(rnd() * pal.length)]); } }
    statics.add(instanced(new TH.BoxGeometry(1, 1, 1), new TH.MeshLambertMaterial({ color: "#fff", flatShading: true }), bk, bkc));
    // mesas de packing
    for (let i = 0; i < 12; i++) { const z = -22 + i * 2.75; statics.add(box(2.2, 0.9, 1.7, "#dfe6ee", 23.5, 0.45, z)); statics.add(box(0.15, 1.2, 1.7, "#6250d6", 22.4, 1.2, z)); }
    // cinta transportadora hacia despacho
    statics.add(box(1.3, 0.7, 34, "#7a8ea3", 30.5, 0.35, -6));
    // oficina de inventario
    statics.add(box(6, 2.6, 4, "#f4f7fa", 23, 1.3, 24)); statics.add(box(6.4, 0.2, 4.4, "#e87ba4", 23, 2.7, 24));
  }

  /* ---------- figuras dinámicas ---------- */
  function figura(color) {
    const g = new TH.Group();
    const piel = mat("#f1c9a5"), ropa = mat(color), pant = mat("#2b3f55");
    const pL = new TH.Mesh(new TH.BoxGeometry(0.28, 0.85, 0.3), pant); pL.position.set(-0.17, 0.43, 0); const pR = pL.clone(); pR.position.x = 0.17;
    const torso = new TH.Mesh(new TH.CylinderGeometry(0.36, 0.42, 0.95, 6), ropa); torso.position.y = 1.3;
    const chaleco = new TH.Mesh(new TH.CylinderGeometry(0.38, 0.38, 0.18, 6), mat("#e8ff5a")); chaleco.position.y = 1.45;
    const cabeza = new TH.Mesh(new TH.IcosahedronGeometry(0.27, 0), piel); cabeza.position.y = 2.05;
    const casco = new TH.Mesh(new TH.SphereGeometry(0.3, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat(color)); casco.position.y = 2.12;
    const bL = new TH.Mesh(new TH.BoxGeometry(0.16, 0.7, 0.18), ropa); bL.position.set(-0.5, 1.35, 0); const bR = bL.clone(); bR.position.x = 0.5;
    const carga = new TH.Group(); carga.position.set(0, 1.1, 0.6);
    [pL, pR, torso, chaleco, cabeza, casco, bL, bR].forEach((m) => { m.castShadow = true; g.add(m); });
    g.add(carga);
    const anillo = new TH.Mesh(new TH.RingGeometry(0.55, 0.75, 6), new TH.MeshBasicMaterial({ color: "#eb6834" })); anillo.rotation.x = -Math.PI / 2; anillo.position.y = 0.05; anillo.visible = false; g.add(anillo);
    g.scale.setScalar(1.3);
    g.userData = { pL, pR, bL, bR, carga, anillo };
    return g;
  }
  const CARGAS = {
    tote: () => box(0.8, 0.45, 0.6, "#eb6834", 0, 0, 0),
    caja: () => box(0.7, 0.55, 0.6, "#c69c6d", 0, 0, 0),
    bulky: () => box(1.6, 1.1, 1.0, "#d8b48a", 0, 0.1, 0.2),
    scanner: () => box(0.18, 0.12, 0.3, "#0b2e4f", 0.3, 0.2, -0.2),
    pallet: () => { const g = new TH.Group(); g.add(box(1.2, 0.15, 1.0, "#a8794b", 0, -0.95, 0.6)); g.add(box(1.1, 1.0, 0.9, "#c69c6d", 0, -0.35, 0.6)); g.add(box(0.1, 1.0, 0.1, "#0b2e4f", 0, -0.6, -0.15)); return g; },
  };
  function setCarga(w, tipo) {
    const c = w.g.userData.carga; if (w.cargaTipo === tipo) return;
    while (c.children.length) c.remove(c.children[0]);
    if (tipo) c.add(CARGAS[tipo]()); w.cargaTipo = tipo;
  }
  function camion(color) {
    const g = new TH.Group();
    g.add(box(9, 3, 2.6, "#dfe6ee", 0, 2.1, 0)); g.add(box(9.05, 0.35, 2.65, color, 0, 3.4, 0));
    g.add(box(2.4, 2.4, 2.5, color, 5.9, 1.8, 0)); g.add(box(0.1, 0.9, 2.1, "#9fd3ff", 7.1, 2.3, 0));
    const rg = new TH.CylinderGeometry(0.55, 0.55, 0.4, 8); rg.rotateX(Math.PI / 2);
    [-3, -1.6, 2.5, 5.9].forEach((x) => [-1.2, 1.2].forEach((z) => { const r = new TH.Mesh(rg, mat("#26323f")); r.position.set(x, 0.55, z); r.castShadow = true; g.add(r); }));
    const bar = new TH.Mesh(new TH.BoxGeometry(8.6, 0.25, 0.1), new TH.MeshBasicMaterial({ color: "#1baf7a" })); bar.position.set(0, 3.0, 1.36); g.add(bar);
    g.userData.bar = bar; return g;
  }
  function stockMesh(geo, color, slots) {
    const m = new TH.InstancedMesh(geo, mat(color), slots.length); const o = new TH.Object3D();
    slots.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.count = 0; m.castShadow = true; m.receiveShadow = true; return m;
  }
  const grid = (x0, x1, z0, z1, step, y) => { const s = []; for (let x = x0; x <= x1 + 0.01; x += step) for (let z = z0; z <= z1 + 0.01; z += step) s.push({ x, y, z }); return s; };

  /* ---------- mundo (estado de la simulación) ---------- */
  function crearMundo() {
    if (root) scene.remove(root);
    root = new TH.Group(); scene.add(root);
    const snap = AH.dotacion.snapshot();
    const { P, PROD, drv, ROSTER, COLOR, req, asg, pres } = snap;
    const t = S.turno, U = P.util / 100, H = P.horas;
    const share = (+P.split[t] || 0) / (Object.values(P.split).reduce((a, b) => a + (+b || 0), 0) || 1);
    const lin = drv.Picking + drv.Bulky, uniPorLin = drv._uni / drv._lin;
    const rnd = AH.rng(S.seed * 131 + t.length * 7);
    const cap = (a) => PROD[a] * U / 60; // por minuto y persona
    W = {
      snap, t: 0, fin: H * 60, rnd, U, terminado: false,
      lam: { pick: drv.Picking * share / (H * 60), bulky: drv.Bulky * share / (H * 60), pallets: drv.Inbound * share / (H * 60) / UNI_PALLET },
      k: { pick: cap("Picking") * T_PICK, bulky: cap("Bulky") * T_BULKY },
      pool: { pick: 0, bulky: 0 }, colaPack: 0, staging: 0, palletsEsp: 0,
      st: { llegLin: 0, linPrep: 0, totesEmp: 0, pedEq: 0, uniDesp: 0, camOut: 0, palIn: 0, palUb: 0, conteos: 0, camIn: 0 },
      workers: [], busy: {}, n: {}, req: {},
      inTrucks: [], outTrucks: [], proxCamion: 0,
    };
    W.tPack = W.k.pick * (drv.Packing / lin) / cap("Packing");
    W.uniPaq = W.k.pick * uniPorLin; W.tDesp = W.uniPaq / cap("Despacho");
    W.tIn = UNI_PALLET / cap("Inbound");
    W.intervaloCamion = W.lam.pallets > 0 ? PALLETS_CAMION / W.lam.pallets : 1e9;
    snap.AREAS.forEach((a) => { W.busy[a] = 0; W.n[a] = 0; W.req[a] = req[a][t]; });

    // existencias visibles
    W.mStaging = stockMesh(new TH.BoxGeometry(0.9, 0.7, 0.9), "#c69c6d", grid(35, 45, -22, 22, 1.4, 0.35)); root.add(W.mStaging);
    W.mPallets = stockMesh(new TH.BoxGeometry(1.3, 1.1, 1.1), "#b8875a", grid(-51, -39, -22, 22, 2, 0.55)); root.add(W.mPallets);
    W.mTotes = stockMesh(new TH.BoxGeometry(0.8, 0.45, 0.6), "#eb6834", grid(17.5, 20.5, -22, 9, 1, 0.25)); root.add(W.mTotes);

    // camiones
    DOCKS.forEach((z, i) => {
      const ci = camion("#2a78d6"); ci.position.set(-120, 0, z); ci.rotation.y = Math.PI; root.add(ci);
      W.inTrucks.push({ g: ci, z, carga: 0, estado: "libre", x: -120 });
      const co = camion("#1baf7a"); co.position.set(120, 0, z); root.add(co);
      W.outTrucks.push({ g: co, z, carga: 0, estado: "libre", x: 120, espera: i * 3 });
    });

    // colaboradores presentes del turno (asistencia sorteada según su ausentismo)
    const enTurno = ROSTER.filter((c) => c.turno === t);
    const ext = P.ausExtra / 100;
    enTurno.forEach((c) => {
      if (rnd() >= pres(c, ext)) return;
      const area = asg[c.id];
      const w = { p: c, area, g: figura(COLOR[area]), acts: [], cur: null, estado: "Llegando", hechos: 0, busyT: 0, cargaTipo: null, fase: rnd() * 6 };
      w.g.userData.worker = w; root.add(w.g); W.workers.push(w); W.n[area]++;
    });
    // puestos de base
    const porArea = (a) => W.workers.filter((w) => w.area === a);
    porArea("Packing").forEach((w, i) => (w.home = { x: 25.2, z: -22 + (i % 12) * 2.75 + (i >= 12 ? 1.2 : 0) }));
    porArea("Picking").forEach((w, i) => (w.home = { x: 15.5, z: -20 + (i % 15) * 2 }));
    porArea("Bulky").forEach((w, i) => (w.home = { x: -28 + (i % 12) * 3.4, z: 17.2 }));
    porArea("Despacho").forEach((w, i) => (w.home = { x: 47, z: -20 + (i % 14) * 3 }));
    porArea("Inbound").forEach((w, i) => (w.home = { x: -37, z: -20 + (i % 14) * 3 }));
    porArea("Inventario").forEach((w, i) => (w.home = { x: 20 + i * 1.5, z: 20 }));
    W.workers.forEach((w) => { w.pos = { x: w.home.x + (rnd() - 0.5), z: w.home.z + (rnd() - 0.5) }; w.g.position.set(w.pos.x, 0, w.pos.z); });
    // arranque con algo de trabajo en curso y un camión de recepción en andén
    W.pool.pick = W.lam.pick * 20; W.pool.bulky = W.lam.bulky * 20; W.st.llegLin = W.pool.pick + W.pool.bulky; W.colaPack = 2; W.staging = 3;
    W.inTrucks[0].estado = "llegando"; W.inTrucks[0].carga = PALLETS_CAMION; W.proxCamion = W.intervaloCamion;
    sel = null; renderInfo();
  }

  /* ---------- comportamiento por área ---------- */
  const mover = (w, dest, dur, estado, carga, busy = true) => w.acts.push({ t: "move", dest, dur: Math.max(0.05, dur), estado, carga, busy });
  const esperar = (w, dur, estado, carga, busy = true) => w.acts.push({ t: "wait", dur: Math.max(0.05, dur), estado, carga, busy });
  const hacer = (w, fn) => w.acts.push({ t: "fn", fn });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function rackSlot(zona) {
    const Z = ZONAS[zona], ax = Z.aisles[Math.floor(W.rnd() * Z.aisles.length)];
    return { x: ax + (W.rnd() - 0.5) * 0.8, z: RACK_Z[0] + 1 + W.rnd() * (RACK_Z[1] - RACK_Z[0] - 2) };
  }
  const zonaPick = () => { const r = W.rnd() * 0.959; return r < 0.212 ? "A-Rápida" : r < 0.532 ? "B-Media" : "C-Lenta"; };
  function ocioso(w) {
    if (dist(w.pos, w.home) > 1) mover(w, w.home, dist(w.pos, w.home) / 60, "Volviendo a su puesto", null, false);
    else esperar(w, 1, "Esperando trabajo", null, false);
  }
  const PENSAR = {
    Picking(w) {
      if (W.pool.pick < W.k.pick) return ocioso(w);
      W.pool.pick -= W.k.pick;
      const z = zonaPick(), slot = rackSlot(z), drop = { x: 19, z: -21 + W.rnd() * 29 };
      mover(w, slot, T_PICK * 0.38, `Caminando a ${z}`, "tote");
      esperar(w, T_PICK * 0.24, `Preparando ${fmt.n1(W.k.pick)} líneas en ${z}`, "tote");
      mover(w, drop, T_PICK * 0.38, "Llevando el tote a packing", "tote");
      hacer(w, () => { W.colaPack++; W.st.linPrep += W.k.pick; w.hechos++; });
    },
    Bulky(w) {
      if (W.pool.bulky < W.k.bulky) return ocioso(w);
      W.pool.bulky -= W.k.bulky;
      const pick = { x: -30 + Math.floor(W.rnd() * 11) * 4, z: 18.6 }, drop = { x: 34.5, z: 12 + W.rnd() * 10 };
      mover(w, pick, T_BULKY * 0.25, "Caminando a zona Bulky", null);
      esperar(w, T_BULKY * 0.3, "Preparando y embalando voluminoso", "bulky");
      mover(w, drop, T_BULKY * 0.45, "Llevando voluminoso a despacho", "bulky");
      hacer(w, () => { W.staging++; W.st.linPrep += W.k.bulky; w.hechos++; });
    },
    Packing(w) {
      if (W.colaPack < 1) return ocioso(w);
      W.colaPack--;
      if (dist(w.pos, w.home) > 0.5) mover(w, w.home, 0.3, "Tomando tote", "tote");
      esperar(w, W.tPack, "Embalando pedidos", "tote");
      hacer(w, () => { W.staging++; W.st.totesEmp++; W.st.pedEq += W.k.pick * (W.snap.drv.Packing / (W.snap.drv.Picking + W.snap.drv.Bulky)); w.hechos++; });
    },
    Despacho(w) {
      const tr = W.outTrucks.find((x) => x.estado === "anden" && x.carga + (x.reservado || 0) < PAQ_CAMION);
      if (W.staging < 1 || !tr) return ocioso(w);
      W.staging--; tr.reservado = (tr.reservado || 0) + 1;
      const pick = { x: 35 + W.rnd() * 10, z: -22 + W.rnd() * 44 }, dock = { x: 54, z: tr.z + (W.rnd() - 0.5) * 2 };
      mover(w, pick, W.tDesp * 0.25, "Tomando bulto en staging", null);
      mover(w, dock, W.tDesp * 0.45, `Cargando camión andén ${DOCKS.indexOf(tr.z) + 13}`, "caja");
      hacer(w, () => { tr.carga++; tr.reservado--; W.st.uniDesp += W.uniPaq; w.hechos++; });
      mover(w, w.home, W.tDesp * 0.3, "Volviendo a staging", null);
    },
    Inbound(w) {
      if (W.palletsEsp < 1) return ocioso(w);
      W.palletsEsp--;
      const pal = { x: -51 + W.rnd() * 12, z: -22 + W.rnd() * 44 }, z = W.rnd() < 0.55 ? "C-Lenta" : "B-Media", slot = rackSlot(z);
      mover(w, pal, W.tIn * 0.1, "Tomando pallet recibido", null);
      esperar(w, W.tIn * 0.35, "Control de calidad y conteo", "pallet");
      mover(w, slot, W.tIn * 0.25, `Ubicando pallet en ${z}`, "pallet");
      esperar(w, W.tIn * 0.05, "Dejando pallet en rack", "pallet");
      hacer(w, () => { W.st.palUb++; w.hechos++; });
      mover(w, w.home, W.tIn * 0.25, "Volviendo a recepción", null);
    },
    Inventario(w) {
      const zs = Object.keys(ZONAS), z = zs[Math.floor(W.rnd() * 3)], slot = rackSlot(z);
      mover(w, slot, 6, `Caminando a ${z}`, "scanner");
      esperar(w, 12, `Conteo cíclico en ${z}`, "scanner");
      hacer(w, () => { W.st.conteos++; w.hechos++; });
    },
  };

  /* ---------- paso de simulación ---------- */
  function paso(dt) {
    if (W.terminado) return;
    dt = Math.min(dt, W.fin - W.t);
    W.t += dt;
    W.pool.pick += W.lam.pick * dt; W.pool.bulky += W.lam.bulky * dt; W.st.llegLin += (W.lam.pick + W.lam.bulky) * dt;
    // camiones de recepción
    W.proxCamion -= dt;
    if (W.proxCamion <= 0) { const tr = W.inTrucks.find((x) => x.estado === "libre"); if (tr) { tr.estado = "llegando"; tr.carga = PALLETS_CAMION; } W.proxCamion += W.intervaloCamion; }
    W.inTrucks.forEach((tr) => {
      if (tr.estado === "llegando") { tr.x += (-60.5 - tr.x) * Math.min(1, dt * 0.9); if (Math.abs(tr.x + 60.5) < 0.3) { tr.estado = "descargando"; tr.acum = 0; W.st.camIn++; } }
      else if (tr.estado === "descargando") { tr.acum += dt; while (tr.acum >= 1.5 && tr.carga > 0) { tr.acum -= 1.5; tr.carga--; W.palletsEsp++; W.st.palIn++; } if (tr.carga <= 0) tr.estado = "saliendo"; }
      else if (tr.estado === "saliendo") { tr.x -= dt * 12; if (tr.x < -120) { tr.x = -120; tr.estado = "libre"; } }
      tr.g.position.x = tr.x; tr.g.userData.bar.scale.x = Math.max(0.01, tr.carga / PALLETS_CAMION);
    });
    // camiones de despacho
    W.outTrucks.forEach((tr) => {
      if (tr.estado === "libre") { tr.espera -= dt; if (tr.espera <= 0) { tr.estado = "llegando"; tr.carga = 0; tr.reservado = 0; } }
      else if (tr.estado === "llegando") { tr.x += (60.5 - tr.x) * Math.min(1, dt * 0.9); if (Math.abs(tr.x - 60.5) < 0.3) tr.estado = "anden"; }
      else if (tr.estado === "anden" && tr.carga >= PAQ_CAMION) { tr.estado = "saliendo"; W.st.camOut++; }
      else if (tr.estado === "saliendo") { tr.x += dt * 12; if (tr.x > 120) { tr.x = 120; tr.estado = "libre"; tr.espera = 6; } }
      tr.g.position.x = tr.x; tr.g.userData.bar.scale.x = Math.max(0.01, tr.carga / PAQ_CAMION);
    });
    // personas
    W.workers.forEach((w) => {
      let rest = dt;
      while (rest > 1e-6) {
        if (!w.cur) { if (!w.acts.length) PENSAR[w.area](w); w.cur = w.acts.shift(); if (!w.cur) break; w.cur.el = 0;
          if (w.cur.t === "move") { w.cur.from = { ...w.pos }; w.cur.pts = ruta(w.pos, w.cur.dest); let prev = w.pos; w.cur.len = w.cur.pts.reduce((s, p) => { const d = dist(prev, p); prev = p; return s + d; }, 0) || 0.01; } }
        const a = w.cur;
        if (a.t === "fn") { a.fn(); w.cur = null; continue; }
        w.estado = a.estado; setCarga(w, a.carga);
        const use = Math.min(rest, a.dur - a.el); a.el += use; rest -= use;
        if (a.busy) { W.busy[w.area] += use; w.busyT += use; }
        if (a.t === "move") {
          let d = (a.el / a.dur) * a.len, prev = a.from, p = a.from;
          for (const q of a.pts) { const s = dist(prev, q); if (d <= s) { p = { x: prev.x + (q.x - prev.x) * (d / (s || 1)), z: prev.z + (q.z - prev.z) * (d / (s || 1)) }; w.dir = Math.atan2(q.x - prev.x, q.z - prev.z); break; } d -= s; prev = q; p = q; }
          w.pos = p; w.caminando = true;
        } else w.caminando = false;
        if (a.el >= a.dur - 1e-9) w.cur = null;
      }
    });
    if (W.t >= W.fin - 1e-9) { W.terminado = true; S.playing = false; syncCtrl(); resumen(); }
  }

  /* ---------- dibujo ---------- */
  function animarFiguras(rt) {
    W.workers.forEach((w) => {
      const g = w.g, u = g.userData;
      g.position.x += (w.pos.x - g.position.x) * 0.5; g.position.z += (w.pos.z - g.position.z) * 0.5;
      if (w.dir != null) { let d = w.dir - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * 0.25; }
      const andando = w.caminando && S.playing, f = rt * 9 + w.fase;
      const sw = andando ? Math.sin(f) * 0.6 : 0;
      u.pL.rotation.x = sw; u.pR.rotation.x = -sw;
      const conCarga = !!w.cargaTipo && w.cargaTipo !== "scanner";
      u.bL.rotation.x = conCarga ? -1.1 : -sw * 0.8; u.bR.rotation.x = conCarga ? -1.1 : sw * 0.8;
      g.position.y = andando ? Math.abs(Math.sin(f)) * 0.08 : 0;
      if (!andando && w.estado && /Embalando|Preparando|Conteo|Control/.test(w.estado) && S.playing) { u.bL.rotation.x = -0.9 + Math.sin(rt * 6 + w.fase) * 0.3; u.bR.rotation.x = -0.9 - Math.sin(rt * 6 + w.fase) * 0.3; }
      u.anillo.visible = sel === w;
    });
    W.mStaging.count = Math.min(W.staging, 264); W.mPallets.count = Math.min(W.palletsEsp, 161); W.mTotes.count = Math.min(W.colaPack, 128);
  }

  function hud() {
    const r = W, h = INICIO[S.turno] + r.t, s = r.st;
    $("#s3Reloj").textContent = fmt.hhmm(h % 1440);
    $("#s3Prog").style.width = (r.t / r.fin * 100) + "%";
    const pend = r.pool.pick + r.pool.bulky;
    $("#s3Kpis").innerHTML = [
      ["Líneas preparadas", fmt.n(s.linPrep), `de ${fmt.n(s.llegLin)} llegadas`],
      ["Líneas pendientes", fmt.n(pend), pend > (r.lam.pick + r.lam.bulky) * 60 ? "⚠ backlog creciendo" : "bajo control", pend > (r.lam.pick + r.lam.bulky) * 60],
      ["Pedidos embalados", fmt.n(s.pedEq), `${r.colaPack} totes en cola`],
      ["Camiones despachados", fmt.n(s.camOut), `${fmt.n(s.uniDesp)} unid. · ${r.staging} bultos en staging`],
      ["Pallets ubicados", fmt.n(s.palUb), `${r.palletsEsp} esperando · ${s.camIn} camiones recibidos`],
    ].map(([l, v, sub, bad]) => `<div class="s3k"><span>${l}</span><b class="num">${v}</b><small style="${bad ? "color:var(--bad);font-weight:700" : ""}">${sub}</small></div>`).join("");
    const cola = { Picking: fmt.n(r.pool.pick) + " lín.", Bulky: fmt.n(r.pool.bulky) + " lín.", Packing: r.colaPack + " totes", Despacho: r.staging + " bultos", Inbound: r.palletsEsp + " pallets", Inventario: s.conteos + " conteos" };
    $("#s3Areas").innerHTML = `<table><thead><tr><th>Área</th><th class="r">Pers.</th><th class="r">Req.</th><th class="r">Ocup.</th><th class="r">Cola</th></tr></thead><tbody>${r.snap.AREAS.map((a) => {
      const u = r.t > 0 && r.n[a] ? r.busy[a] / (r.n[a] * r.t) : 0, falta = r.n[a] + 0.5 < r.req[a];
      return `<tr><td><span class="dot" style="background:${r.snap.COLOR[a]}"></span> ${a}</td><td class="r num" style="${falta ? "color:var(--bad);font-weight:800" : ""}">${r.n[a]}</td><td class="r num muted">${fmt.n1(r.req[a])}</td><td class="r"><span class="badge ${u > 0.95 ? "b-bad" : u > 0.7 ? "b-good" : "b-warn"}">${fmt.pct(u, 0)}</span></td><td class="r num small">${cola[a]}</td></tr>`; }).join("")}</tbody></table>`;
    if (sel) renderInfo();
  }

  function renderInfo() {
    const box = $("#s3Info"); if (!box) return;
    if (!sel) { box.innerHTML = `<span class="muted">Haz clic en una persona para ver qué está haciendo.</span>`; return; }
    const c = sel.p, sk = [["RF", c.rf], ["WMS", c.wms], ["Lean", c.lean], ["MMC", c.mmc], ["Super", c.sup]].filter((x) => x[1]).map((x) => `<span class="badge b-neutral">${x[0]}</span>`).join(" ");
    box.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><b>${c.id}</b><span class="badge" style="background:${W.snap.COLOR[sel.area]};color:#fff">${sel.area}</span></div>
      <div class="small muted">${c.contrato} · ${fmt.n1(c.antig)} años${sel.area !== c.area ? ` · reasignado desde ${c.area}` : ""}</div>
      <div style="margin:6px 0">${sk || '<span class="muted small">Sin certificaciones</span>'}</div>
      <div><b>${esc(sel.estado)}</b></div><div class="small muted">${sel.hechos} tareas completadas · ocupación ${fmt.pct(W.t ? sel.busyT / W.t : 0, 0)}</div>`;
  }

  function resumen() {
    const r = W, s = r.st, pct = s.llegLin ? s.linPrep / s.llegLin : 1;
    const peor = r.snap.AREAS.filter((a) => a !== "Inventario").map((a) => ({ a, u: r.n[a] ? r.busy[a] / (r.n[a] * r.t) : 1 })).sort((x, y) => y.u - x.u)[0];
    $("#s3Resumen").innerHTML = `<div class="note ${pct < 0.95 ? "warn" : ""}"><b>Turno ${S.turno.toLowerCase()} terminado.</b> Se prepararon ${fmt.n(s.linPrep)} de ${fmt.n(s.llegLin)} líneas (${fmt.pct(pct, 0)}), se embalaron ${fmt.n(s.pedEq)} pedidos equivalentes, salieron ${s.camOut} camiones y se ubicaron ${s.palUb} de ${s.palIn} pallets recibidos. Quedan ${fmt.n(r.pool.pick + r.pool.bulky)} líneas, ${r.colaPack} totes y ${r.palletsEsp} pallets pendientes para el turno siguiente. Área más exigida: <b>${peor.a}</b> (${fmt.pct(peor.u, 0)} de ocupación).</div>`;
  }

  /* ---------- cámara (orbitar, acercar, desplazar) ---------- */
  function aplicarCam() {
    cam.phi = Math.min(1.45, Math.max(0.2, cam.phi)); cam.r = Math.min(220, Math.max(18, cam.r));
    camera.position.set(cam.tx + cam.r * Math.sin(cam.phi) * Math.sin(cam.theta), cam.r * Math.cos(cam.phi), cam.tz + cam.r * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(cam.tx, 0, cam.tz);
  }
  function controles(cv) {
    let drag = null, pinch = 0, moved = 0;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; moved = 0; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) { const k = cam.r / 600; cam.tx -= (dx * Math.cos(cam.theta) + dy * Math.sin(cam.theta)) * k; cam.tz -= (-dx * Math.sin(cam.theta) + dy * Math.cos(cam.theta)) * k; }
      else { cam.theta -= dx * 0.006; cam.phi -= dy * 0.005; }
      aplicarCam();
    });
    cv.addEventListener("pointerup", (e) => { if (drag && moved < 5) elegir(e); drag = null; });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("wheel", (e) => { e.preventDefault(); cam.r *= 1 + Math.sign(e.deltaY) * 0.1; aplicarCam(); }, { passive: false });
    cv.addEventListener("touchmove", (e) => { if (e.touches.length === 2) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pinch) { cam.r *= pinch / d; aplicarCam(); } pinch = d; drag = null; } }, { passive: false });
    cv.addEventListener("touchend", () => (pinch = 0));
  }
  function elegir(e) {
    const rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new TH.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(W.workers.map((w) => w.g), true)[0];
    let o = hit && hit.object; while (o && !o.userData.worker) o = o.parent;
    sel = o ? o.userData.worker : null; renderInfo();
  }
  const VISTAS = { iso: { theta: 0.38, phi: 0.9, r: 130, tx: -7, tz: 4 }, aerea: { theta: 0, phi: 0.2, r: 115, tx: 0, tz: 0 }, picking: { theta: 0.5, phi: 1.05, r: 45, tx: -8, tz: -6 }, andenes: { theta: 1.3, phi: 1.02, r: 62, tx: 48, tz: 0 } };

  /* ---------- ciclo de render ---------- */
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (ts - (lastTs || ts)) / 1000); lastTs = ts;
    if (S.playing && W && !W.terminado) { let simDt = dt * S.speed; while (simDt > 0) { const st = Math.min(simDt, 0.25); paso(st); simDt -= st; } }
    if (W) { animarFiguras(ts / 1000); if (ts - lastHud > 200) { hud(); lastHud = ts; } }
    renderer.render(scene, camera);
  }
  function resize() {
    const wrap = $("#s3Canvas"); if (!renderer || !wrap.clientWidth) return;
    renderer.setSize(wrap.clientWidth, wrap.clientHeight, false); camera.aspect = wrap.clientWidth / wrap.clientHeight; camera.updateProjectionMatrix();
  }
  function iniciar3D() {
    const wrap = $("#s3Canvas");
    if (!TH) { wrap.innerHTML = `<div class="empty">No se pudo cargar el motor 3D.</div>`; return false; }
    renderer = new TH.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = TH.PCFSoftShadowMap;
    renderer.outputEncoding = TH.sRGBEncoding;
    wrap.appendChild(renderer.domElement);
    scene = new TH.Scene(); scene.background = new TH.Color("#d3ebf8"); scene.fog = new TH.Fog("#d3ebf8", 180, 320);
    camera = new TH.PerspectiveCamera(40, 1, 0.5, 600);
    scene.add(new TH.HemisphereLight("#ffffff", "#9fb2c4", 0.75));
    const sol = new TH.DirectionalLight("#ffffff", 0.85); sol.position.set(-40, 80, 50); sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048); Object.assign(sol.shadow.camera, { left: -75, right: 75, top: 60, bottom: -60, near: 1, far: 220 }); sol.shadow.bias = -0.0005;
    scene.add(sol);
    ray = new TH.Raycaster();
    construirEstatico(); controles(renderer.domElement);
    new ResizeObserver(resize).observe(wrap); resize(); aplicarCam();
    return true;
  }

  /* ---------- controles de la vista ---------- */
  function syncCtrl() {
    $("#s3Play").textContent = S.playing ? "⏸ Pausa" : (W && W.terminado ? "↻ Repetir turno" : "▶ Reanudar");
    $$("#s3Vel button").forEach((b) => b.classList.toggle("on", +b.dataset.v === S.speed));
    $$("#s3Turno button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.turno));
  }
  const firma = () => JSON.stringify(AH.dotacion.snapshot().P) + JSON.stringify(AH.dotacion.snapshot().PROD);
  function reiniciar() { crearMundo(); $("#s3Resumen").innerHTML = ""; S.playing = true; sig = firma(); $("#s3Esc").value = W.snap.P.esc; syncCtrl(); }

  AH.sim3d = {
    _debug: () => ({ W, camera, renderer, avanzar: (m) => { while (m > 0 && W && !W.terminado) { paso(Math.min(m, 0.25)); m -= 0.25; } } }),
    init() {
      $("#s3Esc").innerHTML = Object.entries(AH.dotacion.snapshot().ESC).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
      $("#s3Vel").innerHTML = VEL.map((v) => `<button type="button" data-v="${v}">${v === 1 ? "1 min/s" : v + " min/s"}</button>`).join("");
      $("#s3Turno").innerHTML = ["Mañana", "Tarde", "Noche"].map((t) => `<button type="button" data-v="${t}">${t}</button>`).join("");
      $("#s3Vel").addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { S.speed = +v; syncCtrl(); } });
      $("#s3Turno").addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { S.turno = v; reiniciar(); } });
      $("#s3Esc").addEventListener("change", (e) => { AH.dotacion.setEsc(e.target.value); reiniciar(); });
      $("#s3Play").addEventListener("click", () => { if (W && W.terminado) return reiniciar(); S.playing = !S.playing; syncCtrl(); });
      $("#s3Reset").addEventListener("click", () => { S.seed++; reiniciar(); });
      $("#s3Vistas").addEventListener("click", (e) => { const v = VISTAS[e.target.dataset.v]; if (v) { Object.assign(cam, v); aplicarCam(); } });
      syncCtrl();
    },
    show() {
      visible = true;
      if (!inited) { inited = iniciar3D(); if (!inited) return; reiniciar(); }
      else if (firma() !== sig) reiniciar();
      resize(); lastTs = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    hide() { visible = false; cancelAnimationFrame(raf); },
  };
})();
