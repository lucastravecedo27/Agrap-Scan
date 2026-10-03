"""Agrega (o pone al día) una finca piloto en el paquete publicado de ./datos-iniciales.

El paquete publicado (bodegas.csv, productos.csv, destinos.csv) es lo que carga la app sola
al abrirse en un equipo nuevo. Las fincas se van sumando una a una a medida que entran a
prueba; las que ya están no se tocan (Don Gaspar se armó a mano con sus lotes reales).

Lee ./Materiales (la copia de la app de la empresa, solo lectura):
  - datos/app.db: catálogo WorldOffice de la sociedad (`productos_wo`) y el ID del cuaderno
    de salidas de la finca (`salida_archivos`), que es lo que Materiales usa para reconocerlo.
  - referencia/: la categoría de cada producto, igual que generar_datos_iniciales.py.

Uso:  python3 herramientas/agregar_finca_piloto.py B04            (activa)
      python3 herramientas/agregar_finca_piloto.py B02 --inactiva  (configurada, apagada)
"""
import csv
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generar_datos_iniciales as g  # noqa: E402

SAL = g.SAL
LOTES = ["EMPACADORA", "GENERAL"]  # los lotes reales de la finca se agregan en Oficina › Destinos


def leer(nombre):
    with open(SAL / nombre, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return r.fieldnames, list(r)


def escribir(nombre, campos, filas):
    with open(SAL / nombre, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)


def main(cod_b, activa=True):
    fila = next((b for b in g.BODEGAS if b[0] == cod_b), None)
    if not fila:
        sys.exit(f"Bodega desconocida: {cod_b}. Conocidas: {', '.join(b[0] for b in g.BODEGAS)}")
    _, finca, soc = fila
    db = sqlite3.connect(f"file:{g.MAT / 'datos' / 'app.db'}?immutable=1", uri=True)
    sociedad = db.execute("select nombre from sociedades where id=?", (soc,)).fetchone()[0]
    cuaderno = db.execute(
        "select a.uuid from salida_archivos a join bodegas b on b.id=a.bodega_id "
        "where b.codigo_wo=? order by a.id desc", (finca,)).fetchone()
    cuaderno = cuaderno[0] if cuaderno else ""

    # Catálogo: el de WorldOffice de la sociedad, limpio y con categoría.
    _, cat_soc = g.leer_kardex(soc)
    cat_lst = g.leer_listado(soc)
    productos, vistos = [], set()
    for codigo, desc, unidad in db.execute(
            "select codigo, descripcion, unidad from productos_wo where sociedad_id=? order by codigo", (soc,)):
        codigo, nombre = g.limpiar(codigo), g.limpiar(desc)
        if not codigo or len(g.norm(nombre)) < 2 or codigo in vistos:
            continue
        vistos.add(codigo)
        cat = cat_lst.get(codigo) or cat_soc.get(codigo) or g.inferir(nombre) or g.SIN_CATEGORIA
        productos.append({"bodega": cod_b, "codigo": codigo, "nombre": nombre,
                          "unidad": g.UNIDADES.get(g.limpiar(unidad).lower(), "Und."),
                          "categoria": cat, "promedio_referencia": "", "foto_url": ""})

    # Destinos: los lotes generales de la finca y «cargado a otra finca» para las demás.
    destinos = [{"bodega": cod_b, "codigo": f"{i:03d}", "finca": finca, "lote": l, "labor": ""}
                for i, l in enumerate(LOTES, 1)]
    for otra in (b[1] for b in g.BODEGAS if b[1] != finca):
        destinos.append({"bodega": cod_b, "codigo": f"{len(destinos) + 1:03d}", "finca": otra,
                         "lote": "GENERAL", "labor": "Gasto cargado a otra finca"})

    campos_b, bodegas = leer("bodegas.csv")
    campos_b = campos_b + [c for c in ("cuaderno", "activa") if c not in campos_b]
    bodegas = [b for b in bodegas if b["codigo"] != cod_b] + [
        {"codigo": cod_b, "nombre": finca, "finca": finca, "responsable": "", "sociedad": sociedad,
         "cuaderno": cuaderno, "activa": "si" if activa else "no"}]
    escribir("bodegas.csv", campos_b, sorted(bodegas, key=lambda b: b["codigo"]))
    for nombre, nuevas in (("productos.csv", productos), ("destinos.csv", destinos)):
        campos, filas = leer(nombre)
        escribir(nombre, campos, [f for f in filas if f["bodega"] != cod_b] + nuevas)

    print(f"{cod_b} {finca} ({sociedad}, {'activa' if activa else 'inactiva'}): {len(productos)} productos, {len(destinos)} destinos, "
          f"cuaderno {cuaderno or 'SIN ID (crear el cuaderno en Materiales)'}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0].upper(), activa="--inactiva" not in sys.argv)
