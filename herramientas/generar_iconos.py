"""Íconos PNG de la PWA sin dependencias: fondo azul AGRAP con un QR estilizado crema."""
import struct, zlib
from pathlib import Path

AZUL = (0, 40, 63); CREMA = (249, 249, 247); AMARILLO = (253, 185, 19)
SAL = Path(__file__).resolve().parent.parent / "iconos"

# Matriz 9x9 de un QR estilizado: tres buscadores y unos módulos.
M = [
    "XXX.X.XXX",
    "X.X...X.X",
    "XXX.X.XXX",
    "...X.X...",
    "X.X.Y.X.X",
    "...X.X...",
    "XXX..X.X.",
    "X.X.X.XX.",
    "XXX.X..XX",
]

def png(n, nombre, margen=0.2):
    px = [[AZUL] * n for _ in range(n)]
    ini = int(n * margen); cel = (n - 2 * ini) / 9
    for f, fila in enumerate(M):
        for c, v in enumerate(fila):
            if v == ".": continue
            col = AMARILLO if v == "Y" else CREMA
            for y in range(int(ini + f * cel), int(ini + (f + 1) * cel)):
                for x in range(int(ini + c * cel), int(ini + (c + 1) * cel)):
                    px[y][x] = col
    raw = b"".join(b"\x00" + bytes(v for p in fila for v in p) for fila in px)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    (SAL / nombre).write_bytes(data)

png(192, "icono-192.png"); png(512, "icono-512.png"); png(180, "apple-touch-icon.png")
png(512, "icono-maskable-512.png", margen=0.28)
print("ok")
