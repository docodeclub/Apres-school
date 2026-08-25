#!/usr/bin/env python3
"""Split a two-per-A4 payroll PDF into confidential individual payslips."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import pdfplumber
from brand_payslip import grouped_rows, parse_standard_payslip_content, render_branded_payslip, row_text


def safe_name(value: str) -> str:
    value = " ".join(value.split()).strip(" .")
    value = re.sub(r"[^A-Za-z0-9 .'-]+", "-", value)
    return value or "Unknown employee"


def payslip_sections(page) -> list[tuple[float, float]]:
    words = page.extract_words(x_tolerance=1, y_tolerance=2)
    headers = sorted(float(word["top"]) for word in words if word["text"].strip().lower() == "ref.")
    if not headers:
        return []
    first_header = headers[0]
    offsets = [header - first_header for header in headers]
    return [(offset, offsets[index + 1] if index + 1 < len(offsets) else float(page.height)) for index, offset in enumerate(offsets)]


def section_words(page, offset: float, upper_bound: float) -> list[dict]:
    result = []
    for source in page.extract_words(x_tolerance=1, y_tolerance=2):
        top = float(source["top"])
        if not offset <= top < upper_bound:
            continue
        word = dict(source)
        word["top"] = top - offset
        word["bottom"] = float(source["bottom"]) - offset
        result.append(word)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []

    with pdfplumber.open(args.input) as document:
        for page_number, page in enumerate(document.pages, 1):
            for section_number, (offset, upper_bound) in enumerate(payslip_sections(page), 1):
                words = section_words(page, offset, upper_bound)
                text = "\n".join(row_text(row) for row in grouped_rows(words))
                if "Employee Name" not in text or "Net Pay" not in text:
                    continue
                source_name = f"{args.input.name} - page {page_number} payslip {section_number}"
                data = parse_standard_payslip_content(words, text, source_name)
                final_path = args.output_dir / f"{safe_name(data.employee_name)}.pdf"
                if final_path.exists():
                    raise ValueError(f"Duplicate employee payslip name: {data.employee_name}")
                render_branded_payslip(data, final_path)
                created.append(final_path)
                print(final_path.name)

    if not created:
        raise ValueError("No payslips were found in the source PDF")
    print(f"Created {len(created)} individual payslips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
