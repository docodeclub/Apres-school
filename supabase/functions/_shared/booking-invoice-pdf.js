const PAGE = { width: 595, height: 842, margin: 42 };
const BLUE = [0.19, 0.29, 0.72];
const NAVY = [0.15, 0.19, 0.31];
const ORANGE = [0.96, 0.59, 0.18];
const GREEN = [0.18, 0.49, 0.29];
const INK = [0.09, 0.11, 0.18];
const MUTED = [0.36, 0.39, 0.47];
const LINE = [0.85, 0.88, 0.96];
const SOFT = [0.96, 0.97, 1];
const PALE_GREEN = [0.92, 0.98, 0.95];
const WHITE = [1, 1, 1];

function clean(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E£]/g, "");
}

function escapePdf(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/£/g, "\\243");
}

function money(value, currency = "GBP") {
  const amount = Number(value || 0).toFixed(2);
  return String(currency).toUpperCase() === "GBP" ? `£${amount}` : `${String(currency).toUpperCase()} ${amount}`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "Europe/London",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "";
  if (/^\d{1,2}:\d{2}/.test(String(value))) return String(value).slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(date);
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "booking";
}

class PdfDoc {
  constructor(title) {
    this.title = clean(title);
    this.pages = [];
    this.current = null;
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
  }

  rgb(color) {
    return color.map((part) => Number(part).toFixed(3)).join(" ");
  }

  text(value, x, y, size = 10, color = INK, font = "F1") {
    this.current.push(`BT /${font} ${size} Tf ${this.rgb(color)} rg ${x.toFixed(2)} ${(PAGE.height - y).toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
  }

  bold(value, x, y, size = 10, color = INK) {
    this.text(value, x, y, size, color, "F2");
  }

  line(x1, y1, x2, y2, color = LINE, width = 1) {
    this.current.push(`${this.rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(PAGE.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE.height - y2).toFixed(2)} l S`);
  }

  rect(x, y, width, height, fill = null, stroke = LINE) {
    const parts = [];
    if (fill) parts.push(`${this.rgb(fill)} rg`);
    if (stroke) parts.push(`${this.rgb(stroke)} RG`);
    parts.push(`${x.toFixed(2)} ${(PAGE.height - y - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    parts.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.current.push(parts.join(" "));
  }

  measureLines(value, width, size = 10) {
    const maxChars = Math.max(8, Math.floor(width / (size * 0.52)));
    const words = clean(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  wrap(value, x, y, width, size = 10, color = INK, lineHeight = size * 1.3, font = "F1") {
    const lines = this.measureLines(value, width, size);
    lines.forEach((item, index) => this.text(item, x, y + index * lineHeight, size, color, font));
    return lines.length;
  }

  output() {
    const encoder = new TextEncoder();
    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };
    const font = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const bold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const pageIds = [];
    this.pages.forEach((page) => {
      const stream = page.join("\n");
      const content = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    const pages = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalog = addObject(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
    pageIds.forEach((id) => {
      objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pages} 0 R`);
    });
    let body = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(encoder.encode(body).length);
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = encoder.encode(body).length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Title (${escapePdf(this.title)}) >>\nstartxref\n${xref}\n%%EOF`;
    return encoder.encode(body);
  }
}

function normaliseLine(line = {}) {
  const date = line.date || line.startsAt || line.startTime;
  const start = formatTime(line.startTime || line.startsAt || line.date);
  const end = formatTime(line.endTime || line.endsAt);
  const quantity = Math.max(1, Number(line.quantity || 1));
  const unitAmount = Number(line.unitAmount ?? line.unit_amount ?? line.price ?? 0);
  const originalUnitAmount = Number(line.originalUnitAmount ?? line.original_unit_amount ?? unitAmount);
  const total = Number(line.total ?? line.lineTotal ?? line.line_total ?? quantity * unitAmount);
  const originalTotal = Number(line.originalTotal ?? line.original_line_total ?? quantity * originalUnitAmount);
  const discountTotal = Math.max(0, Number(line.discountTotal ?? line.discount_amount ?? originalTotal - total));
  const pricingLabel = clean(line.pricingLabel || line.pricing_label || "");
  const sessionName = clean(line.sessionName || line.sessionLabel || line.session_label || line.careType || "Care session");
  const siteName = clean(line.siteName || line.site_name || "");
  return {
    date: formatDate(date),
    time: [start, end].filter(Boolean).join("-") || "Time recorded in portal",
    child: clean(line.childName || line.child_name || "Child"),
    description: [sessionName, siteName].filter(Boolean).join(" | "),
    pricingNote: pricingLabel && discountTotal > 0
      ? `${pricingLabel}: ${money(originalTotal)} less ${money(discountTotal)}`
      : "",
    originalTotal,
    discountTotal,
    total,
  };
}

export function bookingInvoiceFilename(input = {}) {
  return `apres-school-invoice-${slug(input.invoiceNumber || input.bookingReference || "booking")}.pdf`;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function buildBookingInvoicePdf(input = {}) {
  const currency = input.currency || "GBP";
  const invoiceNumber = clean(input.invoiceNumber || input.bookingReference || "Booking invoice");
  const bookingReference = clean(input.bookingReference || invoiceNumber);
  const lines = (Array.isArray(input.lines) ? input.lines : []).map(normaliseLine);
  const total = Number(input.total || lines.reduce((sum, line) => sum + line.total, 0));
  const paid = Number(input.paid ?? Math.max(0, total - Number(input.balance || 0)));
  const balance = Number(input.balance ?? Math.max(0, total - paid));
  const gross = Number(input.grossTotal ?? (lines.reduce((sum, line) => sum + line.originalTotal, 0) || total));
  const discount = Number(input.discountTotal ?? Math.max(0, gross - total));
  const paymentMethod = clean(input.paymentMethod || "PonchoPay");
  const statusLabel = clean(input.statusLabel || (balance <= 0 ? "Paid" : "Payment arranged"));
  const pricingGroupName = clean(input.pricingGroupName || "Standard");
  const doc = new PdfDoc(`Après School invoice ${invoiceNumber}`);
  const tableWidths = [82, 67, 91, 201, 70];
  const pageWidth = PAGE.width - PAGE.margin * 2;
  const tableBottom = 744;
  const lineSize = 8.2;
  const lineHeight = 10.5;

  const addHeader = (continued = false) => {
    doc.addPage();
    doc.bold("Apres School", PAGE.margin, 40, 17, BLUE);
    doc.text("Let's Learn and Play", PAGE.margin, 58, 8, ORANGE);
    doc.bold("INVOICE", 430, 40, 20, BLUE);
    doc.text(invoiceNumber, 430, 62, 9.5, INK);
    if (continued) doc.text("Continued", 430, 77, 8, MUTED);
    doc.line(PAGE.margin, 92, PAGE.width - PAGE.margin, 92);
  };

  const renderTableHeader = (y) => {
    doc.rect(PAGE.margin, y, pageWidth, 28, SOFT, LINE);
    let x = PAGE.margin;
    ["Date", "Time", "Child", "Session", "Amount"].forEach((label, index) => {
      doc.bold(label.toUpperCase(), x + 7, y + 18, 7, MUTED);
      x += tableWidths[index];
    });
    return y + 28;
  };

  const rowHeightFor = (line) => {
    const descriptionLines = doc.measureLines(line.description, tableWidths[3] - 14, lineSize);
    const pricingLines = line.pricingNote ? doc.measureLines(line.pricingNote, tableWidths[3] - 14, 7.2) : [];
    const childLines = doc.measureLines(line.child, tableWidths[2] - 14, lineSize);
    return Math.max(40, Math.max(childLines.length * lineHeight, descriptionLines.length * lineHeight + pricingLines.length * 9) + 18);
  };

  const renderRow = (line, y) => {
    const height = rowHeightFor(line);
    doc.rect(PAGE.margin, y, pageWidth, height, WHITE, LINE);
    let x = PAGE.margin;
    [line.date, line.time, line.child].forEach((value, index) => {
      doc.wrap(value, x + 7, y + 16, tableWidths[index] - 14, lineSize, INK, lineHeight);
      x += tableWidths[index];
    });
    const descriptionLineCount = doc.wrap(line.description, x + 7, y + 16, tableWidths[3] - 14, lineSize, INK, lineHeight, "F2");
    if (line.pricingNote) {
      doc.wrap(line.pricingNote, x + 7, y + 16 + descriptionLineCount * lineHeight + 2, tableWidths[3] - 14, 7.2, MUTED, 9);
    }
    x += tableWidths[3];
    doc.bold(money(line.total, currency), x + 7, y + 16, lineSize, NAVY);
    return y + height;
  };

  addHeader(false);
  doc.bold("APRES SCHOOL LIMITED", PAGE.margin, 122, 10.5, INK);
  doc.text("Finance Email: hello@apres-school.co.uk", PAGE.margin, 139, 8.2, MUTED);
  doc.text("Website: www.apres-school.co.uk", PAGE.margin, 152, 8.2, MUTED);

  doc.rect(344, 116, 209, 124, WHITE, LINE);
  const metaRows = [
    ["Invoice date", formatDate(input.issueDate || new Date().toISOString())],
    ["Booking reference", bookingReference],
    ["Payment method", paymentMethod],
    ["Pricing group", pricingGroupName],
  ];
  metaRows.forEach(([label, value], index) => {
    const rowY = 134 + index * 27;
    doc.text(label.toUpperCase(), 360, rowY, 7.2, MUTED);
    doc.wrap(value, 360, rowY + 12, 170, 8.5, INK, 10.5);
  });

  doc.bold("Bill To", PAGE.margin, 252, 12, BLUE);
  doc.line(PAGE.margin, 262, 286, 262);
  doc.bold(clean(input.parentName || "Parent or carer"), PAGE.margin, 284, 10, BLUE);
  doc.text(clean(input.parentEmail || ""), PAGE.margin, 304, 8.6, MUTED);

  doc.bold("Summary", 344, 252, 12, BLUE);
  doc.line(344, 262, PAGE.width - PAGE.margin, 262);
  const summaryRows = [
    ["Standard price", money(gross, currency)],
    ["Discount", discount > 0 ? `-${money(discount, currency)}` : money(0, currency)],
    ["Invoice total", money(total, currency)],
    ["Paid", money(paid, currency)],
    ["Balance due", money(balance, currency)],
  ];
  summaryRows.forEach(([label, value], index) => {
    const rowY = 284 + index * 21;
    const highlighted = label === "Invoice total";
    if (highlighted) doc.rect(344, rowY - 14, 209, 25, PALE_GREEN, LINE);
    doc.text(label, 360, rowY, highlighted ? 8.8 : 8.2, highlighted ? INK : MUTED);
    doc.bold(value, 468, rowY, highlighted ? 11.5 : 9, highlighted ? GREEN : label === "Balance due" && balance > 0 ? ORANGE : INK);
  });

  doc.bold("Care Sessions", PAGE.margin, 390, 12.5, BLUE);
  let y = renderTableHeader(408);
  const rows = lines.length ? lines : [{
    date: "-",
    time: "-",
    child: "-",
    description: "Booking details are available in the parent portal",
    pricingNote: "",
    originalTotal: total,
    discountTotal: 0,
    total,
  }];
  rows.forEach((line) => {
    const height = rowHeightFor(line);
    if (y + height > 748) {
      addHeader(true);
      y = renderTableHeader(110);
    }
    y = renderRow(line, y);
  });

  const paymentPanelHeight = 130;
  if (y + paymentPanelHeight + 24 > tableBottom) {
    addHeader(true);
    y = 118;
  } else {
    y += 24;
  }
  doc.rect(PAGE.margin, y, pageWidth, paymentPanelHeight, SOFT, LINE);
  doc.bold(balance <= 0 ? "Payment Complete" : "Payment Summary", PAGE.margin + 18, y + 28, 14, BLUE);
  const paymentRows = [
    ["Payment method", paymentMethod],
    ["Status", statusLabel],
    ["Payment reference", clean(input.providerReference || bookingReference)],
  ];
  paymentRows.forEach(([label, value], index) => {
    const rowY = y + 57 + index * 22;
    doc.text(label, PAGE.margin + 18, rowY, 8, MUTED);
    doc.bold(value, PAGE.margin + 134, rowY, 9, INK);
  });
  doc.rect(PAGE.width - PAGE.margin - 170, y + 28, 150, 78, WHITE, LINE);
  doc.text(balance <= 0 ? "Paid" : "Balance Due", PAGE.width - PAGE.margin - 150, y + 53, 8.4, MUTED);
  doc.bold(money(balance <= 0 ? paid : balance, currency), PAGE.width - PAGE.margin - 150, y + 83, 18, balance <= 0 ? GREEN : ORANGE);

  doc.pages.forEach((page, index) => {
    const current = doc.current;
    doc.current = page;
    doc.line(PAGE.margin, 786, PAGE.width - PAGE.margin, 786, LINE);
    doc.text("Finance contact: hello@apres-school.co.uk | www.apres-school.co.uk", PAGE.margin, 808, 8, MUTED);
    doc.text(`Page ${index + 1} of ${doc.pages.length}`, 500, 808, 8, MUTED);
    doc.current = current;
  });

  return doc.output();
}
