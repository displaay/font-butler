#!/usr/bin/env python3
"""Rename a font family across OpenType name and CFF tables. Writes a new file."""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTCollection, TTFont


FAMILY_IDS = {1, 16, 21}
FULL_IDS = {4, 18}
PS_IDS = {6}
UNIQUE_IDS = {3}
PS_PREFIX_IDS = {25}
STYLE_IDS = {2, 17, 22}


def _record_str(record) -> str:
    try:
        return str(record)
    except Exception:
        return ""


def _style_name(tt: TTFont) -> str:
    nametable = tt["name"]
    for name_id in (17, 2):
        for record in nametable.names:
            if record.nameID == name_id:
                value = _record_str(record).strip()
                if value:
                    return value
    return "Regular"


def _set_name(nametable, name_id: int, value: str) -> None:
    platforms = {(record.platformID, record.platEncID, record.langID) for record in nametable.names if record.nameID == name_id}
    if not platforms:
        platforms = {(3, 1, 0x409), (1, 0, 0)}
    for platform_id, plat_enc_id, lang_id in platforms:
        nametable.setName(value, name_id, platform_id, plat_enc_id, lang_id)


def rename_font(tt: TTFont, family: str) -> None:
    style = _style_name(tt)
    ps_family = family.replace(" ", "")
    ps_style = style.replace(" ", "")
    full = f"{family} {style}".strip()
    postscript = f"{ps_family}-{ps_style}"
    unique = f"{postscript};Fontcase;{style}"
    prefix = ps_family

    nametable = tt["name"]
    present_ids = {record.nameID for record in nametable.names}

    _set_name(nametable, 1, family)
    _set_name(nametable, 4, full)
    _set_name(nametable, 6, postscript)
    _set_name(nametable, 3, unique)

    if 16 in present_ids or 17 in present_ids:
        _set_name(nametable, 16, family)
    if 18 in present_ids:
        _set_name(nametable, 18, full)
    if 21 in present_ids:
        _set_name(nametable, 21, family)
    if 25 in present_ids or "fvar" in tt:
        _set_name(nametable, 25, prefix)

    if "CFF " in tt:
        try:
            cff = tt["CFF "]
            cff.cff[0].FamilyName = family
            cff.cff[0].FullName = full
            cff.cff.fontNames = [postscript]
        except Exception as exc:
            sys.stderr.write(f"[fontcase] CFF rename warning: {exc}\n")


def rename_path(src: Path, dest: Path, family: str) -> None:
    suffix = src.suffix.lower()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if suffix in {".ttc", ".otc"}:
        collection = TTCollection(str(src))
        for font in collection.fonts:
            rename_font(font, family)
        collection.save(str(dest))
        return
    font = TTFont(str(src), recalcBBoxes=False, recalcTimestamp=False)
    rename_font(font, family)
    font.save(str(dest))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write("Usage: rename_family.py <input> <output> <family-name>\n")
        return 1
    src, dest, family = Path(argv[0]), Path(argv[1]), argv[2]
    if not src.is_file():
        sys.stderr.write(f"[fontcase] missing file: {src}\n")
        return 1
    rename_path(src, dest, family)
    print(f"[ok] {dest} as {family}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
