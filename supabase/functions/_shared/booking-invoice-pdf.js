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
  return {
    date: formatDate(date),
    time: [start, end].filter(Boolean).join("-") || "Time recorded in portal",
    child: clean(line.childName || line.child_name || "Child"),
    description: clean([
      line.sessionName || line.sessionLabel || line.session_label || line.careType || "Care session",
      line.siteName || line.site_name,
    ].filter(Boolean).join(" · ")),
    total: Number(line.total ?? line.lineTotal ?? line.line_total ?? quantity * unitAmount),
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
  const doc = new PdfDoc(`Après School invoice ${invoiceNumber}`);
  const tableWidths = [94, 70, 100, 185, 62];
  const pageWidth = PAGE.width - PAGE.margin * 2;

  const addHeader = (continued = false) => {
    doc.addPage();
    doc.rect(0, 0, PAGE.width, 78, BLUE, null);
    doc.bold("Apres School", PAGE.margin, 34, 20, WHITE);
    doc.text("Let's Learn and Play", PAGE.margin, 53, 8.5, ORANGE);
    doc.bold("INVOICE", 430, 34, 20, WHITE);
    doc.text(invoiceNumber, 430, 54, 9, WHITE);
    if (continued) doc.text("Continued", 430, 68, 8, WHITE);
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

  const renderRow = (line, y) => {
    const descriptionLines = doc.measureLines(line.description, tableWidths[3] - 14, 8);
    const childLines = doc.measureLines(line.child, tableWidths[2] - 14, 8);
    const height = Math.max(38, Math.max(descriptionLines.length, childLines.length) * 10 + 18);
    doc.rect(PAGE.margin, y, pageWidth, height, WHITE, LINE);
    let x = PAGE.margin;
    [line.date, line.time, line.child, line.description, money(line.total, currency)].forEach((value, index) => {
      doc.wrap(value, x + 7, y + 16, tableWidths[index] - 14, 8, index === 4 ? NAVY : INK, 10, index === 4 ? "F2" : "F1");
      x += tableWidths[index];
    });
    return y + height;
  };

  addHeader(false);
  doc.bold("Billed to", PAGE.margin, 112, 10, BLUE);
  doc.bold(clean(input.parentName || "Parent or carer"), PAGE.margin, 133, 11, INK);
  doc.text(clean(input.parentEmail || ""), PAGE.margin, 151, 8.5, MUTED);
  doc.bold("Invoice details", 340, 112, 10, BLUE);
  doc.text(`Issued: ${formatDate(input.issueDate || new Date().toISOString())}`, 340, 133, 8.5, MUTED);
  doc.text(`Booking reference: ${bookingReference}`, 340, 151, 8.5, MUTED);

  doc.rect(PAGE.margin, 178, pageWidth, 96, PALE_GREEN, LINE);
  const summaries = [
    ["TOTAL", money(total, currency)],
    ["PAID", money(paid, currency)],
    ["BALANCE", money(balance, currency)],
    ["STATUS", clean(input.statusLabel || (balance <= 0 ? "Paid" : "Payment arranged"))],
  ];
  summaries.forEach(([label, value], index) => {
    const x = PAGE.margin + 16 + index * 124;
    doc.text(label, x, 203, 7.2, MUTED);
    doc.bold(value, x, 232, index === 3 ? 11 : 16, index === 2 && balance > 0 ? ORANGE : GREEN);
  });
  doc.text(`Payment: ${clean(input.paymentMethod || "PonchoPay")}`, PAGE.margin + 16, 257, 8, MUTED);
  if (input.providerReference) doc.text(`Payment reference: ${clean(input.providerReference)}`, 300, 257, 8, MUTED);

  doc.bold("Booked care", PAGE.margin, 306, 12, BLUE);
  let y = renderTableHeader(322);
  const rows = lines.length ? lines : [{ date: "-", time: "-", child: "-", description: "Booking details are available in the parent portal", total }];
  rows.forEach((line) => {
    const height = Math.max(38, Math.max(doc.measureLines(line.description, tableWidths[3] - 14, 8).length, doc.measureLines(line.child, tableWidths[2] - 14, 8).length) * 10 + 18);
    if (y + height > 748) {
      addHeader(true);
      y = renderTableHeader(110);
    }
    y = renderRow(line, y);
  });

  doc.pages.forEach((page, index) => {
    const current = doc.current;
    doc.current = page;
    doc.line(PAGE.margin, 786, PAGE.width - PAGE.margin, 786, LINE);
    doc.text("Apres School | hello@apres-school.co.uk | www.apres-school.co.uk", PAGE.margin, 808, 8, MUTED);
    doc.text(`Page ${index + 1} of ${doc.pages.length}`, 500, 808, 8, MUTED);
    doc.current = current;
  });

  return doc.output();
}
