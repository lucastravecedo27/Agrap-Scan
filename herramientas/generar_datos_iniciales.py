"""Genera ./datos-iniciales a partir de ./Materiales (solo lectura).

Fuentes:
  - Materiales/datos/app.db            sociedades, bodegas (fincas) y catálogo WO por sociedad
  - Materiales/referencia/kardex/*.xlsx categoría (GrupoDos) y salidas de junio por bodega

Uso:  Materiales/.venv/bin/python herramientas/generar_datos_iniciales.py
"""
import csv
import re
import sqlite3
import statistics
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
MAT = RAIZ / "Materiales"
SAL = RAIZ / "datos-iniciales"
SAL.mkdir(exist_ok=True)

# Orden fijo de bodegas: una por finca, agrupadas por sociedad.
BODEGAS = [
    ("B01", "DON GASPAR", 1),
    ("B02", "EL REFUGIO", 1),
    ("B03", "MARIA LAURA", 2),
    ("B04", "LA ALEGRIA", 2),
    ("B05", "MAROMA", 3),
]
KARDEX = {
    1: "KARDEX AGRICOLAS A JUNIO.xlsx",
    2: "KARDEX FICUS - JUNIO.xlsx",
    3: "KARDEX MAROMA JUNIO.xlsx",
}
UNIDADES = {"und.": "Und.", "und": "Und.", "ro": "RO", "l": "l", "kg": "kg", "m": "m",
            "gal": "gal", "sc": "SC", "cu": "CU", "mu": "MU", "pq": "Pq", "pr": "PR"}

# Categorías normalizadas: el texto de WO trae el número del grupo y variantes por sociedad.
CATEGORIAS = [
    (r"EMPAQUE", "Insumos de empaque"),
    (r"EMBOLSE|PLASTICOS DE CAMPO", "Materiales de embolse"),
    (r"EMBARQUE", "Herramientas e insumos de embarque"),
    (r"HERRAMIENTA", "Herramientas de campo"),
    (r"FERTILIZ", "Fertilizantes"),
    (r"HERBICIDA", "Herbicidas"),
    (r"FUNGICIDA|FUMIGACION", "Fumigación y fungicidas"),
    (r"RES?PUESTO|LUBRICANTE|STIHL", "Repuestos y lubricantes"),
    (r"TUBERIA|RIEGO", "Tubería y accesorios de riego"),
    (r"PROTECCION PERSONAL", "Elementos de protección personal"),
    (r"ASEO", "Elementos de aseo"),
    (r"GAVION|POLYSOMBRA|OTROS", "Otros"),
]
SIN_CATEGORIA = "Sin categoría"

# Respaldo para los productos que WorldOffice tiene sin grupo: palabras clave del nombre.
# Se reportan aparte como «inferidas».
PALABRAS = [
    (r"\b(TAPA|BASE|DIVISION|ESTIBA|TROQUEL|PLASTI|SELLO|ETIQUETA|PAD|PAPEL|DAIPA|CAJA|LAMINA|BOLSA CONSUMER|POLYTUBO|CARTON|ESQUINER|GRAPA|ZUNCHO|CINTA (CAFE|TRANSP|EMPA))", "Insumos de empaque"),
    (r"\b(BOLSA|CINTA|DAIPA|PROTECTOR|CORBATA)", "Materiales de embolse"),
    (r"\b(GUANTE|BOTA|CASCO|DELANTAL|TAPABOCA|GAFA|MASCARILLA|CARETA|OVEROL|CAPA|IMPERMEABLE|PROTECTOR AUDIT|RESPIRADOR)", "Elementos de protección personal"),
    (r"\b(LLAVE|ADAPTADOR|ADAPADOR|REDUCCI|TEE|CODO|UNION|TUBO|TUBERIA|MANGUERA|NIPLE|VALVULA|PVC|ASPERSOR|BUJE|TAPON|REGISTRO|PEGANTE|LIMPIADOR PVC|SOLDADURA PVC)", "Tubería y accesorios de riego"),
    (r"\b(KIT|CARBURADOR|ACEITE|FILTRO|BUJIA|CADENA|ESPADA|RODAMIENTO|CORREA|LLANTA|NYLON|NAILON|CABEZAL|ARRANCADOR|EMPAQUE MOTOR|GRASA|ACPM|GASOLINA|REPUESTO|STIH?LL?)", "Repuestos y lubricantes"),
    (r"\b(CLORO|CLRO|JABON|HIPOCLORITO|ESCOBA|TRAPERO|DETERGENTE|DESINFECT|PAPEL HIGIEN|BALDE|LIMPIDO|VARSOL)", "Elementos de aseo"),
    (r"\b(FUMIGADORA|BOMBA DE ESPALDA|FUNGICIDA|ACEITE AGRICOLA|BANOLE|SPRAYTEX)", "Fumigación y fungicidas"),
    (r"\b(UREA|KCL|CLORURO DE POTASIO|ABOTEK|DAP|NITRATO|SULFATO|CAL |DOLOMITA|COMPOST|FERTI|ALGAS|MICROELEMENT|BORO|ZINC|MAGNESIO)", "Fertilizantes"),
    (r"\b(GLIFOSATO|HERBICIDA|PARAQUAT|RYZ?Y?UP|ROUNDUP|FINALE|BASTA)", "Herbicidas"),
    (r"\b(MACHETE|PALA|LIMA|GARABATO|CURVO|PODADORA|DESHOJADOR|CUCHILLO|TIJERA|ALICATE|MARTILLO|SERRUCHO|GUADAÑA|GUADANA|CARRETILLA|PICA|BARRETON|AZADON)", "Herramientas de campo"),
    (r"\b(FORMATO|FORMA |LIBRETA|CUADERNO|LAPICERO|MARCADOR|TALONARIO|PAPELERIA)", "Papelería y formatos"),
]


def inferir(nombre):
    n = " " + norm(nombre) + " "
    for patron, cat in PALABRAS:
        if re.search(patron, n):
            return cat
    return None

# Labores de una finca bananera; el lote no existe en ningún material (ver REPORTE).
LABORES = [
    ("EMPACADORA", "Corte y empaque"),
    ("EMPACADORA", "Embarque"),
    ("GENERAL", "Embolse y protección de fruta"),
    ("GENERAL", "Fertilización"),
    ("GENERAL", "Control de malezas"),
    ("GENERAL", "Fumigación / Sigatoka"),
    ("GENERAL", "Riego y drenaje"),
    ("GENERAL", "Mantenimiento y taller"),
    ("GENERAL", "Dotación y EPP"),
    ("GENERAL", "Aseo y administración"),
]


def limpiar(txt):
    txt = (txt or "").replace("_x000D_", " ").replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", txt).strip()


def norm(txt):
    txt = unicodedata.normalize("NFKD", limpiar(txt).upper())
    txt = "".join(c for c in txt if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]+", " ", txt).strip()


def categoria(grupo):
    g = norm(grupo)
    for patron, nombre in CATEGORIAS:
        if re.search(patron, g):
            return nombre
    return None


def leer_kardex(soc):
    """-> {(bodega, codigo): {'cat':..., 'salidas':[cant,...]}}  y  {codigo: cat} de la sociedad."""
    ws = openpyxl.load_workbook(MAT / "referencia" / "kardex" / KARDEX[soc],
                                read_only=True, data_only=True).active
    por_bod = defaultdict(lambda: {"cat": None, "salidas": []})
    cat_soc = {}
    # WorldOffice escribe el grupo solo en la primera fila de cada grupo: se arrastra
    # hacia abajo dentro de la misma bodega.
    bod_actual, grupo = None, None
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < 3 or not r or not r[5]:
            continue
        bod = limpiar(str(r[0] or "")).upper()
        if bod != bod_actual:
            bod_actual, grupo = bod, None
        if r[4]:
            grupo = r[4]
        prod = limpiar(str(r[5]))
        cod = prod.split(" ")[0]
        cat = categoria(grupo) if grupo else None
        d = por_bod[(bod, cod)]
        if cat:
            d["cat"] = cat
            cat_soc[cod] = cat
        if r[7] == "SA" and r[12]:
            try:
                d["salidas"].append(float(r[12]))
            except (TypeError, ValueError):
                pass
    return por_bod, cat_soc


LISTADOS = {
    1: "LISTADO DE PRODUCTOS INVENTARIO AGRICOLAS.xlsx",
    2: "listado de productos ficus.xlsx",
    3: "listado de productos maroma.xlsx",
}


def leer_listado(soc):
    """Grupo de cada código según el listado de WO (mismo patrón: grupo en la 1a fila)."""
    ws = openpyxl.load_workbook(MAT / "referencia" / "worldoffice" / LISTADOS[soc],
                                read_only=True, data_only=True).active
    out, grupo = {}, None
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < 2 or not r or not r[4]:
            continue
        if r[3]:
            grupo = r[3]
        cat = categoria(grupo) if grupo else None
        if cat:
            out[limpiar(str(r[4]))] = cat
    return out


def main():
    db = sqlite3.connect(f"file:{MAT / 'datos' / 'app.db'}?immutable=1", uri=True)
    rep = []
    tot = Counter()

    bodegas_rows, productos_rows, destinos_rows = [], [], []
    socs = {r[0]: r[1] for r in db.execute("select id, nombre from sociedades")}
    fincas_grupo = [b[1] for b in BODEGAS]

    for cod_b, finca, soc in BODEGAS:
        bodegas_rows.append({"codigo": cod_b, "nombre": finca, "finca": finca,
                             "responsable": "", "sociedad": socs[soc]})

    rep.append("Catálogo de WorldOffice por sociedad.\n")
    for soc in sorted({b[2] for b in BODEGAS}):
        crudos = db.execute("select codigo, descripcion, unidad from productos_wo "
                            "where sociedad_id=? order by codigo", (soc,)).fetchall()
        kx, cat_soc = leer_kardex(soc)
        cat_lst = leer_listado(soc)
        vistos, limpios = {}, []
        descartes, unidades_corr, nombres_corr = [], Counter(), 0
        for codigo, desc, unidad in crudos:
            codigo = limpiar(codigo)
            nombre = limpiar(desc)
            if nombre != desc:
                nombres_corr += 1
            if not codigo:
                descartes.append(f"(sin código) «{desc}»: código vacío")
                continue
            if len(norm(nombre)) < 2:
                descartes.append(f"`{codigo}` «{desc}»: nombre vacío o sin letras")
                continue
            if codigo in vistos:
                descartes.append(f"`{codigo}` «{nombre}»: código repetido")
                continue
            u = UNIDADES.get(limpiar(unidad).lower())
            if u is None:
                u = "Und."
                unidades_corr[f"«{unidad}» → Und. (desconocida)"] += 1
            elif u != unidad:
                unidades_corr[f"«{unidad}» → {u}"] += 1
            vistos[codigo] = True
            limpios.append((codigo, nombre, u))

        # Nombres iguales con códigos distintos: se conservan (son códigos válidos en WO)
        por_nombre = defaultdict(list)
        for c, n, u in limpios:
            por_nombre[norm(n)].append((c, n, u))
        dup_nombre = {k: v for k, v in por_nombre.items() if len(v) > 1}

        rep.append(f"### {socs[soc]}\n")
        rep.append(f"- Leídos: **{len(crudos)}** · válidos: **{len(limpios)}** · descartados: **{len(descartes)}**")
        rep.append(f"- Nombres con espacios/saltos de línea corregidos: {nombres_corr}")
        if unidades_corr:
            rep.append("- Unidades normalizadas: " + ", ".join(f"{k} ({v})" for k, v in unidades_corr.items()))
        for d in descartes:
            rep.append(f"  - Descartado: {d}")
        if dup_nombre:
            rep.append(f"- **{len(dup_nombre)} nombres repetidos con códigos distintos** (se conservan todos; revisar en WorldOffice):")
            for v in dup_nombre.values():
                rep.append("  - " + " · ".join(f"`{c}` {n} ({u})" for c, n, u in v))
        sin_cat_soc = 0

        inferidas = Counter()
        for cod_b, finca, s in BODEGAS:
            if s != soc:
                continue
            n_prom = 0
            for c, n, u in limpios:
                d = kx.get((finca, c), {"cat": None, "salidas": []})
                cat = cat_lst.get(c) or d["cat"] or cat_soc.get(c)
                if not cat:
                    cat = inferir(n) or SIN_CATEGORIA
                    if cat != SIN_CATEGORIA:
                        inferidas[cod_b] += 1
                if cat == SIN_CATEGORIA:
                    sin_cat_soc += 1
                prom = ""
                if d["salidas"]:
                    prom = round(statistics.mean(d["salidas"]), 2)
                    prom = int(prom) if prom == int(prom) else prom
                    n_prom += 1
                productos_rows.append({"bodega": cod_b, "codigo": c, "nombre": n, "unidad": u,
                                       "categoria": cat, "promedio_referencia": prom, "foto_url": ""})
            tot[cod_b] = len(limpios)
            rep.append(f"- {cod_b} {finca}: {len(limpios)} productos, {n_prom} con promedio de referencia "
                       f"(salidas de junio), {inferidas[cod_b]} con categoría inferida por el nombre")
        rep.append(f"- Quedan «{SIN_CATEGORIA}»: {sin_cat_soc // max(1, sum(1 for b in BODEGAS if b[2]==soc))} productos por bodega\n")

    # Destinos
    for cod_b, finca, soc in BODEGAS:
        n = 0
        for lote, labor in LABORES:
            n += 1
            destinos_rows.append({"bodega": cod_b, "codigo": f"{n:03d}", "finca": finca, "lote": lote, "labor": labor})
        for otra in fincas_grupo:
            if otra == finca:
                continue
            n += 1
            destinos_rows.append({"bodega": cod_b, "codigo": f"{n:03d}", "finca": otra,
                                  "lote": "GENERAL", "labor": "Gasto cargado a otra finca"})

    def escribir(nombre, filas, campos):
        with open(SAL / nombre, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=campos)
            w.writeheader()
            for r in filas:
                w.writerow({k: r[k] for k in campos})

    escribir("bodegas.csv", bodegas_rows, ["codigo", "nombre", "finca", "responsable", "sociedad"])
    escribir("productos.csv", productos_rows,
             ["bodega", "codigo", "nombre", "unidad", "categoria", "promedio_referencia", "foto_url"])
    escribir("destinos.csv", destinos_rows, ["bodega", "codigo", "finca", "lote", "labor"])
    for cod_b, _, _ in BODEGAS:
        escribir(f"productos_{cod_b}.csv", [r for r in productos_rows if r["bodega"] == cod_b],
                 ["codigo", "nombre", "unidad", "categoria", "promedio_referencia", "foto_url"])
        escribir(f"destinos_{cod_b}.csv", [r for r in destinos_rows if r["bodega"] == cod_b],
                 ["codigo", "finca", "lote", "labor"])

    cats = Counter(r["categoria"] for r in productos_rows)
    (SAL / "REPORTE.md").write_text(REPORTE.format(
        bodegas="\n".join(f"| {b['codigo']} | {b['nombre']} | {b['sociedad']} | {tot[b['codigo']]} | "
                          f"{sum(1 for d in destinos_rows if d['bodega']==b['codigo'])} |" for b in bodegas_rows),
        productos="\n".join(rep),
        categorias="\n".join(f"| {k} | {v} |" for k, v in cats.most_common()),
        labores="\n".join(f"| {l} | {lab} |" for l, lab in LABORES),
    ), encoding="utf-8")
    print("OK", len(bodegas_rows), len(productos_rows), len(destinos_rows))


REPORTE = """# Reporte de depuración — datos iniciales de Agrap Salidas

Generado por `herramientas/generar_datos_iniciales.py` leyendo **solo** `./Materiales`
(no se modificó nada allí). Fuentes:

- `Materiales/datos/app.db` → sociedades, fincas/bodegas y catálogo de WorldOffice por sociedad
  (es la versión más reciente del catálogo: incluye los productos creados después del
  listado en Excel).
- `Materiales/referencia/worldoffice/listado*.xlsx` → categoría (DescGrupoDos) de cada producto.
- `Materiales/referencia/kardex/*.xlsx` (corte junio 2026) → categoría de respaldo
  (GrupoDos) y cantidades de salida (documentos `SA`) por bodega, para el
  promedio de referencia.

## Bodegas

En los materiales **la bodega de WorldOffice es la finca** (`DON GASPAR`, `MARIA LAURA`…),
así que se creó una bodega por finca. El catálogo es **por sociedad** (el mismo código
significa productos distintos en cada una), por eso cada bodega recibe el catálogo
completo de su sociedad y dos bodegas de la misma sociedad comparten códigos.

| Código | Nombre / finca | Sociedad | Productos | Destinos |
|---|---|---|---|---|
{bodegas}

- **Responsable vacío en todas**: en los materiales el responsable es la persona que
  despacha (su cédula va a WorldOffice), no un dato de la bodega. Llenarlo en
  Configuración → Bodegas.
- Se excluyeron las bodegas `PRINCIPAL`, `PRINCIPAL DG/ALE/RF`, `ELIZABETH CRISTINA`
  y `PALMAWA` del kardex: no tienen finca en Configuración de Materiales ni catálogo
  (Palmawa no tiene NIT ni productos).

## Productos

{productos}

### Categorías resultantes (todas las bodegas)

Los nombres de grupo de WorldOffice varían por sociedad (`1 INSUMO DE EMPAQUE`,
`01 INSUMOS DE EMPAQUE`…). Se unificaron en estas categorías. Los productos que
WorldOffice tiene **sin grupo** recibieron una categoría inferida por palabras clave
del nombre (TAPA/BASE → empaque, GUANTE/BOTA → EPP…); revisar en Configuración si alguna
quedó mal. Lo que no se pudo inferir queda en «Sin categoría».

| Categoría | Productos |
|---|---|
{categorias}

### Promedio de referencia

Promedio de la cantidad por documento de salida (`SA`) de junio 2026 en **esa bodega**.
Se usa para la alerta «cantidad mayor a 2 veces el promedio» mientras la app no tenga
historial propio. Los productos sin salidas en junio quedan sin promedio (sin alerta).

## Destinos

**Ningún material trae lotes ni labores.** Se generaron por bodega:

| Lote | Labor |
|---|---|
{labores}

más un destino «Gasto cargado a otra finca» por cada otra finca del grupo (el caso de
herbicidas y fertilizantes comprados por Ficus y gastados en Don Gaspar, que describe
`Materiales/CLAUDE.md`). **Hay que reemplazar los lotes reales** editando
`destinos_Bxx.csv` antes de importarlo, o desde Configuración → Destinos.

## Archivos

- `bodegas.csv` — codigo,nombre,finca,responsable,sociedad
- `productos.csv` / `destinos.csv` — todas las bodegas, con columna `bodega`
  (se importan juntos con «Cargar paquete inicial»)
- `productos_Bxx.csv` / `destinos_Bxx.csv` — una bodega, formato de importación por bodega
"""

if __name__ == "__main__":
    main()
