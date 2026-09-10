"""Remove OpenType feature records from GSUB/GPOS tables."""

from __future__ import annotations

from typing import Any, Iterator


def iter_langsys(script_list: Any) -> Iterator[tuple[str, str, Any]]:
    """Yield (script tag, language tag, LangSys table) records."""
    if not script_list:
        return
    for script_record in getattr(script_list, "ScriptRecord", []) or []:
        script_tag = script_record.ScriptTag
        script = script_record.Script
        default_langsys = getattr(script, "DefaultLangSys", None)
        if default_langsys:
            yield script_tag, "dflt", default_langsys
        for lang_record in getattr(script, "LangSysRecord", []) or []:
            yield script_tag, lang_record.LangSysTag, lang_record.LangSys


def _remap_feature_variations(table: Any, old_to_new: dict[int, int], table_tag: str) -> None:
    feature_variations = getattr(table, "FeatureVariations", None)
    if feature_variations is None:
        return

    variation_records = list(getattr(feature_variations, "FeatureVariationRecord", []) or [])
    kept_variation_records = []
    for variation_record in variation_records:
        substitution = getattr(variation_record, "FeatureTableSubstitution", None)
        if substitution is None:
            continue

        substitution_records = getattr(substitution, "SubstitutionRecord", None)
        if substitution_records is None:
            continue

        kept_substitutions = []
        for substitution_record in substitution_records:
            feature_index = getattr(substitution_record, "FeatureIndex", None)
            if feature_index is None or feature_index not in old_to_new:
                continue
            substitution_record.FeatureIndex = old_to_new[feature_index]
            kept_substitutions.append(substitution_record)

        if kept_substitutions:
            substitution.SubstitutionRecord = kept_substitutions
            substitution.SubstitutionCount = len(kept_substitutions)
            kept_variation_records.append(variation_record)

    feature_variations.FeatureVariationRecord = kept_variation_records
    feature_variations.FeatureVariationCount = len(kept_variation_records)


def _remove_from_table(font: Any, table_tag: str, requested: list[str]) -> list[str]:
    if table_tag not in font:
        return []
    table = font[table_tag].table
    feature_list = getattr(table, "FeatureList", None)
    if not feature_list:
        return []
    records = list(getattr(feature_list, "FeatureRecord", []) or [])
    if not records:
        return []

    requested_set = set(requested)
    present = {record.FeatureTag for record in records}
    removed = [tag for tag in requested if tag in present]
    if not removed:
        return []

    old_to_new: dict[int, int] = {}
    kept_records = []
    for index, record in enumerate(records):
        if record.FeatureTag in requested_set:
            continue
        old_to_new[index] = len(kept_records)
        kept_records.append(record)

    script_list = getattr(table, "ScriptList", None)
    for _, _, langsys in iter_langsys(script_list):
        old_indices = list(getattr(langsys, "FeatureIndex", []) or [])
        langsys.FeatureIndex = [old_to_new[index] for index in old_indices if index in old_to_new]
        langsys.FeatureCount = len(langsys.FeatureIndex)

        required_index = getattr(langsys, "ReqFeatureIndex", 0xFFFF)
        if required_index != 0xFFFF:
            langsys.ReqFeatureIndex = old_to_new.get(required_index, 0xFFFF)

    _remap_feature_variations(table, old_to_new, table_tag)

    feature_list.FeatureRecord = kept_records
    feature_list.FeatureCount = len(kept_records)
    return removed


def remove_features(font: Any, features: list[str]) -> dict[str, Any]:
    """Remove selected feature records from both GSUB and GPOS."""
    requested = [feature.strip() for feature in features if feature and feature.strip()]
    removed_by_table = {
        "GSUB": _remove_from_table(font, "GSUB", requested),
        "GPOS": _remove_from_table(font, "GPOS", requested),
    }
    found = set(removed_by_table["GSUB"]) | set(removed_by_table["GPOS"])
    not_found = [feature for feature in requested if feature not in found]
    return {
        "removedFeatures": removed_by_table,
        "requestedFeaturesNotFound": not_found,
        "warnings": [],
    }
