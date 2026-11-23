# AndesHome · CD Pudahuel — Plataforma de operación logística

Sitio web estático para el Centro de Distribución Pudahuel de **AndesHome Chile S.A.** (caso GLA1104). Integra cuatro módulos que trabajan con los datos reales de `Base_Datos_GLA1104_AndesHome_v2.xlsx`:

| Módulo | Qué hace | Hojas de la base | Iniciativa del informe |
|---|---|---|---|
| **Dashboard** | Torre de control interactiva: OTIF, pedido perfecto, backlog y ciclo filtrables por canal y período; línea base vs metas; tendencia 12M; pronóstico 36M; ASN por proveedor; transportistas; Pareto de devoluciones; costos | Panel, KPI_Mensual, Pedidos_Diarios, Forecast_36M, SLA_Canales, Proveedores, Transportistas, Devoluciones, Costos_Operacion | I17 |
| **Agendamiento de camiones** | Formulario de reserva de andén (recepción y despacho) con validación de patente, RUT y teléfono; duración calculada por pallets; bloques disponibles en 24 andenes; comprobante imprimible; tablero del día con check-in → operación → cierre; política de ASN obligatorio; analítica histórica de dock-to-stock | Recepciones, Proveedores, Transportistas | I8 · I9 |
| **Mini WMS** | Inventario de 450 SKU (sistema vs físico), filtros y orden, conteo cíclico, reubicación, ingresos/salidas, re-slotting ABC masivo, ocupación por zona, matriz zona actual vs ideal, equipos MHE, órdenes con sus líneas, calidad de datos y exportación CSV | SKU_Master, Inventario, Layout_Capacidad, Equipos_MHE, Ordenes_Muestra, Lineas_Pedido, Calidad_Datos | I6 · I7 |
| **Simulación de olas** | Arma un turno con pedidos y líneas reales, lo libera en olas fijas o dinámicas (límite WIP), con picking discreto, por lotes o por zona; muestra Gantt, carga vs capacidad, cumplimiento de corte por canal, horas extra, errores y costo por pedido; guarda y compara escenarios | Ordenes_Muestra, Lineas_Pedido, Productividad, Supuestos | I3 · I4 · I5 · I18 |

Los módulos están conectados: al **cerrar una cita de recepción** con detalle de SKU, el stock entra al Mini WMS; el **re-slotting** del WMS cambia los recorridos de la simulación de olas; y el dashboard muestra el estado en vivo de la agenda y del inventario.

## Estructura

```
├── index.html            # SPA con 4 vistas (navegación por #hash)
├── css/styles.css        # Estilo minimalista: fondo celeste claro, tarjetas blancas, acentos azul marino y coral
├── js/
│   ├── core.js           # utilidades, formato es-CL, estado (localStorage), validación RUT/patente, estilos Chart.js
│   ├── wms.js            # Mini WMS
│   ├── agenda.js         # Agendamiento de camiones / YMS ligero
│   ├── dashboard.js      # Dashboard interactivo
│   ├── waves.js          # Simulador de olas de picking
│   └── app.js            # router e inicialización
├── data/*.js             # datos extraídos del Excel (generados)
├── vendor/chart.umd.min.js  # Chart.js 4 (incluido, no depende de CDN)
├── scripts/build_data.py    # regenera data/*.js desde el Excel
└── vercel.json
```

No necesita build ni dependencias: es HTML, CSS y JavaScript puro. También funciona abriendo `index.html` directamente en el navegador.

## Subir a GitHub

```bash
cd andeshome-cd
git init
git add .
git commit -m "Plataforma CD Pudahuel: agenda de andenes, mini WMS, dashboard y simulación de olas"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/andeshome-cd.git
git push -u origin main
```

## Desplegar en Vercel

1. Entra a [vercel.com](https://vercel.com) → **Add New… → Project** → importa el repositorio.
2. **Framework Preset:** `Other`. Deja vacíos *Build Command* y *Output Directory* (raíz).
3. **Deploy.** Cada `git push` a `main` vuelve a desplegar automáticamente.

Alternativa por terminal: `npm i -g vercel` y luego `vercel --prod` dentro de la carpeta.

## Actualizar los datos

Si cambia la base Excel:

```bash
pip install pandas openpyxl
python scripts/build_data.py scripts/Base_Datos_GLA1104_AndesHome_v2.xlsx
```

## Persistencia

Las citas, movimientos del WMS y escenarios guardados se almacenan en el `localStorage` del navegador (cada usuario ve sus propios datos). El enlace **“Restablecer datos de demostración”** del pie de página vuelve al estado inicial. Para uso multiusuario real, el siguiente paso es reemplazar `AH.load/AH.save` (en `js/core.js`) por una API con base de datos (por ejemplo Vercel Functions + Postgres o Supabase).

## Supuestos principales

- Andenes 1–12 para recepción (06:00–18:00) y 13–24 para despacho (06:00–22:00), bloques de 30 min.
- Duración en andén = 20 min de maniobra + 4,0 min/pallet (promedio de descarga de la hoja Recepciones) × factor por tipo de carga.
- Simulación: tiempo de manipulación por zona calibrado para reproducir las líneas/hora observadas (hoja Productividad); recorrido = distancia real ÷ velocidad; lotes reducen recorrido en 1/√n; tasas de error 0,69 % normal y 2,44 % en peak; costos de la hoja Supuestos (CLP 9.500 h normal, 14.500 h extra, 18.500 por error).
- Las citas de ejemplo se generan a partir de registros reales de la hoja Recepciones.

---
Proyecto académico · Taller Aplicado Optimización en la Operación Logística (GLA1104) · Duoc UC.
