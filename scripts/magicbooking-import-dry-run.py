#!/usr/bin/env python3
"""Prepare Magicbooking family exports for a reviewed, no-write import.

This script has no network or Supabase client code. It only reads the two supplied
Excel exports and writes deterministic JSONL/CSV review artifacts to --output-dir.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import posixpath
import re
import uuid
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


MAGICBOOKING_NAMESPACE = uuid.UUID("24d2bd7d-80be-4541-9d83-331602231808")
SOURCE_NAME = "magicbooking"
IMPORT_BATCH = "magicbooking-2026-07"
TODAY = date(2026, 7, 21)

CHILD_CONSENT_ROWS = [
    "I give consent for my child being photographed",
    "Does your child have religious or cultural needs?",
    "I consent to my child receiving emergency treatments",
    "I consent for plasters to be used on my child if required",
    "I consent to my child taking part in face-painting activities",
    "I consent to my child having medication. I have completed a medical form in advance",
    "I consent to my child to be supported by staff to apply sun cream",
    "I consent for pictures or videos of my child to be used on social media",
    "I consent to my child receiving basic first-aid treatments",
    "I consent to my child receiving help in the bathroom if needed (6 years old and under)",
    "I consent for my child to be collected by someone in my list of collectors",
    "I consent to my child going home alone (Year 6 only)",
]

CENTRE_MAP = {
    "willington prep school": "Willington Prep",
    "willington school": "Willington Prep",
    "king's house school": "King's House School",
    "kings house school": "King's House School",
    "ripley court school": "Ripley Court School",
    "shrewsbury house school": "Shrewsbury House School",
}

PARENT_COLUMNS = {
    "Centre", "Parent Id", "First name", "Last name", "Email", "Address", "Town",
    "County", "PostCode", "Children", "Groups", "Date added", "Primary Contact",
    "Secondary Contact", "Ethnicity", "Where did you hear about us", "Bookings Made",
    "Hmrc Connected", "Hmrc Token Expired",
}

CHILD_COLUMNS = {
    "Centre", "School", "Classroom", "Id", "Name", "Gender", "Age", "DoB", "Is FSM",
    "Is Pupil Premium", "Ethnicity", "Allergies", "Auto-injector", "Auto-injector Exp.Date",
    "Dietary Needs", "Medical Conditions", "Medications", "SEND", "EHCP in place",
    "Additional Info", "Is Active", "Religious", "Languages", "Bookings Made", "Parent Id",
    "Parent", "Parent Email", "Parent Mobile No", "Parent Address", "Collection Password",
    "External Agency",
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "none", "null", "n/a", "na", "-"} else text


def clean_id(value: Any) -> str:
    return re.sub(r"\.0$", "", clean(value))


def digits(value: Any) -> str:
    return re.sub(r"\D", "", clean(value))


def truthy(value: Any) -> bool:
    return clean(value).lower() in {"yes", "true", "1", "y"}


def split_values(value: Any) -> list[str]:
    return [part.strip() for part in re.split(r"[\n;,]+", clean(value)) if part.strip()]


def single_distinct_value(value: Any) -> str:
    parts = split_values(value)
    distinct = list(dict.fromkeys(part.casefold() for part in parts))
    if len(distinct) == 1 and parts:
        return parts[0]
    return clean(value)


def parse_labelled_record(value: Any, field_aliases: dict[str, str]) -> dict[str, str]:
    """Turn Magicbooking's multi-line ``Label: value`` exports into named fields."""
    raw = clean(value)
    if not raw:
        return {}
    parsed: dict[str, str] = {}
    active_field = ""
    for line in raw.splitlines():
        text = line.strip()
        if not text:
            continue
        match = re.match(r"^([^:]{1,60}):\s*(.*)$", text)
        if match:
            label = re.sub(r"[^a-z0-9]+", " ", match.group(1).lower()).strip()
            field = field_aliases.get(label, "")
            if field:
                active_field = field
                parsed[field] = match.group(2).strip()
                continue
        if active_field:
            parsed[active_field] = "\n".join(filter(None, [parsed.get(active_field, ""), text]))
    return parsed


def parse_medication(value: Any) -> dict[str, str]:
    raw = clean(value)
    if not raw:
        return {}
    parsed = parse_labelled_record(raw, {
        "name": "name",
        "medication": "name",
        "medication name": "name",
        "administration": "administered",
        "administer": "administered",
        "how administered": "administered",
        "supervision": "supervision",
        "supervision required": "supervision",
        "time": "time",
        "timing": "time",
        "timing hrs": "time",
        "dosage": "dosage",
        "effect": "effect",
        "reason": "reason",
        "cause reason": "reason",
        "details": "details",
        "additional details": "details",
        "expiry": "expiry",
        "expiry date": "expiry",
    })
    if not parsed.get("name"):
        parsed["name"] = raw
    if parsed.get("expiry"):
        parsed["expiry"] = parse_date(parsed["expiry"])
    parsed.setdefault("details", "Imported from Magicbooking; parent review required")
    return parsed


def parse_allergy(value: Any) -> dict[str, str]:
    raw = clean(value)
    if not raw:
        return {}
    parsed = parse_labelled_record(raw, {
        "allergy": "allergy",
        "allergic to": "allergy",
        "foods triggers to avoid": "triggers",
        "things to avoid": "triggers",
        "symptoms": "symptoms",
        "initial action": "initialAction",
        "medication": "medication",
        "details": "details",
        "additional details": "details",
    })
    if not parsed.get("allergy"):
        parsed["allergy"] = raw
    return parsed


def parse_dietary_need(value: Any) -> dict[str, str]:
    raw = clean(value)
    if not raw:
        return {}
    parsed = parse_labelled_record(raw, {
        "dietary needs": "need",
        "dietary need": "need",
        "details": "details",
        "diet description": "details",
    })
    if not parsed.get("need"):
        parsed["need"] = raw
    return parsed


def parse_medical_condition(value: Any) -> dict[str, str]:
    raw = clean(value)
    if not raw:
        return {}
    parsed = parse_labelled_record(raw, {
        "medical condition": "condition",
        "condition": "condition",
        "details": "details",
        "additional details": "details",
    })
    if not parsed.get("condition"):
        parsed["condition"] = raw
    return parsed


def canonical_centre(value: Any) -> str:
    raw = clean(value)
    return CENTRE_MAP.get(raw.lower(), raw)


def parse_centre_list(value: Any) -> list[str]:
    centres = [canonical_centre(part) for part in re.split(r"[\n;]+", clean(value)) if clean(part)]
    return list(dict.fromkeys(centre for centre in centres if centre))


def deterministic_uuid(kind: str, external_id: str) -> str:
    return str(uuid.uuid5(MAGICBOOKING_NAMESPACE, f"{SOURCE_NAME}:{kind}:{external_id}"))


def excel_serial_to_date(value: str) -> str:
    try:
        serial = float(value)
    except (TypeError, ValueError):
        return clean(value)
    converted = datetime(1899, 12, 30) + timedelta(days=serial)
    return converted.date().isoformat()


def parse_date(value: Any) -> str:
    raw = single_distinct_value(value)
    if not raw:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return excel_serial_to_date(raw)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return raw


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def column_index(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference.upper())
    if not letters:
        return 0
    result = 0
    for char in letters.group(0):
        result = result * 26 + (ord(char) - 64)
    return result - 1


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter() if node.tag.endswith("}t")) for item in root]


def first_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    first_sheet = next(node for node in workbook.iter() if node.tag.endswith("}sheet"))
    relationship_id = next(value for key, value in first_sheet.attrib.items() if key.endswith("}id"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next(node.attrib["Target"] for node in relationships if node.attrib.get("Id") == relationship_id)
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def read_xlsx_rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        shared = read_shared_strings(archive)
        sheet = ET.fromstring(archive.read(first_sheet_path(archive)))
        matrices: list[list[str]] = []
        for row in (node for node in sheet.iter() if node.tag.endswith("}row")):
            values: dict[int, str] = {}
            for position, cell in enumerate(node for node in row if node.tag.endswith("}c")):
                reference = cell.attrib.get("r")
                index = column_index(reference) if reference else position
                cell_type = cell.attrib.get("t", "")
                value_node = next((node for node in cell if node.tag.endswith("}v")), None)
                if cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.iter() if node.tag.endswith("}t"))
                else:
                    value = value_node.text if value_node is not None else ""
                    if cell_type == "s" and value:
                        value = shared[int(value)]
                values[index] = clean(value)
            if values:
                width = max(values) + 1
                matrices.append([values.get(index, "") for index in range(width)])
        if not matrices:
            return []
        header_index = next(
            (
                index
                for index, row in enumerate(matrices)
                if {clean(value) for value in row} & {"Parent Id", "Child Id"}
            ),
            0,
        )
        headers = [clean(value) for value in matrices[header_index]]
        records = []
        for row in matrices[header_index + 1:]:
            padded = row + [""] * max(0, len(headers) - len(row))
            record = {header: clean(padded[index]) for index, header in enumerate(headers) if header}
            if any(record.values()):
                records.append(record)
        return records


def validate_columns(records: list[dict[str, str]], expected: set[str], label: str) -> None:
    if not records:
        raise ValueError(f"{label} export is empty")
    found = set(records[0])
    missing = sorted(expected - found)
    if missing:
        raise ValueError(f"{label} export is missing columns: {', '.join(missing)}")


def age_on(dob: str, on_date: date) -> float | None:
    try:
        parsed = date.fromisoformat(dob)
    except ValueError:
        return None
    return (on_date - parsed).days / 365.2425


def add_exception(exceptions: list[dict[str, str]], category: str, severity: str,
                  parent_id: str = "", child_id: str = "", label: str = "",
                  detail: str = "", action: str = "") -> None:
    exceptions.append({
        "category": category,
        "severity": severity,
        "external_parent_id": parent_id,
        "external_child_id": child_id,
        "record_label": label,
        "detail": detail,
        "recommended_action": action,
    })


def build_parent_payloads(parent_rows: list[dict[str, str]], exceptions: list[dict[str, str]]):
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in parent_rows:
        parent_id = clean_id(row.get("Parent Id"))
        if parent_id:
            grouped[parent_id].append(row)

    payloads: list[dict[str, Any]] = []
    source_by_parent: dict[str, dict[str, str]] = {}
    for parent_id, rows in sorted(grouped.items()):
        first = rows[0]
        source_by_parent[parent_id] = first
        centres: list[str] = []
        for row in rows:
            centres.extend(parse_centre_list(row.get("Centre")))
        centres = list(dict.fromkeys(centres))
        if len(rows) > 1:
            emails = {clean(row.get("Email")).lower() for row in rows}
            non_centre_columns = PARENT_COLUMNS - {"Centre", "Groups", "Children", "Parent Id"}
            conflicts = sorted(column for column in non_centre_columns if len({clean(row.get(column)) for row in rows}) > 1)
            add_exception(
                exceptions, "duplicate_parent_id", "info" if not conflicts else "error",
                parent_id=parent_id, label=clean(first.get("Email")),
                detail=f"{len(rows)} rows across {len(centres)} centre(s); conflicting fields: {', '.join(conflicts) or 'none'}.",
                action="Merge centre memberships" if not conflicts else "Resolve conflicting parent details before import",
            )
            if len(emails) > 1:
                raise ValueError(f"Parent ID {parent_id} has conflicting email addresses")

        full_name = " ".join(part for part in [clean(first.get("First name")), clean(first.get("Last name"))] if part)
        email = clean(first.get("Email")).lower()
        primary_phone = clean(first.get("Primary Contact"))
        secondary_phone = clean(first.get("Secondary Contact"))
        missing_fields = []
        if not secondary_phone:
            missing_fields.append("second emergency contact number")
            add_exception(
                exceptions, "missing_secondary_contact", "parent_action", parent_id=parent_id,
                label=email, detail="No second contact number was exported.",
                action="Parent must add a second emergency contact during activation",
            )
        missing_fields.extend(["second emergency contact name", "second emergency contact relationship", "fresh terms and privacy acceptance"])
        contacts = [{
            "type": "primary",
            "name": full_name,
            "relationship": "Main account holder",
            "email": email,
            "mobile": primary_phone,
            "imported": True,
        }]
        if secondary_phone:
            contacts.append({
                "type": "secondary",
                "name": "",
                "relationship": "",
                "email": "",
                "mobile": secondary_phone,
                "imported": True,
                "needsReview": True,
            })
        payloads.append({
            "id": deterministic_uuid("parent", parent_id),
            "profile_id": None,
            "full_name": full_name,
            "email": email,
            "phone": primary_phone or None,
            "billing_address": {
                "line1": clean(first.get("Address")),
                "line2": "",
                "town": clean(first.get("Town")),
                "county": clean(first.get("County")),
                "country": "United Kingdom",
                "postcode": clean(first.get("PostCode")).upper(),
            },
            "emergency_contact": {
                "primaryPhone": primary_phone,
                "secondaryPhone": secondary_phone,
                "contacts": contacts,
                "requiresReview": True,
            },
            "marketing_preferences": {
                "apresEmail": False,
                "apresSms": False,
                "source": clean(first.get("Where did you hear about us")),
                "migrationConsentRequired": True,
            },
            "portal_status": "migration_review",
            "external_source": SOURCE_NAME,
            "external_id": parent_id,
            "registered_centres": centres,
            "migration_metadata": {
                "batch": IMPORT_BATCH,
                "requiresReview": True,
                "missingFields": missing_fields,
                "sourceRowCount": len(rows),
                "sourceGroups": split_values(first.get("Groups")),
                "sourceDateAdded": parse_date(first.get("Date added")),
                "sourceBookingsMade": clean(first.get("Bookings Made")),
                "parentEthnicityDiscarded": True,
            },
        })
    return payloads, source_by_parent


def build_child_payloads(child_rows: list[dict[str, str]], parent_payload_by_external_id: dict[str, dict[str, Any]],
                         parent_source_by_id: dict[str, dict[str, str]], exceptions: list[dict[str, str]]):
    payloads: list[dict[str, Any]] = []
    child_ids: set[str] = set()
    children_by_parent: Counter[str] = Counter()
    active_children_by_parent: Counter[str] = Counter()

    for row in child_rows:
        child_id = clean_id(row.get("Id"))
        parent_id = clean_id(row.get("Parent Id"))
        child_name = clean(row.get("Name"))
        if not child_id or not parent_id:
            continue
        if child_id in child_ids:
            raise ValueError(f"Duplicate child ID {child_id}")
        child_ids.add(child_id)
        parent_payload = parent_payload_by_external_id.get(parent_id)
        if not parent_payload:
            add_exception(
                exceptions, "unmatched_parent", "error", parent_id=parent_id, child_id=child_id,
                label=child_name, detail="Child Parent ID does not exist in the parent export.",
                action="Identify or create the correct parent account before importing this child",
            )
            continue

        children_by_parent[parent_id] += 1
        is_active = truthy(row.get("Is Active"))
        if is_active:
            active_children_by_parent[parent_id] += 1
        dob = parse_date(row.get("DoB"))
        missing_fields = ["relationship to child", "who the child lives with", "parental responsibility", "fresh consents"]
        if not clean(row.get("Classroom")):
            missing_fields.append("year group")
            add_exception(exceptions, "missing_year_group", "parent_action", parent_id, child_id, child_name,
                          "No classroom or year group was exported.", "Parent must add the current year group")
        if not clean(row.get("School")):
            missing_fields.append("school")
            add_exception(exceptions, "missing_school", "parent_action", parent_id, child_id, child_name,
                          "No school was exported.", "Parent must select the child's school")
        if not clean(row.get("Collection Password")):
            missing_fields.append("collection password")
            add_exception(exceptions, "missing_collection_password", "parent_action", parent_id, child_id, child_name,
                          "No collection password was exported.", "Parent must set a collection password")
        child_age = age_on(dob, TODAY)
        if child_age is None or child_age < 2 or child_age > 18:
            add_exception(exceptions, "date_of_birth_review", "error", parent_id, child_id, child_name,
                          f"Exported DOB {dob or 'missing'} gives an unusual age for wraparound care.",
                          "Verify the date of birth before invitation")

        parent_source = parent_source_by_id[parent_id]
        if digits(row.get("Parent Mobile No")) != digits(parent_source.get("Primary Contact")):
            add_exception(exceptions, "parent_phone_mismatch", "error", parent_id, child_id, child_name,
                          "Child export parent mobile differs from the parent export primary contact.",
                          "Verify the parent contact number")

        allergies = clean(row.get("Allergies"))
        auto_injector = single_distinct_value(row.get("Auto-injector"))
        auto_injector_expiry = parse_date(row.get("Auto-injector Exp.Date"))
        dietary = clean(row.get("Dietary Needs"))
        medical = clean(row.get("Medical Conditions"))
        medications = clean(row.get("Medications"))
        send = clean(row.get("SEND"))
        ehcp = clean(row.get("EHCP in place"))
        additional = clean(row.get("Additional Info"))
        medication_record = parse_medication(medications)
        allergy_record = parse_allergy(allergies)
        dietary_record = parse_dietary_need(dietary)
        medical_condition_record = parse_medical_condition(medical)
        if dietary:
            missing_fields.append("dietary needs review")
        if allergies:
            missing_fields.append("allergy details review")
        if medications or auto_injector:
            missing_fields.append("medication and auto-injector details review")
        if medical:
            missing_fields.append("medical conditions review")
        if send or ehcp:
            missing_fields.append("SEND information review")
        if auto_injector and not auto_injector_expiry:
            add_exception(exceptions, "missing_auto_injector_expiry", "parent_action", parent_id, child_id, child_name,
                          f"{auto_injector} has no expiry date in the export.",
                          "Parent must add the current auto-injector expiry date before booking")
        elif auto_injector and auto_injector_expiry < TODAY.isoformat():
            add_exception(exceptions, "expired_auto_injector", "parent_action", parent_id, child_id, child_name,
                          f"{auto_injector} expired on {auto_injector_expiry}.",
                          "Parent must confirm the replacement auto-injector and current expiry date before booking")
        flags = [
            f"Dietary: {dietary}" if dietary else "",
            f"Allergy: {allergies}" if allergies else "",
            f"Medication: {medications}" if medications else "",
            f"Auto-injector: {auto_injector}" if auto_injector else "",
            f"Medical: {medical}" if medical else "",
            f"SEND: {send}" if send else "",
        ]
        medical_notes = "\n".join(filter(None, [
            f"Medical conditions: {medical}" if medical else "",
            f"Medications: {medications}" if medications else "",
            f"Auto-injector: {auto_injector}; expiry: {auto_injector_expiry or 'not recorded'}" if auto_injector else "",
            f"SEND: {send}; EHCP: {ehcp or 'not recorded'}" if send or ehcp else "",
            f"Additional information: {additional}" if additional else "",
        ]))
        registration = {
            "gender": clean(row.get("Gender")),
            "ethnicity": clean(row.get("Ethnicity")),
            "languages": split_values(row.get("Languages")),
            "relationship": "",
            "livesWith": "",
            "parentalResponsibility": "",
            "collectionPassword": clean(row.get("Collection Password")),
            "religiousInfo": clean(row.get("Religious")),
            "additionalInfo": additional,
            "externalAgencies": split_values(row.get("External Agency")),
            "dietaryNeeds": [dietary_record] if dietary_record else [],
            "allergies": [allergy_record] if allergy_record else [],
            "medications": [medication_record] if medication_record else [],
            "autoInjectors": [{"type": auto_injector, "expiry": auto_injector_expiry}] if auto_injector else [],
            "medicalConditions": [medical_condition_record] if medical_condition_record else [],
            "send": [{"need": send, "ehcp": ehcp or "Not recorded", "details": additional}] if send or ehcp else [],
            "migration": {
                "requiresReview": True,
                "missingFields": missing_fields,
                "source": SOURCE_NAME,
                "batch": IMPORT_BATCH,
            },
        }
        payloads.append({
            "id": deterministic_uuid("child", child_id),
            "parent_account_id": parent_payload["id"],
            "full_name": child_name,
            "preferred_name": child_name.split()[0] if child_name else None,
            "date_of_birth": dob or None,
            "school_name": clean(row.get("School")) or None,
            "year_group": clean(row.get("Classroom")) or None,
            "medical_notes": medical_notes,
            "allergy_notes": allergies,
            "dietary_notes": dietary,
            "authorised_collectors": [],
            "consents": {
                "responses": {label: "N/A" for label in CHILD_CONSENT_ROWS},
                "registration": registration,
            },
            "flags": [flag for flag in flags if flag],
            "active": is_active,
            "external_source": SOURCE_NAME,
            "external_id": child_id,
            "migration_metadata": {
                "batch": IMPORT_BATCH,
                "requiresReview": True,
                "missingFields": missing_fields,
                "sourceParentId": parent_id,
                "sourceCentres": parse_centre_list(row.get("Centre")),
                "sourceBookingsMade": clean(row.get("Bookings Made")),
                "isFsm": truthy(row.get("Is FSM")),
                "isPupilPremium": truthy(row.get("Is Pupil Premium")),
            },
        })
    return payloads, children_by_parent, active_children_by_parent


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})


def main() -> None:
    parser = argparse.ArgumentParser(description="Create reviewed Magicbooking import payloads without database writes.")
    parser.add_argument("--parents", required=True, type=Path, help="Magicbooking parent export (.xlsx)")
    parser.add_argument("--children", required=True, type=Path, help="Magicbooking child export (.xlsx)")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for local dry-run artifacts")
    args = parser.parse_args()

    parent_hash_before = file_sha256(args.parents)
    child_hash_before = file_sha256(args.children)
    parent_rows = read_xlsx_rows(args.parents)
    child_rows = read_xlsx_rows(args.children)
    validate_columns(parent_rows, PARENT_COLUMNS, "Parent")
    validate_columns(child_rows, CHILD_COLUMNS, "Child")

    exceptions: list[dict[str, str]] = []
    parent_payloads, parent_source_by_id = build_parent_payloads(parent_rows, exceptions)
    parent_payload_by_external_id = {row["external_id"]: row for row in parent_payloads}
    child_payloads, children_by_parent, active_children_by_parent = build_child_payloads(
        child_rows, parent_payload_by_external_id, parent_source_by_id, exceptions
    )

    invite_rows = []
    for parent in parent_payloads:
        parent_id = parent["external_id"]
        active_count = active_children_by_parent[parent_id]
        child_count = children_by_parent[parent_id]
        status = "ready_for_sample_review" if active_count else "hold_no_active_children"
        if active_count and any(item["severity"] == "error" and item["external_parent_id"] == parent_id for item in exceptions):
            status = "hold_manual_review"
        invite_rows.append({
            "external_parent_id": parent_id,
            "parent_account_id": parent["id"],
            "email": parent["email"],
            "full_name": parent["full_name"],
            "registered_centres": " | ".join(parent["registered_centres"]),
            "child_count": child_count,
            "active_child_count": active_count,
            "missing_secondary_contact": "yes" if "second emergency contact number" in parent["migration_metadata"]["missingFields"] else "no",
            "activation_status": status,
        })

    parent_ids = [row["external_id"] for row in parent_payloads]
    child_ids = [row["external_id"] for row in child_payloads]
    if len(parent_ids) != len(set(parent_ids)):
        raise ValueError("Dry-run parent payload contains duplicate external IDs")
    if len(child_ids) != len(set(child_ids)):
        raise ValueError("Dry-run child payload contains duplicate external IDs")
    if any("Ethnicity" in row for row in parent_payloads):
        raise ValueError("Parent ethnicity must not be imported")
    if any(set(child["consents"]["responses"].values()) != {"N/A"} for child in child_payloads):
        raise ValueError("Fresh child consent responses must not be inferred from Magicbooking")
    if file_sha256(args.parents) != parent_hash_before or file_sha256(args.children) != child_hash_before:
        raise ValueError("A source export changed during the dry run")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output_dir / "parent_accounts.import.jsonl", parent_payloads)
    write_jsonl(args.output_dir / "child_profiles.import.jsonl", child_payloads)
    write_csv(args.output_dir / "parent_invite_cohort.csv", invite_rows, [
        "external_parent_id", "parent_account_id", "email", "full_name", "registered_centres",
        "child_count", "active_child_count", "missing_secondary_contact", "activation_status",
    ])
    write_csv(args.output_dir / "migration_exceptions.csv", exceptions, [
        "category", "severity", "external_parent_id", "external_child_id", "record_label", "detail", "recommended_action",
    ])

    severity_counts = Counter(row["severity"] for row in exceptions)
    category_counts = Counter(row["category"] for row in exceptions)
    summary = {
        "mode": "dry_run_only",
        "databaseWrites": 0,
        "emailsSent": 0,
        "source": SOURCE_NAME,
        "batch": IMPORT_BATCH,
        "sourceFiles": {
            "parents": {"path": str(args.parents), "sha256": parent_hash_before, "rows": len(parent_rows)},
            "children": {"path": str(args.children), "sha256": child_hash_before, "rows": len(child_rows)},
        },
        "payloads": {
            "parentAccounts": len(parent_payloads),
            "childProfiles": len(child_payloads),
            "childrenExcludedForUnmatchedParent": len([row for row in exceptions if row["category"] == "unmatched_parent"]),
        },
        "inviteCohort": dict(Counter(row["activation_status"] for row in invite_rows)),
        "exceptions": {"total": len(exceptions), "bySeverity": dict(severity_counts), "byCategory": dict(category_counts)},
        "safetyChecks": {
            "sourceFilesUnchanged": True,
            "uniqueParentExternalIds": True,
            "uniqueChildExternalIds": True,
            "parentEthnicityDiscarded": True,
            "freshConsentsNotInferred": True,
            "authorisedCollectorsNotDuplicatedPerChild": True,
        },
    }
    (args.output_dir / "migration_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "mode": "dry_run_only",
        "files": [
            "parent_accounts.import.jsonl",
            "child_profiles.import.jsonl",
            "parent_invite_cohort.csv",
            "migration_exceptions.csv",
            "migration_summary.json",
        ],
        "warning": "Review exceptions and sample accounts before applying the SQL migration or writing any payload to Supabase.",
    }
    (args.output_dir / "import_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps({
        "mode": "dry_run_only",
        "databaseWrites": 0,
        "emailsSent": 0,
        "outputDir": str(args.output_dir),
        "parentPayloads": len(parent_payloads),
        "childPayloads": len(child_payloads),
        "inviteCohort": summary["inviteCohort"],
        "exceptions": summary["exceptions"],
    }, indent=2))


if __name__ == "__main__":
    main()
