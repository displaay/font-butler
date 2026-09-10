"""Materialise simple GSUB SingleSubst features into default glyph slots.

Ported from Typechef font_tailor_engine.operations.materialise_feature with
Displaay adaptations: missing or non-SingleSubst features are skipped.
"""

from __future__ import annotations

import json
import sys
from io import BytesIO
from copy import deepcopy
from pathlib import Path
from typing import Any

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTCollection, TTFont
from fontTools.varLib.instancer import instantiateVariableFont

_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

try:
    from tools._remove_ot_features import remove_features
except ModuleNotFoundError:
    from _remove_ot_features import remove_features  # type: ignore


class MaterialiseFeatureError(RuntimeError):
    """Raised when feature materialisation cannot proceed."""


def _variable_axes(font: Any) -> list[dict[str, Any]]:
    if "fvar" not in font:
        return []
    axes = []
    for axis in font["fvar"].axes:
        axes.append(
            {
                "tag": axis.axisTag,
                "min": axis.minValue,
                "default": axis.defaultValue,
                "max": axis.maxValue,
            }
        )
    return axes


def normalize_replace_default_features(features: list[str] | tuple[str, ...] | None) -> list[str]:
    """Return unique supported feature tags in stable checkbox order."""
    if not features:
        return []
    order = ["tnum", "zero", *[f"ss{index:02d}" for index in range(1, 21)]]
    requested = {tag for tag in features if tag in SUPPORTED_FEATURES}
    return [tag for tag in order if tag in requested]


def detect_font_container_format(path: Path | str, font: Any | None = None) -> str:
    """Infer a container format string for materialise format gates."""
    suffix = Path(path).suffix.lower().lstrip(".")
    if suffix in {"ttf", "otf", "woff", "woff2"}:
        return suffix
    if font is not None:
        if "CFF " in font or "CFF2" in font:
            return "otf"
        return "ttf"
    return suffix or "ttf"

SUPPORTED_FEATURES = {"tnum", "zero"} | {f"ss{index:02d}" for index in range(1, 21)}
SUPPORTED_MODE = "replace_default_glyphs"
LOOKUP_TYPE_NAMES = {
    1: "SingleSubst",
    2: "MultipleSubst",
    3: "AlternateSubst",
    4: "LigatureSubst",
    5: "ContextSubst",
    6: "ChainContextSubst",
    7: "ExtensionSubst",
    8: "ReverseChainSingleSubst",
}
GPOS_LOOKUP_TYPE_NAMES = {
    1: "SinglePos",
    2: "PairPos",
    3: "CursivePos",
    4: "MarkBasePos",
    5: "MarkLigPos",
    6: "MarkMarkPos",
    7: "ContextPos",
    8: "ChainContextPos",
    9: "ExtensionPos",
}
DRY_RUN_WARNING = "Dry run only; no glyph data was changed and no output font is required."
CFF_SUPPORT_LEVEL = "static-cff-simple"
CFF_SUPPORTED_CONTAINERS = {"otf", "woff", "woff2"}
CFF_STATIC_SIMPLE_ERROR = "CFF webfont materialisation requires static simple CFF data."
VARIABLE_SUPPORT_LEVEL_TTF = "variable-glyf-ttf"
VARIABLE_SUPPORT_LEVEL_WOFF = "variable-glyf-woff"
VARIABLE_SUPPORT_LEVEL_WOFF2 = "variable-glyf-woff2"
VARIABLE_SUPPORT_LEVELS = {
    "ttf": VARIABLE_SUPPORT_LEVEL_TTF,
    "woff": VARIABLE_SUPPORT_LEVEL_WOFF,
    "woff2": VARIABLE_SUPPORT_LEVEL_WOFF2,
}
VARIABLE_SUPPORT_LEVEL = VARIABLE_SUPPORT_LEVEL_TTF
VARIABLE_GLYF_CONTAINER_ERROR = "Variable materialisation currently supports variable glyf TTF, WOFF, and WOFF2 files only."
UNSUPPORTED_HVAR_ERROR = "Variable font has unsupported HVAR metric variation data."
UNSUPPORTED_VVAR_ERROR = "Variable VVAR handling is not supported yet."
VARIABLE_PREVIEW_SCOPE = "default-outline-only"
HVAR_MAPS = ("AdvWidthMap", "LsbMap", "RsbMap")
STALE_AFTER_MATERIALISATION_TABLES = ("DSIG", "hdmx", "LTSH", "VDMX")


def _cff_top_dict(font: Any) -> Any:
    try:
        return font["CFF "].cff.topDictIndex[0]
    except Exception as exc:
        raise MaterialiseFeatureError("materialise_feature requires an accessible CFF table.") from exc


def _cff_charstrings(font: Any) -> Any:
    top_dict = _cff_top_dict(font)
    charstrings = getattr(top_dict, "CharStrings", None)
    if charstrings is None:
        raise MaterialiseFeatureError("materialise_feature requires accessible CFF CharStrings.")
    return charstrings


def _rebind_cff_charstring_private(font: Any, charstring: Any) -> None:
    """Point a charstring at the font's canonical CFF Private/Subrs objects.

    deepcopy() snapshots carry their own Private dict copies. fontTools'
    post-subset subroutine pruning only prepares SubrsIndex objects reachable
    from the top dict, so detached copies crash in remove_unused_subroutines.
    """
    top_dict = _cff_top_dict(font)
    charstring.private = top_dict.Private
    charstring.globalSubrs = top_dict.GlobalSubrs


def _is_cid_keyed_cff(font: Any) -> bool:
    top_dict = _cff_top_dict(font)
    return (
        getattr(top_dict, "ROS", None) is not None
        or getattr(top_dict, "FDArray", None) is not None
        or getattr(top_dict, "FDSelect", None) is not None
    )


def _present_variable_tables(font: Any) -> list[str]:
    return [
        table_tag
        for table_tag in ("fvar", "STAT", "avar", "gvar", "HVAR", "MVAR", "VVAR")
        if table_tag in font
    ]


def _variable_named_instances(font: Any) -> list[dict[str, Any]]:
    if "fvar" not in font:
        return []
    name_table = font["name"] if "name" in font else None
    instances = []
    for instance in getattr(font["fvar"], "instances", []) or []:
        name = None
        if name_table is not None:
            name = name_table.getDebugName(instance.subfamilyNameID)
        instances.append(
            {
                "name": name,
                "coordinates": {
                    tag: _normalize_number(value)
                    for tag, value in sorted((getattr(instance, "coordinates", {}) or {}).items())
                },
            }
        )
    return instances


def _hvar_table(font: Any) -> Any | None:
    if "HVAR" not in font:
        return None
    return getattr(font["HVAR"], "table", None)


def _hvar_varidx_map(font: Any, map_name: str) -> Any | None:
    table = _hvar_table(font)
    if table is None:
        return None
    return getattr(table, map_name, None)


def _hvar_mapping(font: Any, map_name: str) -> dict[str, int] | None:
    varidx_map = _hvar_varidx_map(font, map_name)
    if varidx_map is None:
        return None
    mapping = getattr(varidx_map, "mapping", None)
    if not isinstance(mapping, dict):
        raise MaterialiseFeatureError(UNSUPPORTED_HVAR_ERROR)
    return mapping


def _hvar_mappings(font: Any) -> dict[str, dict[str, int] | None]:
    return {map_name: _hvar_mapping(font, map_name) for map_name in HVAR_MAPS}


def _hvar_policy(font: Any) -> str:
    if "HVAR" not in font:
        return "not-present"
    if _hvar_table(font) is None:
        raise MaterialiseFeatureError(UNSUPPORTED_HVAR_ERROR)
    if _hvar_mapping(font, "AdvWidthMap") is None:
        raise MaterialiseFeatureError(UNSUPPORTED_HVAR_ERROR)
    for map_name in HVAR_MAPS:
        _hvar_mapping(font, map_name)
    return "copied"


def _hvar_snapshot(
    font: Any,
    glyph_name: str,
    hvar_mappings: dict[str, dict[str, int] | None] | None = None,
) -> dict[str, int | None]:
    maps = hvar_mappings if hvar_mappings is not None else _hvar_mappings(font)
    snapshot: dict[str, int | None] = {}
    for map_name in HVAR_MAPS:
        mapping = maps[map_name]
        snapshot[map_name] = None if mapping is None else mapping.get(glyph_name, 0)
    return snapshot


def _apply_hvar_snapshot(
    font: Any,
    glyph_name: str,
    snapshot: dict[str, int | None],
    hvar_mappings: dict[str, dict[str, int] | None] | None = None,
) -> None:
    maps = hvar_mappings if hvar_mappings is not None else _hvar_mappings(font)
    for map_name, varidx in snapshot.items():
        mapping = maps[map_name]
        if mapping is not None and varidx is not None:
            mapping[glyph_name] = varidx


def _variable_support_level(detected_format: str | None) -> str:
    support_level = VARIABLE_SUPPORT_LEVELS.get((detected_format or "ttf").lower())
    if support_level is None:
        raise MaterialiseFeatureError(VARIABLE_GLYF_CONTAINER_ERROR)
    return support_level


def _validate_supported_variable_glyf_font(font: Any, detected_format: str | None) -> str:
    support_level = _variable_support_level(detected_format)
    if "CFF2" in font:
        raise MaterialiseFeatureError("CFF2 fonts are not supported yet.")
    if "CFF " in font:
        raise MaterialiseFeatureError(VARIABLE_GLYF_CONTAINER_ERROR)
    for table_tag in ("glyf", "gvar", "hmtx", "fvar"):
        if table_tag not in font:
            raise MaterialiseFeatureError(f"Variable materialisation requires a {table_tag} table.")
    if "VVAR" in font:
        raise MaterialiseFeatureError(UNSUPPORTED_VVAR_ERROR)
    _hvar_policy(font)
    return support_level


def _validate_supported_font(font: Any, detected_format: str | None = None) -> str:
    if "fvar" in font:
        _validate_supported_variable_glyf_font(font, detected_format)
        return "glyf"
    if "CFF2" in font:
        raise MaterialiseFeatureError("CFF2 fonts are not supported yet.")
    if "CFF " in font:
        container = (detected_format or "otf").lower()
        if container not in CFF_SUPPORTED_CONTAINERS:
            raise MaterialiseFeatureError(CFF_STATIC_SIMPLE_ERROR)
        if "hmtx" not in font:
            raise MaterialiseFeatureError(CFF_STATIC_SIMPLE_ERROR)
        try:
            is_cid_keyed = _is_cid_keyed_cff(font)
        except MaterialiseFeatureError as exc:
            raise MaterialiseFeatureError(CFF_STATIC_SIMPLE_ERROR) from exc
        if is_cid_keyed:
            raise MaterialiseFeatureError("CID-keyed CFF fonts are not supported yet.")
        try:
            _cff_charstrings(font)
        except MaterialiseFeatureError as exc:
            raise MaterialiseFeatureError(CFF_STATIC_SIMPLE_ERROR) from exc
        return "CFF"
    if "glyf" not in font:
        raise MaterialiseFeatureError("materialise_feature currently supports static glyf or simple CFF fonts only.")
    if "hmtx" not in font:
        raise MaterialiseFeatureError("materialise_feature requires an hmtx table.")
    return "glyf"


def _lookup_type_name(lookup_type: int | None) -> str:
    return LOOKUP_TYPE_NAMES.get(lookup_type, f"LookupType{lookup_type}")


def _gpos_lookup_type_name(lookup_type: int | None) -> str:
    return GPOS_LOOKUP_TYPE_NAMES.get(lookup_type, f"LookupType{lookup_type}")


def _new_report(
    feature: str,
    mode: str,
    dry_run: bool,
    remove_feature_afterwards: bool,
    include_preview_primitives: bool,
) -> dict[str, Any]:
    return {
        "feature": feature,
        "mode": mode,
        "dryRun": dry_run,
        "includePreviewPrimitives": include_preview_primitives,
        "outlineFormat": None,
        "previewPrimitiveSupport": False,
        "cffSupportLevel": None,
        "isVariable": False,
        "variableSupportLevel": None,
        "variableTables": [],
        "namedInstances": [],
        "gvarCopied": False,
        "copiedVariationData": False,
        "hvarPolicy": None,
        "vvarPolicy": None,
        "previewScope": None,
        "instanceValidation": None,
        "supported": False,
        "fullyMaterialisable": False,
        "removeFeatureAfterwards": remove_feature_afterwards,
        "removedFeatureAfterwards": False,
        "summary": {
            "lookupCount": 0,
            "mappingCount": 0,
            "sourceGlyphCount": 0,
            "affectedCodepointCount": 0,
            "hasCompositeSources": False,
            "hasCompositeReplacements": False,
            "hasMetricChanges": False,
            "hasBoundsChanges": False,
            "maxAbsBoundsDelta": 0,
            "previewPrimitiveCount": 0,
        },
        "lookups": [],
        "mapping": [],
        "warnings": [],
        "errors": [],
        "riskSummary": {
            "level": "unsupported",
            "label": "Unsupported",
            "reasons": ["Operation has not been evaluated"],
        },
    }


def _feature_records(font: Any, feature_tag: str) -> list[Any]:
    if "GSUB" not in font:
        raise MaterialiseFeatureError("materialise_feature requires a GSUB table.")
    feature_list = getattr(font["GSUB"].table, "FeatureList", None)
    if not feature_list:
        raise MaterialiseFeatureError("materialise_feature requires a GSUB FeatureList.")
    records = [
        record
        for record in getattr(feature_list, "FeatureRecord", []) or []
        if getattr(record, "FeatureTag", None) == feature_tag
    ]
    if not records:
        raise MaterialiseFeatureError(f"GSUB feature {feature_tag!r} was not found.")
    return records


def _collect_single_subst_mapping(font: Any, feature_tag: str) -> tuple[dict[str, str], dict[str, list[int]], list[dict[str, Any]], list[str]]:
    records = _feature_records(font, feature_tag)
    lookup_list = getattr(font["GSUB"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []
    mapping: dict[str, str] = {}
    lookup_indices_by_source: dict[str, list[int]] = {}
    lookup_reports: list[dict[str, Any]] = []
    errors: list[str] = []
    seen_lookup_indices: set[int] = set()

    for record in records:
        lookup_indices = list(getattr(record.Feature, "LookupListIndex", []) or [])
        for lookup_index in lookup_indices:
            if not 0 <= lookup_index < len(lookups):
                errors.append(f"GSUB feature {feature_tag!r} references missing lookup index {lookup_index}.")
                continue
            lookup = lookups[lookup_index]
            lookup_type = getattr(lookup, "LookupType", None)
            if lookup_index not in seen_lookup_indices:
                lookup_reports.append(
                    {
                        "lookupIndex": lookup_index,
                        "lookupType": lookup_type,
                        "lookupTypeName": _lookup_type_name(lookup_type),
                        "subtableCount": len(getattr(lookup, "SubTable", []) or []),
                        "supported": lookup_type == 1,
                    }
                )
                seen_lookup_indices.add(lookup_index)
            if lookup_type != 1:
                errors.append(
                    f"materialise_feature supports only GSUB SingleSubst lookups; "
                    f"feature {feature_tag!r} uses lookup type {lookup_type}."
                )
                continue
            for subtable in getattr(lookup, "SubTable", []) or []:
                subtable_mapping = getattr(subtable, "mapping", None)
                if subtable_mapping is None:
                    errors.append(
                        f"GSUB feature {feature_tag!r} contains a SingleSubst subtable without a mapping."
                    )
                    continue
                for source, replacement in subtable_mapping.items():
                    existing = mapping.get(source)
                    if existing is not None and existing != replacement:
                        errors.append(
                            f"GSUB feature {feature_tag!r} maps {source!r} to both {existing!r} and {replacement!r}."
                        )
                        continue
                    mapping[source] = replacement
                    lookup_indices_by_source.setdefault(source, [])
                    if lookup_index not in lookup_indices_by_source[source]:
                        lookup_indices_by_source[source].append(lookup_index)

    if not mapping:
        errors.append(f"GSUB feature {feature_tag!r} does not contain any SingleSubst mappings.")
    return mapping, lookup_indices_by_source, lookup_reports, errors


def _encoded_source_glyphs(font: Any) -> list[str]:
    encoded = set(_codepoints_by_glyph(font))
    return [glyph_name for glyph_name in font.getGlyphOrder() if glyph_name in encoded]


def _feature_lookup_indices(font: Any, feature_tags: list[str]) -> tuple[list[int], list[str]]:
    lookup_list = getattr(font["GSUB"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []
    indices: set[int] = set()
    errors: list[str] = []

    for feature_tag in feature_tags:
        for record in _feature_records(font, feature_tag):
            for lookup_index in list(getattr(record.Feature, "LookupListIndex", []) or []):
                if not 0 <= lookup_index < len(lookups):
                    errors.append(f"GSUB feature {feature_tag!r} references missing lookup index {lookup_index}.")
                    continue
                indices.add(lookup_index)

    return sorted(indices), errors


def _selected_feature_source_conflict_errors(font: Any, feature_tags: list[str]) -> list[str]:
    if len(feature_tags) < 2:
        return []

    sources: dict[str, list[tuple[str, str]]] = {}
    lookup_list = getattr(font["GSUB"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []

    for feature_tag in feature_tags:
        for record in _feature_records(font, feature_tag):
            for lookup_index in list(getattr(record.Feature, "LookupListIndex", []) or []):
                if not 0 <= lookup_index < len(lookups):
                    continue
                lookup = lookups[lookup_index]
                if getattr(lookup, "LookupType", None) != 1:
                    continue
                for subtable in getattr(lookup, "SubTable", []) or []:
                    subtable_mapping = getattr(subtable, "mapping", None)
                    if subtable_mapping is None:
                        continue
                    for source, replacement in subtable_mapping.items():
                        sources.setdefault(source, []).append((feature_tag, replacement))

    errors: list[str] = []
    for source, entries in sorted(sources.items()):
        features = sorted({feature for feature, _replacement in entries})
        if len(features) < 2:
            continue
        substitutions = ", ".join(
            f"{feature}->{replacement}"
            for feature, replacement in sorted(set(entries), key=lambda item: (item[0], item[1]))
        )
        errors.append(
            f"Selected features {', '.join(features)} conflict because they all substitute "
            f"source glyph {source!r} ({substitutions}); choose only one feature for that glyph."
        )
    return errors


def _selected_feature_set_mapping(
    font: Any,
    feature_tags: list[str],
) -> tuple[dict[str, str], dict[str, list[int]], list[dict[str, Any]], list[str]]:
    if "GSUB" not in font:
        raise MaterialiseFeatureError("materialise_feature requires a GSUB table.")
    lookup_list = getattr(font["GSUB"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []
    lookup_indices, errors = _feature_lookup_indices(font, feature_tags)
    lookup_reports: list[dict[str, Any]] = []
    lookup_mappings: list[tuple[int, list[dict[str, str]]]] = []

    for lookup_index in lookup_indices:
        lookup = lookups[lookup_index]
        lookup_type = getattr(lookup, "LookupType", None)
        lookup_reports.append(
            {
                "lookupIndex": lookup_index,
                "lookupType": lookup_type,
                "lookupTypeName": _lookup_type_name(lookup_type),
                "subtableCount": len(getattr(lookup, "SubTable", []) or []),
                "supported": lookup_type == 1,
            }
        )
        if lookup_type != 1:
            errors.append(
                f"materialise_feature supports only GSUB SingleSubst lookups; "
                f"selected features {', '.join(feature_tags)!r} use lookup type {lookup_type}."
            )
            continue

        subtables: list[dict[str, str]] = []
        seen_in_lookup: dict[str, str] = {}
        for subtable in getattr(lookup, "SubTable", []) or []:
            subtable_mapping = getattr(subtable, "mapping", None)
            if subtable_mapping is None:
                errors.append(
                    f"GSUB lookup index {lookup_index} contains a SingleSubst subtable without a mapping."
                )
                continue
            normalized_mapping = dict(subtable_mapping)
            for source, replacement in normalized_mapping.items():
                existing = seen_in_lookup.get(source)
                if existing is not None and existing != replacement:
                    errors.append(
                        f"GSUB lookup index {lookup_index} maps {source!r} to both {existing!r} and {replacement!r}."
                    )
                seen_in_lookup[source] = replacement
            subtables.append(normalized_mapping)
        lookup_mappings.append((lookup_index, subtables))

    mapping: dict[str, str] = {}
    lookup_indices_by_source: dict[str, list[int]] = {}
    encoded_sources = list(_encoded_source_glyphs(font))
    encoded_source_set = set(encoded_sources)
    lookup_source_glyphs = {
        source
        for _lookup_index, subtables in lookup_mappings
        for subtable_mapping in subtables
        for source in subtable_mapping
    }
    seed_glyphs = encoded_source_set.intersection(lookup_source_glyphs)
    while True:
        chained_replacements: set[str] = set()
        for source in seed_glyphs:
            current = source
            for _lookup_index, subtables in lookup_mappings:
                for subtable_mapping in subtables:
                    replacement = subtable_mapping.get(current)
                    if replacement is None:
                        continue
                    chained_replacements.add(replacement)
                    current = replacement
                    break
        next_seeds = seed_glyphs.union(encoded_source_set.intersection(chained_replacements))
        if len(next_seeds) == len(seed_glyphs):
            break
        seed_glyphs = next_seeds

    for source in (glyph_name for glyph_name in encoded_sources if glyph_name in seed_glyphs):
        current = source
        applied_indices: list[int] = []
        for lookup_index, subtables in lookup_mappings:
            for subtable_mapping in subtables:
                replacement = subtable_mapping.get(current)
                if replacement is None:
                    continue
                current = replacement
                if lookup_index not in applied_indices:
                    applied_indices.append(lookup_index)
                break
        if current != source:
            mapping[source] = current
            lookup_indices_by_source[source] = applied_indices

    return mapping, lookup_indices_by_source, lookup_reports, errors


def _glyf_direct_components(font: Any, glyph_name: str) -> list[str]:
    try:
        glyph = font["glyf"][glyph_name]
    except KeyError:
        return []
    if glyph is None or not glyph.isComposite():
        return []
    return [component.glyphName for component in getattr(glyph, "components", []) or []]


def _post_swap_component_cycle_errors(font: Any, mapping: dict[str, str]) -> list[str]:
    if not mapping:
        return []

    component_map = _swap_component_map(mapping)
    glyph_data_sources: dict[str, str] = {}
    for source, replacement in mapping.items():
        glyph_data_sources[source] = replacement
        glyph_data_sources[replacement] = source

    def direct_components_after_swap(glyph_name: str) -> list[str]:
        data_source = glyph_data_sources.get(glyph_name, glyph_name)
        components = _glyf_direct_components(font, data_source)
        if glyph_name in glyph_data_sources:
            return [component_map.get(component, component) for component in components]
        return components

    def references_root(root: str, glyph_name: str, seen: set[str]) -> bool:
        if glyph_name in seen:
            return False
        seen.add(glyph_name)
        for component in direct_components_after_swap(glyph_name):
            if component == root:
                return True
            if references_root(root, component, seen):
                return True
        return False

    errors: list[str] = []
    for glyph_name in sorted(glyph_data_sources):
        for component in direct_components_after_swap(glyph_name):
            if component == glyph_name or references_root(glyph_name, component, set()):
                errors.append(
                    f"Swapping selected glyph data would create a composite glyph cycle involving "
                    f"{glyph_name!r}; nested composite references must be decomposed or skipped before export."
                )
                break
    return errors


def _validate_mapping(font: Any, mapping: dict[str, str], feature_tag: str, outline_format: str) -> tuple[dict[str, str], list[str], list[str]]:
    glyph_order = set(font.getGlyphOrder())
    hmtx = font["hmtx"].metrics
    glyf = font["glyf"] if outline_format == "glyf" else None
    charstrings = _cff_charstrings(font) if outline_format == "CFF" else None
    gvar_variations = font["gvar"].variations if "fvar" in font and "gvar" in font else None
    valid_mapping: dict[str, str] = {}
    warnings: list[str] = []
    errors: list[str] = []
    for source, replacement in mapping.items():
        pair_errors = []
        if source not in glyph_order:
            pair_errors.append(f"source glyph {source!r} is missing")
        if replacement not in glyph_order:
            pair_errors.append(f"replacement glyph {replacement!r} is missing")
        if glyf is not None:
            if source not in glyf.glyphs:
                pair_errors.append(f"source glyph {source!r} has no glyf data")
            if replacement not in glyf.glyphs:
                pair_errors.append(f"replacement glyph {replacement!r} has no glyf data")
        if gvar_variations is not None:
            if source not in gvar_variations:
                pair_errors.append(f"source glyph {source!r} has no gvar variation data")
            if replacement not in gvar_variations:
                pair_errors.append(f"replacement glyph {replacement!r} has no gvar variation data")
        if charstrings is not None:
            if source not in charstrings:
                pair_errors.append(f"source glyph {source!r} has no CFF CharString")
            if replacement not in charstrings:
                pair_errors.append(f"replacement glyph {replacement!r} has no CFF CharString")
        if source not in hmtx:
            pair_errors.append(f"source glyph {source!r} has no hmtx metrics")
        if replacement not in hmtx:
            pair_errors.append(f"replacement glyph {replacement!r} has no hmtx metrics")

        if pair_errors:
            warnings.append(
                f"Skipped GSUB feature {feature_tag!r} mapping {source!r} to {replacement!r}: "
                f"{'; '.join(pair_errors)}."
            )
            continue
        valid_mapping[source] = replacement

    if mapping and not valid_mapping:
        errors.append(f"GSUB feature {feature_tag!r} did not contain any complete glyph pairs to swap.")
    if outline_format == "glyf":
        errors.extend(_post_swap_component_cycle_errors(font, valid_mapping))
    return valid_mapping, warnings, errors


def _codepoint_entry(codepoint: int) -> dict[str, Any]:
    character = chr(codepoint)
    return {
        "value": codepoint,
        "hex": f"U+{codepoint:04X}",
        "character": character if character.isprintable() else None,
    }


def _codepoints_by_glyph(font: Any) -> dict[str, list[int]]:
    by_glyph: dict[str, set[int]] = {}
    if "cmap" not in font:
        return {}
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for codepoint, glyph_name in table.cmap.items():
            by_glyph.setdefault(glyph_name, set()).add(codepoint)
    return {glyph_name: sorted(codepoints) for glyph_name, codepoints in by_glyph.items()}


def _hmtx_metrics(font: Any, glyph_name: str) -> dict[str, int]:
    advance_width, left_side_bearing = font["hmtx"].metrics[glyph_name]
    return {
        "advanceWidth": advance_width,
        "leftSideBearing": left_side_bearing,
    }


def _vmtx_metrics(font: Any, glyph_name: str) -> dict[str, int] | None:
    if "vmtx" not in font:
        return None
    advance_height, top_side_bearing = font["vmtx"].metrics[glyph_name]
    return {
        "advanceHeight": advance_height,
        "topSideBearing": top_side_bearing,
    }


def _normalize_number(value: Any) -> int | float:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _glyph_bounds(font: Any, glyph_name: str) -> dict[str, int | float] | None:
    glyph = font["glyf"][glyph_name]
    if getattr(glyph, "numberOfContours", 0) == 0:
        return None
    x_min = getattr(glyph, "xMin", None)
    y_min = getattr(glyph, "yMin", None)
    x_max = getattr(glyph, "xMax", None)
    y_max = getattr(glyph, "yMax", None)
    if None in (x_min, y_min, x_max, y_max):
        glyph = deepcopy(glyph)
        try:
            glyph.recalcBounds(font["glyf"])
        except Exception:
            return None
        x_min = getattr(glyph, "xMin", None)
        y_min = getattr(glyph, "yMin", None)
        x_max = getattr(glyph, "xMax", None)
        y_max = getattr(glyph, "yMax", None)
    if None in (x_min, y_min, x_max, y_max):
        return None
    try:
        x_min, y_min, x_max, y_max = (_normalize_number(value) for value in (x_min, y_min, x_max, y_max))
    except TypeError:
        return None
    return {
        "xMin": x_min,
        "yMin": y_min,
        "xMax": x_max,
        "yMax": y_max,
        "width": _normalize_number(x_max - x_min),
        "height": _normalize_number(y_max - y_min),
    }


def _glyph_info(font: Any, glyph_name: str, outline_format: str) -> dict[str, Any]:
    if outline_format == "CFF":
        return {
            "isComposite": False,
            "components": [],
            "hmtx": _hmtx_metrics(font, glyph_name),
            "vmtx": _vmtx_metrics(font, glyph_name),
            "bounds": None,
        }
    glyph = font["glyf"][glyph_name]
    components = []
    if glyph.isComposite():
        components = [component.glyphName for component in glyph.components]
    return {
        "isComposite": glyph.isComposite(),
        "components": components,
        "hmtx": _hmtx_metrics(font, glyph_name),
        "vmtx": _vmtx_metrics(font, glyph_name),
        "bounds": _glyph_bounds(font, glyph_name),
    }


def _metric_change(source_info: dict[str, Any], replacement_info: dict[str, Any]) -> dict[str, Any]:
    source_hmtx = source_info["hmtx"]
    replacement_hmtx = replacement_info["hmtx"]
    advance_width_delta = replacement_hmtx["advanceWidth"] - source_hmtx["advanceWidth"]
    left_side_bearing_delta = replacement_hmtx["leftSideBearing"] - source_hmtx["leftSideBearing"]
    change = {
        "hmtxChanged": advance_width_delta != 0 or left_side_bearing_delta != 0,
        "vmtxChanged": False,
        "advanceWidthDelta": advance_width_delta,
        "leftSideBearingDelta": left_side_bearing_delta,
        "advanceHeightDelta": None,
        "topSideBearingDelta": None,
    }
    if source_info["vmtx"] is not None and replacement_info["vmtx"] is not None:
        advance_height_delta = replacement_info["vmtx"]["advanceHeight"] - source_info["vmtx"]["advanceHeight"]
        top_side_bearing_delta = replacement_info["vmtx"]["topSideBearing"] - source_info["vmtx"]["topSideBearing"]
        change["vmtxChanged"] = advance_height_delta != 0 or top_side_bearing_delta != 0
        change["advanceHeightDelta"] = advance_height_delta
        change["topSideBearingDelta"] = top_side_bearing_delta
    return change


def _bounds_delta(
    source_bounds: dict[str, Any] | None,
    replacement_bounds: dict[str, Any] | None,
) -> dict[str, Any]:
    keys = ("xMin", "yMin", "xMax", "yMax", "width", "height")
    delta_names = {
        "xMin": "xMinDelta",
        "yMin": "yMinDelta",
        "xMax": "xMaxDelta",
        "yMax": "yMaxDelta",
        "width": "widthDelta",
        "height": "heightDelta",
    }
    if source_bounds is None or replacement_bounds is None:
        return {delta_names[key]: None for key in keys}
    return {
        delta_names[key]: _normalize_number(replacement_bounds[key] - source_bounds[key])
        for key in keys
    }


def _bounds_changed(bounds: dict[str, Any]) -> bool:
    source_bounds = bounds["sourceBefore"]
    replacement_bounds = bounds["replacement"]
    if (source_bounds is None) != (replacement_bounds is None):
        return True
    return any(value not in (None, 0) for value in bounds["delta"].values())


def _max_abs_bounds_delta(bounds: dict[str, Any]) -> int | float:
    numeric_values = [
        abs(value)
        for value in bounds["delta"].values()
        if isinstance(value, int | float)
    ]
    if not numeric_values:
        return 0
    return _normalize_number(max(numeric_values))


def _bounds_report(source_info: dict[str, Any], replacement_info: dict[str, Any], status: str) -> dict[str, Any]:
    source_bounds = source_info["bounds"]
    replacement_bounds = replacement_info["bounds"]
    report = {
        "sourceBefore": source_bounds,
        "replacement": replacement_bounds,
        "delta": _bounds_delta(source_bounds, replacement_bounds),
    }
    if status == "would_materialise":
        report["sourceAfterPreview"] = replacement_bounds
    else:
        report["sourceAfter"] = replacement_bounds
    return report


def _simple_glyph_contours(font: Any, glyph_name: str) -> list[list[dict[str, Any]]]:
    glyph = font["glyf"][glyph_name]
    if glyph.isComposite():
        return []
    coordinates, end_points, flags = glyph.getCoordinates(font["glyf"])
    contours = []
    start = 0
    for end in end_points:
        contour = []
        for index in range(start, end + 1):
            x, y = coordinates[index]
            contour.append(
                {
                    "type": "point",
                    "x": _normalize_number(x),
                    "y": _normalize_number(y),
                    "onCurve": bool(flags[index] & 0x01),
                }
            )
        contours.append(contour)
        start = end + 1
    return contours


def _preview_glyph(font: Any, glyph_name: str, glyph_info: dict[str, Any]) -> dict[str, Any]:
    hmtx = glyph_info["hmtx"]
    return {
        "glyph": glyph_name,
        "advanceWidth": hmtx["advanceWidth"],
        "leftSideBearing": hmtx["leftSideBearing"],
        "bounds": glyph_info["bounds"],
        "isComposite": glyph_info["isComposite"],
        "components": glyph_info["components"],
        "contours": _simple_glyph_contours(font, glyph_name),
    }


def _preview_report(
    font: Any,
    source: str,
    replacement: str,
    source_info: dict[str, Any],
    replacement_info: dict[str, Any],
) -> dict[str, Any]:
    return {
        "unitsPerEm": font["head"].unitsPerEm if "head" in font else None,
        "sourceBefore": _preview_glyph(font, source, source_info),
        "replacement": _preview_glyph(font, replacement, replacement_info),
    }


def _preview_primitive_count(item: dict[str, Any]) -> int:
    preview = item.get("preview")
    if not preview:
        return 0
    count = 0
    for glyph_key in ("sourceBefore", "replacement"):
        glyph_preview = preview[glyph_key]
        count += len(glyph_preview["components"])
        count += sum(len(contour) for contour in glyph_preview["contours"])
    return count


def _mapping_report(
    font: Any,
    mapping: dict[str, str],
    lookup_indices_by_source: dict[str, list[int]],
    status: str,
    outline_format: str,
    include_preview_primitives: bool = False,
) -> list[dict[str, Any]]:
    cmap = _codepoints_by_glyph(font)
    report = []
    for source, replacement in sorted(mapping.items()):
        source_info = _glyph_info(font, source, outline_format)
        replacement_info = _glyph_info(font, replacement, outline_format)
        mapping_item = {
            "source": source,
            "replacement": replacement,
            "status": status,
            "lookupIndices": sorted(lookup_indices_by_source.get(source, [])),
            "codepoints": [_codepoint_entry(codepoint) for codepoint in cmap.get(source, [])],
            "sourceGlyph": source_info,
            "replacementGlyph": replacement_info,
            "metricChange": _metric_change(source_info, replacement_info),
            "bounds": _bounds_report(source_info, replacement_info, status),
        }
        if include_preview_primitives and outline_format == "glyf":
            mapping_item["preview"] = _preview_report(font, source, replacement, source_info, replacement_info)
        report.append(mapping_item)
    return report


def _summarize(lookups: list[dict[str, Any]], mapping: list[dict[str, Any]]) -> dict[str, Any]:
    affected_codepoints = {
        codepoint["value"]
        for item in mapping
        for codepoint in item["codepoints"]
    }
    return {
        "lookupCount": len(lookups),
        "mappingCount": len(mapping),
        "sourceGlyphCount": len({item["source"] for item in mapping}),
        "affectedCodepointCount": len(affected_codepoints),
        "hasCompositeSources": any(item["sourceGlyph"]["isComposite"] for item in mapping),
        "hasCompositeReplacements": any(item["replacementGlyph"]["isComposite"] for item in mapping),
        "hasMetricChanges": any(
            item["metricChange"]["hmtxChanged"] or item["metricChange"]["vmtxChanged"]
            for item in mapping
        ),
        "hasBoundsChanges": any(_bounds_changed(item["bounds"]) for item in mapping),
        "maxAbsBoundsDelta": _normalize_number(
            max((_max_abs_bounds_delta(item["bounds"]) for item in mapping), default=0)
        ),
        "previewPrimitiveCount": sum(_preview_primitive_count(item) for item in mapping),
    }


def _unique_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    unique = []
    for reason in reasons:
        if reason not in seen:
            unique.append(reason)
            seen.add(reason)
    return unique


def _unsupported_reason_from_error(error: str) -> str:
    lowered = error.lower()
    if "lookup type" in lowered or "singlesubst" in lowered:
        return "Unsupported lookup type"
    if "variable" in lowered or "cff" in lowered or "glyf-based" in lowered or "hmtx table" in lowered:
        return "Unsupported font type"
    if "source glyph" in lowered or "replacement glyph" in lowered or "glyf data" in lowered or "hmtx metrics" in lowered:
        return "Glyph data is incomplete"
    if "was not found" in lowered:
        return "Feature was not found"
    if "supports only" in lowered or "mode must be" in lowered:
        return "Unsupported materialise_feature request"
    return "Operation has blocking errors"


def _risk_summary(report: dict[str, Any]) -> dict[str, Any]:
    summary = report["summary"]
    errors = report.get("errors", [])
    if errors or not report.get("supported") or not report.get("fullyMaterialisable"):
        reasons = [_unsupported_reason_from_error(error) for error in errors]
        for lookup in report.get("lookups", []):
            if lookup.get("supported") is False:
                reasons.append(f"Unsupported lookup type: {lookup.get('lookupTypeName', 'unknown')}")
        if not reasons:
            reasons.append("Operation is not supported")
        return {
            "level": "unsupported",
            "label": "Unsupported",
            "reasons": _unique_reasons(reasons),
        }

    caution_reasons = []
    if summary["hasMetricChanges"]:
        caution_reasons.append("Metric changes detected")
    if summary["hasBoundsChanges"]:
        caution_reasons.append("Bounds changes detected")
    if summary["hasCompositeSources"]:
        caution_reasons.append("Composite source glyphs")
    if summary["hasCompositeReplacements"]:
        caution_reasons.append("Composite replacement glyphs")
    if not report.get("removeFeatureAfterwards"):
        caution_reasons.append("Feature will remain in font")
    review_warnings = [warning for warning in report.get("warnings", []) if warning != DRY_RUN_WARNING]
    if review_warnings:
        caution_reasons.append("Warnings need review")
    if summary["mappingCount"] > 20:
        caution_reasons.append("More than 20 glyph mappings")
    if summary["affectedCodepointCount"] > 20:
        caution_reasons.append("More than 20 affected codepoints")

    if caution_reasons:
        return {
            "level": "caution",
            "label": "Review recommended",
            "reasons": _unique_reasons(caution_reasons),
        }

    outline_format = report.get("outlineFormat")
    variable_support_level = report.get("variableSupportLevel")
    if variable_support_level in set(VARIABLE_SUPPORT_LEVELS.values()):
        support_label = {
            VARIABLE_SUPPORT_LEVEL_TTF: "Variable glyf TTF font",
            VARIABLE_SUPPORT_LEVEL_WOFF: "Variable glyf WOFF font",
            VARIABLE_SUPPORT_LEVEL_WOFF2: "Variable glyf WOFF2 font",
        }.get(variable_support_level, "Variable glyf font")
        safe_reasons = [support_label]
        instance_validation = report.get("instanceValidation") or {}
        if instance_validation.get("passed"):
            safe_reasons.append("Default and non-default instance validation passed")
    else:
        safe_reasons = ["Static CFF font" if outline_format == "CFF" else "Static glyf-based font"]
    if all(lookup.get("supported") for lookup in report.get("lookups", [])):
        safe_reasons.append("SingleSubst only")
    safe_reasons.extend(
        [
            "No composite glyphs",
            "No metric changes",
            "No bounds changes",
        ]
    )
    if report.get("removeFeatureAfterwards"):
        safe_reasons.append("Feature can be removed after materialisation")
    return {
        "level": "safe",
        "label": "Safe",
        "reasons": safe_reasons,
    }


def _finalize_report(report: dict[str, Any]) -> dict[str, Any]:
    report["riskSummary"] = _risk_summary(report)
    return report


def _snapshot_table_glyph(
    font: Any,
    glyph_name: str,
    outline_format: str,
    is_variable: bool = False,
    hvar_mappings: dict[str, dict[str, int] | None] | None = None,
) -> dict[str, Any]:
    hmtx = font["hmtx"].metrics
    snapshot: dict[str, Any] = {
        "hmtx": tuple(hmtx[glyph_name]),
        "vmtx": None,
    }
    if outline_format == "CFF":
        snapshot["charString"] = deepcopy(_cff_charstrings(font)[glyph_name])
    else:
        snapshot["glyf"] = deepcopy(font["glyf"].glyphs[glyph_name])
        if is_variable:
            snapshot["gvar"] = deepcopy(font["gvar"].variations[glyph_name])
            snapshot["hvar"] = _hvar_snapshot(font, glyph_name, hvar_mappings) if "HVAR" in font else None
    if "vmtx" in font:
        vmtx = font["vmtx"].metrics
        if glyph_name not in vmtx:
            raise MaterialiseFeatureError(f"Glyph {glyph_name!r} has no vmtx metrics.")
        snapshot["vmtx"] = tuple(vmtx[glyph_name])
    return snapshot


def _apply_table_glyph_snapshot(
    font: Any,
    glyph_name: str,
    snapshot: dict[str, Any],
    outline_format: str,
    is_variable: bool = False,
    component_map: dict[str, str] | None = None,
    hvar_mappings: dict[str, dict[str, int] | None] | None = None,
) -> None:
    if outline_format == "CFF":
        charstring = snapshot["charString"]
        _rebind_cff_charstring_private(font, charstring)
        _cff_charstrings(font)[glyph_name] = charstring
    else:
        glyph = deepcopy(snapshot["glyf"])
        _remap_glyf_components(glyph, component_map or {})
        font["glyf"].glyphs[glyph_name] = glyph
        if is_variable:
            font["gvar"].variations[glyph_name] = snapshot["gvar"]
            if snapshot.get("hvar") is not None:
                _apply_hvar_snapshot(font, glyph_name, snapshot["hvar"], hvar_mappings)
    font["hmtx"].metrics[glyph_name] = snapshot["hmtx"]
    if "vmtx" in font:
        font["vmtx"].metrics[glyph_name] = snapshot["vmtx"]


def _overlapping_swap_warnings(mapping: dict[str, str]) -> list[str]:
    pairs_by_glyph: dict[str, list[str]] = {}
    for source, replacement in mapping.items():
        pairs_by_glyph.setdefault(source, []).append(f"{source}->{replacement}")
        pairs_by_glyph.setdefault(replacement, []).append(f"{source}->{replacement}")
    warnings = []
    for glyph_name, pairs in sorted(pairs_by_glyph.items()):
        if len(pairs) > 1:
            warnings.append(
                f"Glyph {glyph_name!r} participates in multiple selected swap pairs; "
                "later GSUB mappings determine its final swapped data."
            )
    return warnings


def _swap_component_map(mapping: dict[str, str]) -> dict[str, str]:
    component_map: dict[str, str] = {}
    for source, replacement in mapping.items():
        component_map[source] = replacement
        component_map[replacement] = source
    return component_map


def _remap_glyf_components(glyph: Any, component_map: dict[str, str]) -> None:
    if not component_map or not glyph.isComposite():
        return
    for component in getattr(glyph, "components", []) or []:
        replacement_name = component_map.get(component.glyphName)
        if replacement_name is not None:
            component.glyphName = replacement_name


def _glyph_order_sort_key(glyph_order: dict[str, int], glyph_name: str) -> tuple[int, str]:
    return (glyph_order.get(glyph_name, len(glyph_order)), glyph_name)


def _remap_coverage(coverage: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> None:
    if coverage is None:
        return
    glyphs = list(getattr(coverage, "glyphs", []) or [])
    coverage.glyphs = sorted(
        [glyph_map.get(glyph_name, glyph_name) for glyph_name in glyphs],
        key=lambda glyph_name: _glyph_order_sort_key(glyph_order, glyph_name),
    )


def _remap_class_def(class_def: Any, glyph_map: dict[str, str]) -> None:
    if class_def is None:
        return
    class_defs = dict(getattr(class_def, "classDefs", {}) or {})
    class_def.classDefs = {
        glyph_map.get(glyph_name, glyph_name): class_id
        for glyph_name, class_id in class_defs.items()
    }


def _remap_coverage_records(
    coverage: Any,
    array: Any,
    record_attr: str,
    count_attr: str,
    glyph_map: dict[str, str],
    glyph_order: dict[str, int],
    label: str,
) -> list[str]:
    if coverage is None or array is None:
        return []
    coverage_glyphs = list(getattr(coverage, "glyphs", []) or [])
    records = list(getattr(array, record_attr, []) or [])
    if len(coverage_glyphs) != len(records):
        return [f"Skipped malformed GPOS {label} subtable with mismatched Coverage and {record_attr} counts."]

    warnings: list[str] = []
    remapped: list[tuple[str, Any]] = []
    seen: set[str] = set()
    for glyph_name, record in zip(coverage_glyphs, records):
        remapped_glyph = glyph_map.get(glyph_name, glyph_name)
        if remapped_glyph in seen:
            warnings.append(f"Skipped duplicate remapped GPOS {label} glyph {remapped_glyph!r}.")
            continue
        seen.add(remapped_glyph)
        remapped.append((remapped_glyph, deepcopy(record)))

    remapped.sort(key=lambda item: _glyph_order_sort_key(glyph_order, item[0]))
    coverage.glyphs = [glyph_name for glyph_name, _record in remapped]
    setattr(array, record_attr, [record for _glyph_name, record in remapped])
    setattr(array, count_attr, len(remapped))
    return warnings


def _swap_pairpos_format1(subtable: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> list[str]:
    warnings: list[str] = []
    coverage_glyphs = list(getattr(getattr(subtable, "Coverage", None), "glyphs", []) or [])
    pair_sets = list(getattr(subtable, "PairSet", []) or [])
    if len(coverage_glyphs) != len(pair_sets):
        return ["Skipped malformed GPOS PairPos Format 1 subtable with mismatched Coverage and PairSet counts."]

    new_coverage_glyphs: list[str] = []
    new_pair_sets: list[Any] = []
    seen_firsts: set[str] = set()
    for first_glyph, pair_set in zip(coverage_glyphs, pair_sets):
        remapped_first = glyph_map.get(first_glyph, first_glyph)
        if remapped_first in seen_firsts:
            warnings.append(
                f"Skipped duplicate remapped GPOS PairPos Format 1 first glyph {remapped_first!r}."
            )
            continue
        seen_firsts.add(remapped_first)
        remapped_pair_set = deepcopy(pair_set)
        for pair_value_record in getattr(remapped_pair_set, "PairValueRecord", []) or []:
            second_glyph = getattr(pair_value_record, "SecondGlyph", None)
            if second_glyph is not None:
                pair_value_record.SecondGlyph = glyph_map.get(second_glyph, second_glyph)
        remapped_pair_set.PairValueRecord = sorted(
            list(getattr(remapped_pair_set, "PairValueRecord", []) or []),
            key=lambda record: _glyph_order_sort_key(glyph_order, getattr(record, "SecondGlyph", "")),
        )
        remapped_pair_set.PairValueCount = len(getattr(remapped_pair_set, "PairValueRecord", []) or [])
        new_coverage_glyphs.append(remapped_first)
        new_pair_sets.append(remapped_pair_set)

    ordered = sorted(
        zip(new_coverage_glyphs, new_pair_sets),
        key=lambda item: _glyph_order_sort_key(glyph_order, item[0]),
    )
    subtable.Coverage.glyphs = [glyph_name for glyph_name, _pair_set in ordered]
    subtable.PairSet = [pair_set for _glyph_name, pair_set in ordered]
    subtable.PairSetCount = len(new_pair_sets)
    return warnings


def _swap_pairpos_format2(subtable: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> list[str]:
    _remap_coverage(getattr(subtable, "Coverage", None), glyph_map, glyph_order)
    _remap_class_def(getattr(subtable, "ClassDef1", None), glyph_map)
    _remap_class_def(getattr(subtable, "ClassDef2", None), glyph_map)
    return []


def _swap_pairpos_subtable(subtable: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> list[str]:
    format_id = getattr(subtable, "Format", None)
    if format_id == 1:
        return _swap_pairpos_format1(subtable, glyph_map, glyph_order)
    if format_id == 2:
        return _swap_pairpos_format2(subtable, glyph_map, glyph_order)
    return [f"Unsupported GPOS PairPos format {format_id}; positioning behaviour was not swapped for that subtable."]


def _swap_markbase_subtable(subtable: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> list[str]:
    warnings: list[str] = []
    warnings.extend(
        _remap_coverage_records(
            getattr(subtable, "MarkCoverage", None),
            getattr(subtable, "MarkArray", None),
            "MarkRecord",
            "MarkCount",
            glyph_map,
            glyph_order,
            "MarkBasePos mark",
        )
    )
    warnings.extend(
        _remap_coverage_records(
            getattr(subtable, "BaseCoverage", None),
            getattr(subtable, "BaseArray", None),
            "BaseRecord",
            "BaseCount",
            glyph_map,
            glyph_order,
            "MarkBasePos base",
        )
    )
    return warnings


def _swap_markmark_subtable(subtable: Any, glyph_map: dict[str, str], glyph_order: dict[str, int]) -> list[str]:
    warnings: list[str] = []
    warnings.extend(
        _remap_coverage_records(
            getattr(subtable, "Mark1Coverage", None),
            getattr(subtable, "Mark1Array", None),
            "MarkRecord",
            "MarkCount",
            glyph_map,
            glyph_order,
            "MarkMarkPos mark1",
        )
    )
    warnings.extend(
        _remap_coverage_records(
            getattr(subtable, "Mark2Coverage", None),
            getattr(subtable, "Mark2Array", None),
            "Mark2Record",
            "Mark2Count",
            glyph_map,
            glyph_order,
            "MarkMarkPos mark2",
        )
    )
    return warnings


def _gpos_feature_tags_by_lookup(font: Any) -> dict[int, list[str]]:
    if "GPOS" not in font:
        return {}
    feature_list = getattr(font["GPOS"].table, "FeatureList", None)
    feature_records = getattr(feature_list, "FeatureRecord", []) if feature_list else []
    tags_by_lookup: dict[int, list[str]] = {}
    for record in feature_records:
        feature_tag = getattr(record, "FeatureTag", None)
        if not feature_tag:
            continue
        for lookup_index in list(getattr(record.Feature, "LookupListIndex", []) or []):
            tags_by_lookup.setdefault(lookup_index, [])
            if feature_tag not in tags_by_lookup[lookup_index]:
                tags_by_lookup[lookup_index].append(feature_tag)
    return tags_by_lookup


def _coverage_role_hits(subtable: Any, coverage_attr: str, role: str, glyph_names: set[str]) -> dict[str, set[str]]:
    coverage = getattr(subtable, coverage_attr, None)
    glyphs = set(getattr(coverage, "glyphs", []) or [])
    hits = glyphs & glyph_names
    return {role: hits} if hits else {}


def _merge_role_hits(target: dict[str, set[str]], source: dict[str, set[str]]) -> None:
    for role, glyphs in source.items():
        target.setdefault(role, set()).update(glyphs)


def _affected_gpos_roles(subtable: Any, lookup_type: int | None, glyph_names: set[str]) -> dict[str, set[str]]:
    roles: dict[str, set[str]] = {}
    if lookup_type == 1:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Coverage", "coverage glyph", glyph_names))
    elif lookup_type == 2:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Coverage", "first glyph", glyph_names))
        if getattr(subtable, "Format", None) == 1:
            for pair_set in getattr(subtable, "PairSet", []) or []:
                for record in getattr(pair_set, "PairValueRecord", []) or []:
                    second_glyph = getattr(record, "SecondGlyph", None)
                    if second_glyph in glyph_names:
                        roles.setdefault("second glyph", set()).add(second_glyph)
        elif getattr(subtable, "Format", None) == 2:
            for glyph_name in set(getattr(getattr(subtable, "ClassDef1", None), "classDefs", {}) or {}) & glyph_names:
                roles.setdefault("first-side class member", set()).add(glyph_name)
            for glyph_name in set(getattr(getattr(subtable, "ClassDef2", None), "classDefs", {}) or {}) & glyph_names:
                roles.setdefault("second-side class member", set()).add(glyph_name)
    elif lookup_type == 3:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Coverage", "cursive glyph", glyph_names))
    elif lookup_type == 4:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "MarkCoverage", "mark glyph", glyph_names))
        _merge_role_hits(roles, _coverage_role_hits(subtable, "BaseCoverage", "base glyph", glyph_names))
    elif lookup_type == 5:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "MarkCoverage", "mark glyph", glyph_names))
        _merge_role_hits(roles, _coverage_role_hits(subtable, "LigatureCoverage", "ligature glyph", glyph_names))
    elif lookup_type == 6:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Mark1Coverage", "mark1 glyph", glyph_names))
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Mark2Coverage", "mark2 glyph", glyph_names))
    elif lookup_type in {7, 8}:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Coverage", "contextual input", glyph_names))
    else:
        _merge_role_hits(roles, _coverage_role_hits(subtable, "Coverage", "coverage glyph", glyph_names))
    return roles


def _role_summary(roles: dict[str, set[str]]) -> tuple[list[str], str]:
    affected = sorted({glyph_name for glyphs in roles.values() for glyph_name in glyphs})
    if not roles:
        return affected, "unknown role"
    parts = []
    for role, glyphs in sorted(roles.items()):
        parts.append(f"{role}: {', '.join(sorted(glyphs))}")
    return affected, "; ".join(parts)


def _object_referenced_glyphs(obj: Any, glyph_names: set[str], seen: set[int] | None = None, depth: int = 0) -> set[str]:
    if obj is None or depth > 8:
        return set()
    if isinstance(obj, str):
        return {obj} if obj in glyph_names else set()
    if isinstance(obj, dict):
        hits: set[str] = set()
        for key, value in obj.items():
            hits.update(_object_referenced_glyphs(key, glyph_names, seen, depth + 1))
            hits.update(_object_referenced_glyphs(value, glyph_names, seen, depth + 1))
        return hits
    if isinstance(obj, (list, tuple, set)):
        hits: set[str] = set()
        for item in obj:
            hits.update(_object_referenced_glyphs(item, glyph_names, seen, depth + 1))
        return hits
    if not hasattr(obj, "__dict__"):
        return set()

    if seen is None:
        seen = set()
    obj_id = id(obj)
    if obj_id in seen:
        return set()
    seen.add(obj_id)

    hits: set[str] = set()
    for attribute, value in vars(obj).items():
        if attribute.startswith("_"):
            continue
        hits.update(_object_referenced_glyphs(value, glyph_names, seen, depth + 1))
    return hits


def _unsupported_positioning_warning(
    lookup_index: int,
    lookup_type: int | None,
    feature_tags: list[str],
    roles: dict[str, set[str]],
    wrapped_lookup_type: int | None = None,
) -> str:
    feature_text = ", ".join(feature_tags) if feature_tags else "unreferenced feature"
    affected, role_text = _role_summary(roles)
    affected_text = ", ".join(affected) if affected else "unknown swapped glyphs"
    if lookup_type == 9:
        lookup_text = f"ExtensionPos wrapping {_gpos_lookup_type_name(wrapped_lookup_type)}"
        behaviour_text = f"{_gpos_lookup_type_name(wrapped_lookup_type)} positioning"
    else:
        lookup_text = _gpos_lookup_type_name(lookup_type)
        behaviour_text = f"{lookup_text} positioning"
    return (
        f"GPOS lookup {lookup_index} via feature {feature_text} is {lookup_text} and references "
        f"swapped glyphs: {affected_text} ({role_text}). {behaviour_text} was not swapped; "
        "recommended severity: warning; manual review is needed."
    )


def _object_references_glyph(obj: Any, glyph_names: set[str], seen: set[int] | None = None, depth: int = 0) -> bool:
    if obj is None or depth > 8:
        return False
    if isinstance(obj, str):
        return obj in glyph_names
    if isinstance(obj, dict):
        return any(
            _object_references_glyph(key, glyph_names, seen, depth + 1)
            or _object_references_glyph(value, glyph_names, seen, depth + 1)
            for key, value in obj.items()
        )
    if isinstance(obj, (list, tuple, set)):
        return any(_object_references_glyph(item, glyph_names, seen, depth + 1) for item in obj)
    if not hasattr(obj, "__dict__"):
        return False

    if seen is None:
        seen = set()
    obj_id = id(obj)
    if obj_id in seen:
        return False
    seen.add(obj_id)

    coverage_glyphs = getattr(obj, "glyphs", None)
    if isinstance(coverage_glyphs, list) and any(glyph_name in glyph_names for glyph_name in coverage_glyphs):
        return True
    class_defs = getattr(obj, "classDefs", None)
    if isinstance(class_defs, dict) and any(glyph_name in glyph_names for glyph_name in class_defs):
        return True
    second_glyph = getattr(obj, "SecondGlyph", None)
    if isinstance(second_glyph, str) and second_glyph in glyph_names:
        return True

    for attribute, value in vars(obj).items():
        if attribute.startswith("_"):
            continue
        if _object_references_glyph(value, glyph_names, seen, depth + 1):
            return True
    return False


def _swap_gpos_positioning(font: Any, mapping: dict[str, str], dry_run: bool = False) -> list[str]:
    if "GPOS" not in font:
        return []

    glyph_map = _swap_component_map(mapping)
    swapped_glyphs = set(glyph_map)
    glyph_order = {glyph_name: index for index, glyph_name in enumerate(font.getGlyphOrder())}
    feature_tags_by_lookup = _gpos_feature_tags_by_lookup(font)
    lookup_list = getattr(font["GPOS"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []
    warnings: list[str] = []

    for lookup_index, lookup in enumerate(lookups):
        lookup_type = getattr(lookup, "LookupType", None)
        if lookup_type in {2, 4, 6}:
            if dry_run:
                continue
            for subtable in getattr(lookup, "SubTable", []) or []:
                if lookup_type == 2:
                    warnings.extend(_swap_pairpos_subtable(subtable, glyph_map, glyph_order))
                elif lookup_type == 4:
                    warnings.extend(_swap_markbase_subtable(subtable, glyph_map, glyph_order))
                elif lookup_type == 6:
                    warnings.extend(_swap_markmark_subtable(subtable, glyph_map, glyph_order))
            continue
        if lookup_type == 9:
            for subtable in getattr(lookup, "SubTable", []) or []:
                extension_lookup_type = getattr(subtable, "ExtensionLookupType", None)
                extension_subtable = getattr(subtable, "ExtSubTable", None)
                if extension_lookup_type in {2, 4, 6} and extension_subtable is not None:
                    if not dry_run:
                        if extension_lookup_type == 2:
                            warnings.extend(_swap_pairpos_subtable(extension_subtable, glyph_map, glyph_order))
                        elif extension_lookup_type == 4:
                            warnings.extend(_swap_markbase_subtable(extension_subtable, glyph_map, glyph_order))
                        elif extension_lookup_type == 6:
                            warnings.extend(_swap_markmark_subtable(extension_subtable, glyph_map, glyph_order))
                elif _object_references_glyph(subtable, swapped_glyphs):
                    roles = _affected_gpos_roles(extension_subtable or subtable, extension_lookup_type, swapped_glyphs)
                    if not roles:
                        referenced = _object_referenced_glyphs(subtable, swapped_glyphs)
                        if referenced:
                            roles = {"referenced glyph": referenced}
                    warnings.append(
                        _unsupported_positioning_warning(
                            lookup_index,
                            lookup_type,
                            feature_tags_by_lookup.get(lookup_index, []),
                            roles,
                            wrapped_lookup_type=extension_lookup_type,
                        )
                    )
            continue
        if _object_references_glyph(lookup, swapped_glyphs):
            roles: dict[str, set[str]] = {}
            for subtable in getattr(lookup, "SubTable", []) or []:
                _merge_role_hits(roles, _affected_gpos_roles(subtable, lookup_type, swapped_glyphs))
            if not roles:
                referenced = _object_referenced_glyphs(lookup, swapped_glyphs)
                if referenced:
                    roles = {"referenced glyph": referenced}
            warnings.append(
                _unsupported_positioning_warning(
                    lookup_index,
                    lookup_type,
                    feature_tags_by_lookup.get(lookup_index, []),
                    roles,
                )
            )

    return warnings


def _swap_legacy_kern(font: Any, mapping: dict[str, str], dry_run: bool = False) -> list[str]:
    if "kern" not in font:
        return []
    if dry_run:
        return []

    glyph_map = _swap_component_map(mapping)
    warnings: list[str] = []
    for subtable_index, subtable in enumerate(getattr(font["kern"], "kernTables", []) or []):
        kern_table = getattr(subtable, "kernTable", None)
        if not isinstance(kern_table, dict):
            continue
        remapped_table: dict[tuple[str, str], int] = {}
        for (left_glyph, right_glyph), value in list(kern_table.items()):
            remapped_key = (
                glyph_map.get(left_glyph, left_glyph),
                glyph_map.get(right_glyph, right_glyph),
            )
            if remapped_key in remapped_table and remapped_table[remapped_key] != value:
                warnings.append(
                    f"Legacy kern subtable {subtable_index} produced a remapped pair collision for {remapped_key!r}."
                )
            remapped_table[remapped_key] = value
        subtable.kernTable = remapped_table
    return warnings


def _swap_positioning_behavior(font: Any, mapping: dict[str, str], dry_run: bool = False) -> list[str]:
    warnings: list[str] = []
    warnings.extend(_swap_gpos_positioning(font, mapping, dry_run=dry_run))
    warnings.extend(_swap_legacy_kern(font, mapping, dry_run=dry_run))
    return warnings


def _swap_table_glyphs(font: Any, mapping: dict[str, str], outline_format: str, is_variable: bool = False) -> None:
    snapshots: dict[str, dict[str, Any]] = {}
    updates: dict[str, dict[str, Any]] = {}
    component_map = _swap_component_map(mapping) if outline_format == "glyf" else {}
    hvar_mappings = _hvar_mappings(font) if is_variable and "HVAR" in font else None

    for source, replacement in mapping.items():
        snapshots.setdefault(
            source,
            _snapshot_table_glyph(
                font,
                source,
                outline_format,
                is_variable=is_variable,
                hvar_mappings=hvar_mappings,
            ),
        )
        snapshots.setdefault(
            replacement,
            _snapshot_table_glyph(
                font,
                replacement,
                outline_format,
                is_variable=is_variable,
                hvar_mappings=hvar_mappings,
            ),
        )

    for source, replacement in mapping.items():
        updates[source] = snapshots[replacement]
        updates[replacement] = snapshots[source]

    for glyph_name, snapshot in updates.items():
        _apply_table_glyph_snapshot(
            font,
            glyph_name,
            snapshot,
            outline_format,
            is_variable=is_variable,
            component_map=component_map,
            hvar_mappings=hvar_mappings,
        )

    # Transitive component remap. Composites that are NOT in the mapping but
    # reference swapped glyphs (e.g. periodcentered.case -> periodcentered, where
    # periodcentered <-> periodcentered.ss15 is swapped) must also be remapped,
    # otherwise their decomposed outline resolves through the wrong base glyph.
    if outline_format == "glyf" and component_map:
        for glyph_name, glyph in font["glyf"].glyphs.items():
            if glyph_name in updates:
                continue  # already handled by _apply_table_glyph_snapshot
            if not glyph.isComposite():
                continue
            comps = getattr(glyph, "components", None) or []
            for component in comps:
                repl = component_map.get(component.glyphName)
                if repl is not None:
                    component.glyphName = repl


def _swap_glyf_glyphs(font: Any, mapping: dict[str, str]) -> None:
    _swap_table_glyphs(font, mapping, "glyf")


def _swap_cff_charstrings(font: Any, mapping: dict[str, str]) -> None:
    _swap_table_glyphs(font, mapping, "CFF")


def _swap_variable_glyf_glyphs(font: Any, mapping: dict[str, str]) -> None:
    _swap_table_glyphs(font, mapping, "glyf", is_variable=True)


def _copy_glyf_glyphs(font: Any, mapping: dict[str, str]) -> None:
    _swap_glyf_glyphs(font, mapping)


def _copy_cff_charstrings(font: Any, mapping: dict[str, str]) -> None:
    _swap_cff_charstrings(font, mapping)


def _copy_variable_glyf_glyphs(font: Any, mapping: dict[str, str]) -> None:
    _swap_variable_glyf_glyphs(font, mapping)


def _copy_glyphs(font: Any, mapping: dict[str, str], outline_format: str, is_variable: bool = False) -> None:
    _swap_glyphs(font, mapping, outline_format, is_variable=is_variable)


def _swap_glyphs(font: Any, mapping: dict[str, str], outline_format: str, is_variable: bool = False) -> None:
    if outline_format == "CFF":
        _swap_cff_charstrings(font, mapping)
    elif is_variable:
        _swap_variable_glyf_glyphs(font, mapping)
    else:
        _swap_glyf_glyphs(font, mapping)


def _drop_stale_materialisation_tables(font: Any) -> list[str]:
    dropped = []
    for table_tag in STALE_AFTER_MATERIALISATION_TABLES:
        if table_tag in font:
            del font[table_tag]
            dropped.append(table_tag)
    return dropped


def _stale_table_warnings(dropped_tables: list[str]) -> list[str]:
    warnings = []
    if "DSIG" in dropped_tables:
        warnings.append("Dropped DSIG because materialisation invalidates digital signatures.")
    dropped_device_tables = [table_tag for table_tag in ("hdmx", "LTSH", "VDMX") if table_tag in dropped_tables]
    if dropped_device_tables:
        warnings.append(
            "Dropped stale device-metric tables after materialisation: "
            f"{', '.join(dropped_device_tables)}."
        )
    return warnings


def _clone_font(font: Any) -> TTFont:
    buffer = BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer, recalcBBoxes=False, recalcTimestamp=False)


def _variable_instance_locations(font: Any) -> list[dict[str, Any]]:
    axes = _variable_axes(font)
    if not axes:
        return []
    default = {axis["tag"]: axis["default"] for axis in axes}
    locations: list[dict[str, Any]] = [{"name": "default", "coordinates": dict(default)}]

    for axis in axes:
        tag = axis["tag"]
        if tag == "wght" and axis["max"] != axis["default"]:
            location = dict(default)
            location[tag] = axis["max"]
            locations.append({"name": "wght-max", "coordinates": location})
            break

    for axis in axes:
        tag = axis["tag"]
        if tag == "slnt" and axis["min"] != axis["default"]:
            location = dict(default)
            location[tag] = axis["min"]
            locations.append({"name": "slnt-min", "coordinates": location})
            break

    seen: set[tuple[tuple[str, Any], ...]] = set()
    unique_locations = []
    for location in locations:
        key = tuple(sorted(location["coordinates"].items()))
        if key not in seen:
            unique_locations.append(location)
            seen.add(key)
    return unique_locations


def _instance_font(font: Any, coordinates: dict[str, Any]) -> TTFont:
    instance_font = deepcopy(font)
    instantiateVariableFont(instance_font, coordinates, inplace=True)
    return instance_font


def _instantiated_glyph_state(font: Any, glyph_name: str) -> tuple[tuple[Any, ...], tuple[int, int]]:
    glyph_set = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    return (
        tuple(pen.value),
        tuple(font["hmtx"].metrics[glyph_name]),
    )


def _validate_variable_instances(original_font: Any, materialised_font: Any, mapping: dict[str, str]) -> dict[str, Any]:
    report = {
        "passed": False,
        "scope": "default-and-non-default-instances",
        "locations": [],
        "errors": [],
    }
    try:
        locations = _variable_instance_locations(original_font)
        if len(locations) < 2:
            report["errors"].append("Variable instance validation requires at least one non-default test location.")
            return report

        for location in locations:
            original_instance = _instance_font(original_font, location["coordinates"])
            materialised_instance = _instance_font(materialised_font, location["coordinates"])
            location_report = {
                "name": location["name"],
                "coordinates": {
                    tag: _normalize_number(value)
                    for tag, value in sorted(location["coordinates"].items())
                },
                "passed": True,
                "errors": [],
            }
            try:
                for source, replacement in mapping.items():
                    original_replacement_bytes, original_replacement_metrics = _instantiated_glyph_state(original_instance, replacement)
                    materialised_source_bytes, materialised_source_metrics = _instantiated_glyph_state(materialised_instance, source)
                    if materialised_source_bytes != original_replacement_bytes:
                        location_report["passed"] = False
                        location_report["errors"].append(
                            f"{source!r} outline did not match original {replacement!r} at this instance."
                        )
                    if materialised_source_metrics != original_replacement_metrics:
                        location_report["passed"] = False
                        location_report["errors"].append(
                            f"{source!r} metrics did not match original {replacement!r} at this instance."
                        )
                    original_source_bytes, original_source_metrics = _instantiated_glyph_state(original_instance, source)
                    materialised_replacement_bytes, materialised_replacement_metrics = _instantiated_glyph_state(
                        materialised_instance,
                        replacement,
                    )
                    if materialised_replacement_bytes != original_source_bytes:
                        location_report["passed"] = False
                        location_report["errors"].append(
                            f"{replacement!r} outline did not match original {source!r} at this instance."
                        )
                    if materialised_replacement_metrics != original_source_metrics:
                        location_report["passed"] = False
                        location_report["errors"].append(
                            f"{replacement!r} metrics did not match original {source!r} at this instance."
                        )
                report["locations"].append(location_report)
            finally:
                original_instance.close()
                materialised_instance.close()

        report["passed"] = all(location["passed"] for location in report["locations"])
        if not report["passed"]:
            report["errors"].append("Variable instance validation failed.")
    except Exception as exc:
        report["errors"].append(f"Variable instance validation failed: {exc}")
    return report


def _normalize_selected_feature_tags(features: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for feature in features:
        if feature not in SUPPORTED_FEATURES:
            raise MaterialiseFeatureError("materialise_feature supports only tnum, zero, and ss01-ss20 in Phase 2A.")
        if feature not in seen:
            unique.append(feature)
            seen.add(feature)
    if not unique:
        raise MaterialiseFeatureError("materialise_feature requires at least one selected feature.")
    return unique


def materialise_features(
    font: Any,
    features: list[str],
    remove_feature_afterwards: bool = True,
    mode: str = SUPPORTED_MODE,
    dry_run: bool = False,
    include_preview_primitives: bool = False,
    raise_on_error: bool = True,
    detected_format: str | None = None,
) -> dict[str, Any]:
    """Materialise selected SingleSubst features by swapping glyph data in GSUB lookup order."""
    try:
        selected_features = _normalize_selected_feature_tags(features)
    except MaterialiseFeatureError as exc:
        selected_features = features[:1] or [""]
        report = _new_report(selected_features[0], mode, dry_run, remove_feature_afterwards, include_preview_primitives)
        report["selectedFeatures"] = features
        report["operationOrder"] = features
        report["resolutionOrder"] = "gsub_lookup_order"
        report["errors"].append(str(exc))
        _finalize_report(report)
        if raise_on_error:
            raise
        return report

    report = _new_report(selected_features[0], mode, dry_run, remove_feature_afterwards, include_preview_primitives)
    report["selectedFeatures"] = selected_features
    report["operationOrder"] = selected_features
    report["resolutionOrder"] = "gsub_lookup_order"

    def fail(message: str) -> dict[str, Any]:
        report["errors"].append(message)
        _finalize_report(report)
        if raise_on_error:
            raise MaterialiseFeatureError(message)
        return report

    if mode != SUPPORTED_MODE:
        return fail("materialise_feature mode must be 'replace_default_glyphs'.")

    try:
        outline_format = _validate_supported_font(font, detected_format=detected_format)
        is_variable = "fvar" in font
        report["outlineFormat"] = outline_format
        report["previewPrimitiveSupport"] = outline_format == "glyf"
        report["cffSupportLevel"] = CFF_SUPPORT_LEVEL if outline_format == "CFF" else None
        report["isVariable"] = is_variable
        if is_variable:
            report["variableSupportLevel"] = _variable_support_level(detected_format)
            report["variableTables"] = _present_variable_tables(font)
            report["namedInstances"] = _variable_named_instances(font)
            report["hvarPolicy"] = _hvar_policy(font)
            report["vvarPolicy"] = "not-present"
            report["previewScope"] = VARIABLE_PREVIEW_SCOPE
        mapping, lookup_indices_by_source, lookups, mapping_errors = _selected_feature_set_mapping(font, selected_features)
        if not mapping and not mapping_errors and len(selected_features) == 1:
            mapping, lookup_indices_by_source, lookups, mapping_errors = _collect_single_subst_mapping(
                font,
                selected_features[0],
            )
        elif not mapping and not mapping_errors:
            mapping_errors.append(
                f"Selected GSUB features {', '.join(selected_features)!r} do not resolve any encoded source glyphs."
            )
        report["lookups"] = lookups
        mapping, validation_warnings, validation_errors = _validate_mapping(font, mapping, report["feature"], outline_format)
        report["warnings"].extend(validation_warnings)
        all_errors = mapping_errors + validation_errors
        status = "would_materialise" if dry_run else "materialised"
        if not all_errors:
            report["mapping"] = _mapping_report(
                font,
                mapping,
                lookup_indices_by_source,
                status,
                outline_format,
                include_preview_primitives=include_preview_primitives,
            )
            report["summary"] = _summarize(report["lookups"], report["mapping"])
    except MaterialiseFeatureError as exc:
        all_errors = [str(exc)]

    if all_errors:
        report["errors"].extend(all_errors)
        _finalize_report(report)
        if raise_on_error:
            raise MaterialiseFeatureError("; ".join(all_errors))
        return report

    report["supported"] = True
    report["fullyMaterialisable"] = True

    if dry_run:
        report["warnings"].extend(_swap_positioning_behavior(font, mapping, dry_run=True))
        report["warnings"].append(DRY_RUN_WARNING)
    else:
        original_font = _clone_font(font) if report["isVariable"] else None
        try:
            report["warnings"].extend(_overlapping_swap_warnings(mapping))
            _swap_glyphs(font, mapping, report["outlineFormat"], is_variable=report["isVariable"])
            if report["isVariable"]:
                report["gvarCopied"] = True
                report["copiedVariationData"] = True
                instance_validation = _validate_variable_instances(original_font, font, mapping)
                report["instanceValidation"] = instance_validation
                if not instance_validation.get("passed"):
                    report["errors"].extend(instance_validation.get("errors") or ["Variable instance validation failed."])
                    return _finalize_report(report)
            report["warnings"].extend(_swap_positioning_behavior(font, mapping))
        finally:
            if original_font is not None:
                original_font.close()
        report["warnings"].extend(_stale_table_warnings(_drop_stale_materialisation_tables(font)))
        if remove_feature_afterwards:
            remove_features(font, selected_features)
            report["removedFeatureAfterwards"] = True

    return _finalize_report(report)


def _gsub_feature_tags(font: Any) -> set[str]:
    if "GSUB" not in font:
        return set()
    feature_list = getattr(font["GSUB"].table, "FeatureList", None)
    if not feature_list:
        return set()
    return {
        record.FeatureTag
        for record in getattr(feature_list, "FeatureRecord", []) or []
        if getattr(record, "FeatureTag", None)
    }


def _feature_lookup_types(font: Any, feature_tag: str) -> set[int | None]:
    if "GSUB" not in font:
        return set()
    feature_list = getattr(font["GSUB"].table, "FeatureList", None)
    lookup_list = getattr(font["GSUB"].table, "LookupList", None)
    lookups = getattr(lookup_list, "Lookup", []) if lookup_list else []
    if not feature_list:
        return set()
    types: set[int | None] = set()
    for record in getattr(feature_list, "FeatureRecord", []) or []:
        if getattr(record, "FeatureTag", None) != feature_tag:
            continue
        for lookup_index in list(getattr(record.Feature, "LookupListIndex", []) or []):
            if 0 <= lookup_index < len(lookups):
                types.add(getattr(lookups[lookup_index], "LookupType", None))
    return types


def partition_replace_default_features(
    font: Any,
    features: list[str] | tuple[str, ...] | None,
) -> tuple[list[str], list[str]]:
    """Split requested tags into materialisable vs skip warnings."""
    requested = normalize_replace_default_features(features)
    if not requested:
        return [], []

    present = _gsub_feature_tags(font)
    usable: list[str] = []
    warnings: list[str] = []
    for tag in requested:
        if tag not in present:
            warnings.append(f"Skipped replace-default feature {tag!r}: not present in GSUB.")
            continue
        lookup_types = _feature_lookup_types(font, tag)
        if not lookup_types:
            warnings.append(f"Skipped replace-default feature {tag!r}: no GSUB lookups.")
            continue
        if any(lookup_type != 1 for lookup_type in lookup_types):
            unsupported = sorted(
                {
                    _lookup_type_name(lookup_type)
                    for lookup_type in lookup_types
                    if lookup_type != 1
                }
            )
            warnings.append(
                f"Skipped replace-default feature {tag!r}: unsupported lookup type(s) "
                f"{', '.join(unsupported)} (SingleSubst only)."
            )
            continue
        usable.append(tag)
    return usable, warnings


def materialise_features_in_font(
    font_path: Path | str,
    features: list[str] | tuple[str, ...] | None,
    *,
    remove_feature_afterwards: bool = True,
    output_path: Path | str | None = None,
) -> dict[str, Any]:
    """Materialise selected features in a font file; missing tags are ignored.

    Returns a report dict with keys:
    - selectedFeatures / appliedFeatures / skippedWarnings / mapping / errors / ...
    Writes to ``output_path`` when provided, otherwise overwrites ``font_path``.
    """
    path = Path(font_path)
    destination = Path(output_path) if output_path is not None else path
    requested = normalize_replace_default_features(features)
    empty_report: dict[str, Any] = {
        "selectedFeatures": requested,
        "appliedFeatures": [],
        "skippedWarnings": [],
        "mapping": [],
        "errors": [],
        "warnings": [],
        "supported": True,
        "fullyMaterialisable": True,
        "removedFeatureAfterwards": False,
        "changed": False,
        "inputPath": str(path),
        "outputPath": str(destination),
    }
    if not requested:
        return empty_report

    font = TTFont(path, recalcBBoxes=False, recalcTimestamp=False)
    try:
        usable, skip_warnings = partition_replace_default_features(font, requested)
        empty_report["skippedWarnings"] = list(skip_warnings)
        empty_report["warnings"] = list(skip_warnings)
        if not usable:
            return empty_report

        detected_format = detect_font_container_format(path, font)
        outcome = materialise_features(
            font,
            usable,
            remove_feature_afterwards=remove_feature_afterwards,
            raise_on_error=False,
            detected_format=detected_format,
        )
        outcome["selectedFeatures"] = requested
        outcome["appliedFeatures"] = usable
        outcome["skippedWarnings"] = list(skip_warnings)
        outcome["warnings"] = list(skip_warnings) + list(outcome.get("warnings") or [])
        outcome["inputPath"] = str(path)
        outcome["outputPath"] = str(destination)
        if outcome.get("errors"):
            outcome["changed"] = False
            return outcome

        destination.parent.mkdir(parents=True, exist_ok=True)
        font.save(destination)
        outcome["changed"] = True
        return outcome
    finally:
        font.close()


def materialise_features_in_fonts(
    font_paths: list[Path] | tuple[Path, ...],
    features: list[str] | tuple[str, ...] | None,
    *,
    log: Any | None = None,
) -> list[dict[str, Any]]:
    """Materialise features in-place for each font path; return per-font reports."""
    reports: list[dict[str, Any]] = []
    requested = normalize_replace_default_features(features)
    if not requested:
        return reports

    for font_path in font_paths:
        report = materialise_features_in_font(font_path, requested)
        reports.append(report)
        if log is None:
            continue
        applied = report.get("appliedFeatures") or []
        skipped = report.get("skippedWarnings") or []
        errors = report.get("errors") or []
        if errors:
            log(f"  Replace-default failed for {Path(font_path).name}: {'; '.join(errors)}")
        elif applied:
            log(
                f"  Replace-default applied {', '.join(applied)} on {Path(font_path).name}"
                f" ({len(report.get('mapping') or [])} glyph pair(s))."
            )
        for warning in skipped:
            log(f"  {warning}")
    return reports


def _empty_cli_report(
    requested: list[str],
    input_path: Path,
    destination: Path,
) -> dict[str, Any]:
    return {
        "selectedFeatures": requested,
        "appliedFeatures": [],
        "skippedWarnings": [],
        "mapping": [],
        "errors": [],
        "warnings": [],
        "supported": True,
        "fullyMaterialisable": True,
        "removedFeatureAfterwards": False,
        "changed": False,
        "inputPath": str(input_path),
        "outputPath": str(destination),
    }


def materialise_features_in_collection(
    font_path: Path | str,
    features: list[str] | tuple[str, ...] | None,
    *,
    output_path: Path | str | None = None,
) -> dict[str, Any]:
    """Materialise selected features in every font of a TTC/OTC collection."""
    path = Path(font_path)
    destination = Path(output_path) if output_path is not None else path
    requested = normalize_replace_default_features(features)
    report = _empty_cli_report(requested, path, destination)
    if not requested:
        return report

    collection = TTCollection(str(path))
    try:
        applied: list[str] = []
        skipped: list[str] = []
        mapping: list[dict[str, Any]] = []
        errors: list[str] = []
        warnings: list[str] = []
        changed = False
        for font in collection.fonts:
            usable, skip_warnings = partition_replace_default_features(font, requested)
            skipped.extend(skip_warnings)
            warnings.extend(skip_warnings)
            if not usable:
                continue
            detected_format = detect_font_container_format(path, font)
            outcome = materialise_features(
                font,
                usable,
                remove_feature_afterwards=True,
                raise_on_error=False,
                detected_format=detected_format,
            )
            errors.extend(outcome.get("errors") or [])
            warnings.extend(outcome.get("warnings") or [])
            mapping.extend(outcome.get("mapping") or [])
            if outcome.get("errors"):
                continue
            changed = True
            for tag in usable:
                if tag not in applied:
                    applied.append(tag)
        report["appliedFeatures"] = applied
        report["skippedWarnings"] = skipped
        report["mapping"] = mapping
        report["errors"] = errors
        report["warnings"] = warnings
        if errors:
            report["changed"] = False
            return report
        if changed:
            destination.parent.mkdir(parents=True, exist_ok=True)
            collection.save(str(destination))
        report["changed"] = changed
        return report
    finally:
        collection.close()


def materialise_path(
    font_path: Path | str,
    features: list[str] | tuple[str, ...] | None,
    *,
    output_path: Path | str | None = None,
) -> dict[str, Any]:
    path = Path(font_path)
    destination = Path(output_path) if output_path is not None else path
    if path.suffix.lower() in {".ttc", ".otc"}:
        return materialise_features_in_collection(path, features, output_path=destination)
    return materialise_features_in_font(path, features, output_path=destination)


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--":
        argv = argv[1:]
    if len(argv) < 3:
        sys.stderr.write("Usage: materialise_feature.py [--] <input> <output> <tag> [<tag> ...]\n")
        return 1
    src, dest, *tags = argv
    path = Path(src)
    destination = Path(dest)
    if not path.is_file():
        sys.stderr.write(f"[font-butler] missing file: {path}\n")
        return 1
    try:
        report = materialise_path(path, tags, output_path=destination)
    except Exception as exc:
        sys.stderr.write(f"[font-butler] materialise failed: {exc}\n")
        return 1
    sys.stdout.write(json.dumps(report, default=str))
    sys.stdout.write("\n")
    if report.get("errors"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
