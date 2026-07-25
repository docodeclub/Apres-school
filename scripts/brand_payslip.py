#!/usr/bin/env python3
"""Convert a standard payroll PDF into an Après School branded payslip."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import pdfplumber
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A5, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


NAVY = HexColor("#25304f")
BLUE = HexColor("#314bb8")
ORANGE = HexColor("#f4aa3d")
INK = HexColor("#182033")
MUTED = HexColor("#66708a")
LINE = HexColor("#dbe5ff")
SOFT = HexColor("#f4f6ff")
PALE = HexColor("#eef3ff")
WHITE = HexColor("#ffffff")
GREEN = HexColor("#267a52")


@dataclass
class PayLine:
    label: str
    units: str = ""
    rate: str = ""
    amount: str = ""


@dataclass
class PayslipData:
    employee_ref: str
    employee_name: str
    process_date: str
    ni_number: str
    employer_name: str
    payments: list[PayLine]
    deductions: list[PayLine]
    details: list[PayLine]
    this_period: list[PayLine]
    year_to_date: list[PayLine]
    net_pay: str
    source_filename: str


def clean_text(value: str) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split())


def grouped_rows(words: Iterable[dict], tolerance: float = 2.2) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        if not rows or abs(float(word["top"]) - sum(float(item["top"]) for item in rows[-1]) / len(rows[-1])) > tolerance:
            rows.append([word])
        else:
            rows[-1].append(word)
    return [sorted(row, key=lambda item: float(item["x0"])) for row in rows]


def row_text(words: Iterable[dict]) -> str:
    return clean_text(" ".join(str(word["text"]) for word in sorted(words, key=lambda item: float(item["x0"]))))


def zone(words: list[dict], x0: float, x1: float, top: float, bottom: float) -> list[dict]:
    return [
        word
        for word in words
        if x0 <= float(word["x0"]) < x1 and top <= float(word["top"]) < bottom
    ]


def value_rows(words: list[dict], x0: float, x1: float, top: float, bottom: float, split_x: float) -> list[PayLine]:
    result: list[PayLine] = []
    for row in grouped_rows(zone(words, x0, x1, top, bottom)):
        label = row_text(word for word in row if float(word["x0"]) < split_x)
        amount = row_text(word for word in row if float(word["x0"]) >= split_x)
        if label and amount:
            result.append(PayLine(label=label, amount=amount))
    return result


def parse_standard_payslip(path: Path) -> PayslipData:
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) != 1:
            raise ValueError("Only single-page standard payroll payslips can be branded automatically")
        page = pdf.pages[0]
        if abs(page.width - 595) > 8 or abs(page.height - 842) > 8:
            raise ValueError("This is not the standard portrait payroll payslip layout")
        words = page.extract_words(x_tolerance=1, y_tolerance=2)
        text = page.extract_text() or ""

    required = ("Employee Name", "Process Date", "Total Gross Pay", "Net Pay")
    if not all(label in text for label in required):
        raise ValueError("This PDF is not a standard payroll payslip")

    header_values = grouped_rows(zone(words, 0, 595, 27, 48))
    if not header_values:
        raise ValueError("Employee details could not be read")
    values = max(header_values, key=len)
    employee_ref = row_text(word for word in values if float(word["x0"]) < 75)
    employee_name = row_text(word for word in values if 75 <= float(word["x0"]) < 345)
    process_date = row_text(word for word in values if 345 <= float(word["x0"]) < 435)
    ni_number = row_text(word for word in values if float(word["x0"]) >= 435)
    if not employee_name or not re.fullmatch(r"\d{2}/\d{2}/20\d{2}", process_date):
        raise ValueError("Employee name or process date could not be read")

    payments: list[PayLine] = []
    for row in grouped_rows(zone(words, 12, 340, 58, 240)):
        label = row_text(word for word in row if float(word["x0"]) < 145)
        units = row_text(word for word in row if 145 <= float(word["x0"]) < 205)
        rate = row_text(word for word in row if 205 <= float(word["x0"]) < 275)
        amount = row_text(word for word in row if float(word["x0"]) >= 275)
        if label and amount:
            payments.append(PayLine(label=label, units=units, rate=rate, amount=amount))

    deductions: list[PayLine] = []
    for row in grouped_rows(zone(words, 345, 590, 58, 240)):
        label = row_text(word for word in row if float(word["x0"]) < 510)
        amount = row_text(word for word in row if float(word["x0"]) >= 510)
        if label and amount:
            deductions.append(PayLine(label=label, amount=amount))

    details_zone = grouped_rows(zone(words, 12, 240, 248, 345))
    employer_name = ""
    details: list[PayLine] = []
    for row in details_zone:
        text_value = row_text(row)
        if not employer_name and ":" not in text_value:
            employer_name = text_value
            continue
        label_words = [word for word in row if float(word["x0"]) < 112]
        value_words = [word for word in row if float(word["x0"]) >= 112]
        label = row_text(label_words).rstrip(":")
        amount = row_text(value_words)
        if label:
            details.append(PayLine(label=label, amount=amount))

    this_period = value_rows(words, 240, 408, 255, 345, 335)
    year_to_date = value_rows(words, 408, 590, 255, 345, 510)
    net_match = re.search(r"Net\s+Pay\s+(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
    if not net_match:
        raise ValueError("Net pay could not be read")

    if not any(item.label.lower() == "total gross pay" for item in this_period):
        raise ValueError("Total gross pay could not be read")

    return PayslipData(
        employee_ref=employee_ref,
        employee_name=employee_name,
        process_date=process_date,
        ni_number=ni_number,
        employer_name=employer_name or "APRÈS School Limited",
        payments=payments,
        deductions=deductions,
        details=details,
        this_period=this_period,
        year_to_date=year_to_date,
        net_pay=net_match.group(1),
        source_filename=path.name,
    )


def money_text(value: str) -> str:
    value = clean_text(value)
    return value if value.startswith("£") else f"£{value}"


def fit_text(canvas: Canvas, value: str, x: float, y: float, max_width: float, font: str, size: float, colour=INK) -> None:
    text = clean_text(value)
    while size > 6.5 and stringWidth(text, font, size) > max_width:
        size -= 0.25
    canvas.setFont(font, size)
    canvas.setFillColor(colour)
    canvas.drawString(x, y, text)


def rounded_box(canvas: Canvas, x: float, y: float, width: float, height: float, fill, stroke=LINE, radius: float = 12) -> None:
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.setLineWidth(0.8)
    canvas.roundRect(x, y, width, height, radius, stroke=1, fill=1)


def section_heading(canvas: Canvas, title: str, x: float, y: float, width: float) -> None:
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(x, y, title)
    canvas.setStrokeColor(ORANGE)
    canvas.setLineWidth(2)
    canvas.line(x, y - 7, x + width, y - 7)


def detail_grid(canvas: Canvas, rows: list[PayLine], x: float, y: float, width: float, row_height: float = 23) -> float:
    compact = row_height <= 16
    label_size = 6.8 if compact else 8.4
    value_size = 7.1 if compact else 8.7
    baseline_offset = 7.5 if compact else 10
    for index, item in enumerate(rows):
        row_y = y - index * row_height
        if index % 2 == 0:
            canvas.setFillColor(SOFT)
            canvas.rect(x, row_y - row_height + 3, width, row_height, stroke=0, fill=1)
        fit_text(canvas, item.label, x + 7, row_y - baseline_offset, width * 0.62, "Helvetica", label_size, MUTED)
        value = money_text(item.amount) if re.fullmatch(r"-?[\d,]+\.\d{2}", item.amount or "") else item.amount or "-"
        canvas.setFont("Helvetica-Bold", value_size)
        canvas.setFillColor(INK)
        canvas.drawRightString(x + width - 7, row_y - baseline_offset, value)
    return y - len(rows) * row_height


def pay_table(canvas: Canvas, title: str, rows: list[PayLine], x: float, y: float, width: float, show_units: bool, compact: bool = False) -> float:
    section_heading(canvas, title, x, y, width)
    header_y = y - (21 if compact else 31)
    canvas.setFillColor(SOFT)
    canvas.roundRect(x, header_y - (13 if compact else 16), width, 19 if compact else 24, 7, stroke=0, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Bold", 6.2 if compact else 7)
    canvas.drawString(x + 8, header_y - (7 if compact else 7), "DESCRIPTION")
    if show_units:
        canvas.drawRightString(x + width - 104, header_y - 7, "UNITS")
        canvas.drawRightString(x + width - 55, header_y - 7, "RATE")
    canvas.drawRightString(x + width - 8, header_y - 7, "AMOUNT")
    row_y = header_y - (25 if compact else 35)
    row_step = 17 if compact else 25
    for item in rows:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(x, row_y - 6, x + width, row_y - 6)
        fit_text(canvas, item.label, x + 8, row_y, width - (132 if show_units else 75), "Helvetica", 7.1 if compact else 8.5)
        if show_units:
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 6.9 if compact else 8.2)
            canvas.drawRightString(x + width - 104, row_y, item.units or "-")
            canvas.drawRightString(x + width - 55, row_y, item.rate or "-")
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 7.1 if compact else 8.5)
        canvas.drawRightString(x + width - 8, row_y, money_text(item.amount))
        row_y -= row_step
    if not rows:
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.1 if compact else 8.5)
        canvas.drawString(x + 8, row_y, "No entries")
        row_y -= row_step
    return row_y


def render_branded_payslip(data: PayslipData, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    page_size = landscape(A5)
    width, height = page_size
    canvas = Canvas(str(output_path), pagesize=page_size, pageCompression=1)
    canvas.setTitle(f"Après School payslip - {data.employee_name} - {data.process_date}")
    canvas.setAuthor("Après School Limited")
    canvas.setSubject("Confidential employee payslip")

    canvas.setFillColor(PALE)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.roundRect(14, 12, width - 28, height - 24, 14, stroke=0, fill=1)

    fit_text(canvas, "Après School", 30, height - 42, 230, "Helvetica-Bold", 21, BLUE)
    canvas.setFont("Helvetica-Bold", 6.8)
    canvas.setFillColor(ORANGE)
    canvas.drawString(31, height - 56, "LET'S LEARN AND PLAY")
    canvas.setFillColor(SOFT)
    canvas.roundRect(width - 127, height - 56, 97, 26, 13, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawCentredString(width - 78.5, height - 47, "PAYSLIP")
    canvas.setFillColor(ORANGE)
    canvas.rect(14, height - 72, width - 28, 4, stroke=0, fill=1)

    top = height - 91
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 13)
    canvas.drawString(30, top, "Your pay statement")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(30, top - 13, f"Processed {data.process_date}  |  {data.employer_name}")

    rounded_box(canvas, width - 178, top - 36, 148, 43, NAVY, NAVY, 10)
    canvas.setFillColor(ORANGE)
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.drawString(width - 164, top - 8, "NET PAY")
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 16)
    canvas.drawRightString(width - 43, top - 27, money_text(data.net_pay))

    card_y = top - 79
    rounded_box(canvas, 30, card_y, width - 60, 33, SOFT, LINE, 8)
    fields = [
        ("EMPLOYEE", data.employee_name),
        ("REFERENCE", data.employee_ref),
        ("PROCESS DATE", data.process_date),
        ("NI NUMBER", data.ni_number),
    ]
    cell_width = (width - 76) / 4
    for index, (label, value) in enumerate(fields):
        x = 38 + index * cell_width
        canvas.setFillColor(BLUE)
        canvas.setFont("Helvetica-Bold", 5.8)
        canvas.drawString(x, card_y + 21, label)
        fit_text(canvas, value or "-", x, card_y + 8, cell_width - 10, "Helvetica-Bold", 7.6, INK)

    tables_top = card_y - 18
    left_x = 30
    gap = 14
    table_width = (width - 60 - gap) / 2
    payments_bottom = pay_table(canvas, "Payments", data.payments, left_x, tables_top, table_width, True, compact=True)
    deductions_bottom = pay_table(canvas, "Deductions", data.deductions, left_x + table_width + gap, tables_top, table_width, False, compact=True)
    detail_top = min(payments_bottom, deductions_bottom) + 2

    lower_gap = 10
    lower_width = (width - 60 - lower_gap * 2) / 3
    section_heading(canvas, "Payroll details", left_x, detail_top, lower_width)
    section_heading(canvas, "This period", left_x + lower_width + lower_gap, detail_top, lower_width)
    section_heading(canvas, "Year to date", left_x + (lower_width + lower_gap) * 2, detail_top, lower_width)
    lower_y = detail_top - 16
    payroll_details = [item for item in data.details if item.label]
    detail_grid(canvas, payroll_details, left_x, lower_y, lower_width, row_height=10.5)
    detail_grid(canvas, data.this_period, left_x + lower_width + lower_gap, lower_y, lower_width, row_height=10.5)
    detail_grid(canvas, data.year_to_date, left_x + (lower_width + lower_gap) * 2, lower_y, lower_width, row_height=10.5)

    footer_y = 12
    footer_height = 24
    canvas.setFillColor(NAVY)
    canvas.rect(14, footer_y, width - 28, footer_height, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 5.7)
    canvas.drawString(28, footer_y + 14.5, "APRÈS SCHOOL LIMITED  |  Company No. 14934898")
    canvas.drawRightString(width - 28, footer_y + 14.5, "PRIVATE & CONFIDENTIAL")
    canvas.setFillColor(HexColor("#dbe5ff"))
    canvas.setFont("Helvetica", 4.9)
    canvas.drawString(
        28,
        footer_y + 5.5,
        "Registered office: 24 Cherry Orchard Road, Bromley, Kent, BR2 8NE  |  hello@apres-school.co.uk  |  www.apres-school.co.uk",
    )

    canvas.showPage()
    canvas.save()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Source payroll PDF")
    parser.add_argument("output", type=Path, nargs="?", help="Branded output PDF")
    parser.add_argument("--json", action="store_true", help="Print extracted data as JSON")
    args = parser.parse_args()

    data = parse_standard_payslip(args.input)
    if args.json:
        print(json.dumps(asdict(data), indent=2, ensure_ascii=False))
    if args.output:
        render_branded_payslip(data, args.output)
        print(f"Created {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
