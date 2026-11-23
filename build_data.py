"""
Genera los archivos data/*.js del sitio a partir de la base Excel del caso AndesHome.

Uso:
    pip install pandas openpyxl
    python scripts/build_data.py ruta/Base_Datos_GLA1104_AndesHome_v2.xlsx

Cada archivo define una variable global (window.AH_...) para que el sitio funcione
como sitio estático en Vercel y también abriendo index.html directamente.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "Base_Datos_GLA1104_AndesHome_v2.xlsx")
OUT = Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(exist_ok=True)


def sheet(name, **kw):
    return pd.read_excel(SRC, sheet_name=name, **kw)


def r(x, n=2):
    try:
        if pd.isna(x):
            return None
    except TypeError:
        pass
    if isinstance(x, float):
        return round(x, n)
    return x


def write(name, var, obj):
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str)
    txt = re.sub(r"\bNaN\b", "null", txt)
    (OUT / f"{name}.js").write_text(f"window.{var}={txt};\n", encoding="utf-8")
    print(f"{name}.js  {len(txt)/1024:.0f} KB")


# ---------------------------------------------------------------- dashboard
panel = sheet("Panel", header=3).iloc[:7, :6]
panel.columns = ["kpi", "prom12", "jun", "meta", "brecha", "lectura"]

kpi = sheet("KPI_Mensual").iloc[:, :16].dropna(subset=["Mes"])
kpi["Mes"] = kpi["Mes"].dt.strftime("%Y-%m")

pd_ = sheet("Pedidos_Diarios")
pd_["Fecha"] = pd_["Fecha"].dt.strftime("%Y-%m-%d")
diarios = [
    [x["Fecha"], x["Canal"], int(x["Pedidos"]), int(x["Líneas"]), int(x["A tiempo"]), int(x["Pedidos perfectos"]),
     int(x["Backlog cierre"]), r(x["Ciclo real (h)"], 1), 1 if x["Peak Cyber"] == "Sí" else 0, r(x["Cola (h)"], 1)]
    for _, x in pd_.iterrows()
]
# columnas: fecha, canal, pedidos, lineas, a_tiempo, perfectos, backlog, ciclo_h, peak, cola_h

fc = sheet("Forecast_36M").dropna(subset=["Mes"])
fc["Mes"] = fc["Mes"].dt.strftime("%Y-%m")

tr = sheet("Transportistas")
prov = sheet("Proveedores")
sla = sheet("SLA_Canales").dropna(subset=["Canal"])
lay = sheet("Layout_Capacidad")
mhe = sheet("Equipos_MHE")
sup = sheet("Supuestos")
proy = sheet("Proyectos")

dev = sheet("Devoluciones")
dev_par = (dev.groupby("Motivo").agg(costo=("Costo CLP", "sum"), casos=("Devolución", "count"))
           .sort_values("costo", ascending=False).reset_index())

cost = sheet("Costos_Operacion")
cost["Mes"] = cost["Mes"].dt.strftime("%Y-%m")
cost_m = cost.groupby("Mes")[["Presupuesto CLP", "Real CLP"]].sum().reset_index()

rec = sheet("Reclamos_Clientes")
rec_m = rec.groupby("Motivo").size().sort_values(ascending=False).reset_index(name="casos")

prod = sheet("Productividad")
prod["Peak"] = prod["Fecha"].dt.month.eq(6)
prod_zona = (prod.groupby(["Zona", "Peak"]).agg(lh=("Líneas/hora", "mean"), dot=("Dotación real", "mean"),
             err=("Errores picking", "sum"), lin=("Líneas preparadas", "sum")).reset_index())
prod_turno = prod.groupby(["Turno", "Zona"])["Dotación plan"].mean().round().reset_index()

dash = {
    "panel": panel.map(lambda x: r(x, 4)).to_dict("records"),
    "kpi": kpi.map(lambda x: r(x, 3)).to_dict("records"),
    "diarios": diarios,
    "forecast": fc.map(r).to_dict("records"),
    "transportistas": tr.map(lambda x: r(x, 4)).to_dict("records"),
    "proveedores": prov.map(lambda x: r(x, 4)).to_dict("records"),
    "sla": sla.map(lambda x: r(x, 4)).to_dict("records"),
    "layout": lay.map(lambda x: r(x, 3)).to_dict("records"),
    "mhe": mhe.map(r).to_dict("records"),
    "supuestos": sup.map(r).to_dict("records"),
    "proyectos": proy.map(r).to_dict("records"),
    "devoluciones": dev_par.map(r).to_dict("records"),
    "costos": cost_m.map(r).to_dict("records"),
    "reclamos": rec_m.to_dict("records"),
    "prodZona": prod_zona.map(lambda x: r(x, 2)).to_dict("records"),
    "prodTurno": prod_turno.to_dict("records"),
}
write("dashboard", "AH_DASH", dash)

# ---------------------------------------------------------------- recepciones (agenda)
rc = sheet("Recepciones")
recs = []
for row in rc.itertuples(index=False):
    recs.append({
        "id": row[0], "fecha": row[1].strftime("%Y-%m-%d"), "origenTipo": row[2], "origen": row[3],
        "proveedor": row[4], "cita": row[5].strftime("%H:%M"),
        "atrasoMin": round((row[6] - row[5]).total_seconds() / 60),
        "asn": row[7], "citaAnden": row[8], "pallets": int(row[9]), "unidades": int(row[10]),
        "espera": r(row[11], 1), "descarga": r(row[12], 1), "qc": r(row[13], 1),
        "putaway": r(row[14], 1), "d2s": r(row[15], 2), "defectos": int(row[16]),
    })
write("recepciones", "AH_REC", recs)

# ---------------------------------------------------------------- WMS
sku = sheet("SKU_Master")
inv = sheet("Inventario")[["SKU", "Stock físico", "Minutos conteo", "Días desde conteo"]]
s = sku.merge(inv, on="SKU")
skus = [{
    "sku": x.SKU, "fam": x.Familia, "abc": x.ABC, "dem": int(x["Demanda mensual"]), "cv": r(x["CV demanda"]),
    "valor": int(x["Valor unitario CLP"]), "dims": [r(x["Largo cm"]), r(x["Ancho cm"]), r(x["Alto cm"])],
    "peso": r(x["Peso kg"], 1), "zona": x["Zona actual"], "zonaIdeal": x["Zona ideal"],
    "dist": r(x["Distancia pick m"], 1), "visitas": r(x["Visitas pick/día"], 1),
    "mmc": x["MMC >25kg manual"] == "Sí", "codigo": x["Código"],
    "sis": int(x["Stock sistema"]), "fis": int(x["Stock físico"]), "diasConteo": int(x["Días desde conteo"]),
} for _, x in s.iterrows()]
write("skus", "AH_SKU", skus)

dq = sheet("Calidad_Datos")
write("calidad", "AH_DQ", dq.map(r).to_dict("records"))

o = sheet("Ordenes_Muestra")
canal_i = {c: i for i, c in enumerate(sorted(o["Canal"].unique()))}
orders = [[x.Pedido, x.Creación.strftime("%Y-%m-%d %H:%M"), x.Canal, x.Región, x.Prioridad, int(x.Líneas),
           int(x.Unidades), int(x["Promesa h"]), 1 if x["A tiempo"] == "Sí" else 0,
           1 if x["Pedido perfecto"] == "Sí" else 0, 1 if x.Cancelado == "Sí" else 0,
           int(x["Venta CLP"]), int(x["Costo logístico CLP"]), 1 if x.Peak == "Sí" else 0]
          for _, x in o.iterrows()]
write("ordenes", "AH_ORD", orders)

ln = sheet("Lineas_Pedido")
lines = [[x.Pedido, x.SKU, x.ABC, x["Zona pick"], int(x["Cantidad pedida"]), int(x["Cantidad preparada"]),
          1 if x["Error pick"] == "Sí" else 0, r(x["Pick seg"], 1), r(x["Pack seg"], 1),
          r(x["Distancia m"], 1), r(x["Peso unit kg"], 1)]
         for _, x in ln.iterrows()]
write("lineas", "AH_LIN", lines)
print("Listo.")
