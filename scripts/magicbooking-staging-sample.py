#!/usr/bin/env python3
"""Build a deterministic, representative Magicbooking staging sample.

This script never connects to Supabase and never sends email. It consumes the
validated dry-run payloads and writes a small sample package for staging QA.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))


def child_features(child: dict) -> set[str]:
    registration = child.get("consents", {}).get("registration", {})
    text = " ".join(
        [
            child.get("medical_notes", ""),
            child.get("allergy_notes", ""),
            child.get("dietary_notes", ""),
            " ".join(child.get("flags", [])),
        ]
    ).lower()
    features = set()
    for feature, needles in {
        "allergy": ("allerg",),
        "dietary": ("diet",),
        "medical": ("medical", "condition"),
    }.items():
        if any(needle in text for needle in needles):
            features.add(feature)
    if registration.get("medications"):
        features.add("medication")
    if registration.get("autoInjectors"):
        features.add("auto_injector")
    if registration.get("send"):
        features.add("send")
    missing = set(child.get("migration_metadata", {}).get("missingFields", []))
    if "school" in missing:
        features.add("missing_school")
    if "year group" in missing:
        features.add("missing_year_group")
    if "collection password" in missing:
        features.add("missing_collection_password")
    if not features & {"allergy", "dietary", "medical", "medication", "auto_injector", "send"}:
        features.add("no_care_flags")
    return features


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--size", type=int, default=20)
    args = parser.parse_args()

    parents = read_jsonl(args.dry_run_dir / "parent_accounts.import.jsonl")
    children = read_jsonl(args.dry_run_dir / "child_profiles.import.jsonl")
    with (args.dry_run_dir / "parent_invite_cohort.csv").open(newline="") as source:
        cohort = list(csv.DictReader(source))

    ready_external_ids = {
        row["external_parent_id"]
        for row in cohort
        if row.get("activation_status") == "ready_for_sample_review"
    }
    ready_parents = [parent for parent in parents if parent["external_id"] in ready_external_ids]
    children_by_parent: dict[str, list[dict]] = defaultdict(list)
    for child in children:
        children_by_parent[child["parent_account_id"]].append(child)

    profiles = []
    for parent in ready_parents:
        family_children = children_by_parent[parent["id"]]
        features = set().union(*(child_features(child) for child in family_children))
        missing = set(parent.get("migration_metadata", {}).get("missingFields", []))
        if any("second emergency contact" in item for item in missing):
            features.add("missing_secondary_contact")
        if len(family_children) > 1:
            features.add("multiple_children")
        if len(parent.get("registered_centres", [])) > 1:
            features.add("multiple_centres")
        profiles.append({"parent": parent, "children": family_children, "features": features})

    profiles.sort(key=lambda item: item["parent"]["external_id"])
    selected: list[dict] = []
    selected_ids: set[str] = set()

    def select_first(predicate) -> None:
        if len(selected) >= args.size:
            return
        match = next(
            (item for item in profiles if item["parent"]["id"] not in selected_ids and predicate(item)),
            None,
        )
        if match:
            selected.append(match)
            selected_ids.add(match["parent"]["id"])

    centres = sorted({centre for item in profiles for centre in item["parent"].get("registered_centres", [])})
    for centre in centres:
        select_first(lambda item, centre=centre: centre in item["parent"].get("registered_centres", []))
    for feature in (
        "multiple_centres", "multiple_children", "allergy", "dietary", "medical",
        "medication", "auto_injector", "send", "missing_secondary_contact",
        "missing_school", "missing_year_group", "missing_collection_password", "no_care_flags",
    ):
        select_first(lambda item, feature=feature: feature in item["features"])

    centre_index = 0
    while len(selected) < args.size:
        centre = centres[centre_index % len(centres)] if centres else ""
        before = len(selected)
        select_first(lambda item, centre=centre: not centre or centre in item["parent"].get("registered_centres", []))
        if len(selected) == before:
            select_first(lambda item: True)
        if len(selected) == before:
            break
        centre_index += 1

    sample_parents = [item["parent"] for item in selected]
    sample_children = [child for item in selected for child in item["children"]]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output_dir / "parent_accounts.sample.jsonl", sample_parents)
    write_jsonl(args.output_dir / "child_profiles.sample.jsonl", sample_children)

    manifest_rows = []
    for item in selected:
        parent = item["parent"]
        manifest_rows.append({
            "external_parent_id": parent["external_id"],
            "parent_name": parent["full_name"],
            "email": parent["email"],
            "centres": " | ".join(parent.get("registered_centres", [])),
            "children": " | ".join(child["full_name"] for child in item["children"]),
            "features": " | ".join(sorted(item["features"])),
            "qa_status": "not_checked",
            "qa_notes": "",
        })
    with (args.output_dir / "sample_qa_manifest.csv").open("w", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(manifest_rows[0]))
        writer.writeheader()
        writer.writerows(manifest_rows)

    coverage = sorted(set().union(*(item["features"] for item in selected)))
    summary = {
        "mode": "sample_package_only",
        "databaseWrites": 0,
        "emailsSent": 0,
        "families": len(sample_parents),
        "children": len(sample_children),
        "centres": centres,
        "featureCoverage": coverage,
        "warning": "Contains personal data. Keep private. Import only into an isolated staging Supabase project.",
    }
    (args.output_dir / "sample_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
