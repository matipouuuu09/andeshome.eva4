/* =========================================================
   app.js — router por hash e inicialización
   ========================================================= */
(() => {
  const { $, $$ } = AH;
  const VIEWS = ["dashboard", "agenda", "wms", "waves"];

  function route() {
    const v = (location.hash || "#dashboard").slice(1);
    const view = VIEWS.includes(v) ? v : "dashboard";
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + view));
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + view));
    $("#nav").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    if (view === "dashboard") AH.dashboard.refresh();
  }

  document.addEventListener("DOMContentLoaded", () => {
    AH.load();
    AH.wms.init();
    AH.agenda.init();
    AH.dashboard.init();
    AH.waves.init();
    window.addEventListener("hashchange", route);
    route();
    $("#overlay").addEventListener("click", AH.closeDrawer);
    $("#drawerClose").addEventListener("click", AH.closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") AH.closeDrawer(); });
    $("#menuBtn").addEventListener("click", () => $("#nav").classList.toggle("open"));
    $("#resetData").addEventListener("click", (e) => { e.preventDefault(); if (confirm("Se borrarán las citas, movimientos y escenarios guardados en este navegador. ¿Continuar?")) AH.resetAll(); });
  });
})();
