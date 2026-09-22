#!/usr/bin/env python3
"""Descarga el ONI oficial de NOAA CPC y regenera data/oni.js.

Uso: python3 scripts/update_oni.py
Fuente: https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt (ERSSTv5)
"""
import datetime as dt
import json
import pathlib
import urllib.request

URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
OUT = pathlib.Path(__file__).resolve().parents[1] / "data" / "oni.js"


def main() -> None:
    text = urllib.request.urlopen(URL, timeout=60).read().decode()
    oni: dict[int, list] = {}
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4 or parts[0] not in SEASONS:
            continue
        season, year, anom = parts[0], int(parts[1]), float(parts[3])
        oni.setdefault(year, [None] * 12)[SEASONS.index(season)] = anom
    if len(oni) < 70:
        raise SystemExit(f"Respuesta inesperada de CPC ({len(oni)} años)")
    body = ",\n".join(f"  {y}: {json.dumps(v)}" for y, v in sorted(oni.items()))
    meta = {"provisional": False, "source": URL, "updated": dt.date.today().isoformat()}
    OUT.write_text(
        "// Oceanic Niño Index (ONI, NOAA CPC, ERSSTv5). Clave: año; valores: 12 trimestres móviles\n"
        "// DJF, JFM, ..., NDJ (el valor i está centrado en el mes i: 0=enero ... 11=diciembre).\n"
        "// ARCHIVO GENERADO por scripts/update_oni.py. No editar a mano.\n"
        f"export const ONI_META = {json.dumps(meta, ensure_ascii=False)};\n"
        f"export const ONI = {{\n{body}\n}};\n",
        encoding="utf-8",
    )
    print(f"ONI actualizado: {min(oni)}-{max(oni)} -> {OUT}")


if __name__ == "__main__":
    main()
