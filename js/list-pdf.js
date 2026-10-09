// ============================================================================
// PDF SPISKOVI — izvoz liste dobavljača / korisnika za štampu
// Isti pouzdani pristup kao order-print.js i import-export.js: jsPDF native
// API (font registrovan preko addFileToVFS/addFont, tekst crtan sa pdf.text()
// na mm koordinatama) — nikad rasterizacija, pa srpski dijakritici (č/ć/š/ž/đ)
// ostaju ispravni i tekst ostaje selektabilan/pretraživ.
// ============================================================================
import { formatDate } from "./utils.js";
import { t, currentLang } from "./i18n.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function getJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  return window.jspdf.jsPDF;
}

const REPORT_FONT = "DejaVuSans";

async function registerFont(pdf) {
  const { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } = await import("./fonts-dejavu.js");
  pdf.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_REGULAR_B64);
  pdf.addFileToVFS("DejaVuSans-Bold.ttf", DEJAVU_SANS_BOLD_B64);
  pdf.addFont("DejaVuSans.ttf", REPORT_FONT, "normal");
  pdf.addFont("DejaVuSans-Bold.ttf", REPORT_FONT, "bold");
  pdf.setFont(REPORT_FONT, "normal");
}

// ── LAYOUT KONSTANTE (A4 portrait, mm) ─────────────────────────
const M  = 15;   // margina
const PW = 180;  // širina sadržaja (210 - 2*15)
const PH = 277;  // iskoristiva visina stranice

function checkPageBreak(pdf, y, needed = 10) {
  if (y + needed > PH) {
    pdf.addPage();
    return M + 10;
  }
  return y;
}

function drawPageNumbers(pdf) {
  const pageCount = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(`${t("pdf_page_label")} ${p}/${pageCount}`, M + PW, PH + 10, { align: "right" });
  }
}

function drawFooter(pdf) {
  const pageCount = pdf.internal.getNumberOfPages();
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  const generatedAt = new Date().toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(150);
    pdf.text(`${t("pdf_generated_footer")} — ${generatedAt}`, M, PH + 10);
  }
}

// ── ZAGLAVLJE FIRME + NASLOV LISTE ─────────────────────────────
function drawHeader(pdf, company, title, count) {
  let y = M;
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(26, 29, 33);
  pdf.text(company?.name || t("company_generic"), M, y);
  y += 6;

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(85);
  const pibLine = [
    company?.pib ? `${t("pib_label")}: ${company.pib}` : null,
    company?.maticniBroj ? `${t("company_id_label")}: ${company.maticniBroj}` : null,
  ].filter(Boolean).join("   ·   ");
  if (pibLine) { pdf.text(pibLine, M, y); y += 4.5; }

  y += 2;
  pdf.setDrawColor(26, 29, 33);
  pdf.setLineWidth(0.6);
  pdf.line(M, y, M + PW, y);
  y += 9;

  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(26, 29, 33);
  pdf.text(title, M, y);

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(85);
  pdf.text(`${t("pdf_total_count_label")}: ${count}`, M + PW, y - 4, { align: "right" });
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  const dateStr = new Date().toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  pdf.text(`${t("pdf_generated_on_label")}: ${dateStr}`, M + PW, y, { align: "right" });

  return y + 10;
}

// ── GENERIČKA TABELA (za korisnike) ─────────────────────────────
function drawTableHeader(pdf, cols, y) {
  y = checkPageBreak(pdf, y, 9);
  pdf.setFillColor(243, 245, 248);
  pdf.rect(M, y - 4, PW, 7, "F");
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(26, 29, 33);
  let x = M;
  cols.forEach(([label, width]) => {
    pdf.text(label, x + 2, y);
    x += width;
  });
  return y + 6;
}

function drawTableRowWrapped(pdf, cols, values, y, shade = false) {
  const lineH = 4.2;
  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(8.5);
  const wrapped = cols.map(([, width], i) => pdf.splitTextToSize(String(values[i] ?? "—"), width - 4));
  const maxLines = Math.max(1, ...wrapped.map((w) => w.length));
  const rowHeight = maxLines * lineH + 2;

  y = checkPageBreak(pdf, y, rowHeight + 2);
  if (shade) {
    pdf.setFillColor(250, 251, 252);
    pdf.rect(M, y - 3.5, PW, rowHeight, "F");
  }

  pdf.setTextColor(40);
  let x = M;
  cols.forEach(([, width], i) => {
    let ly = y;
    wrapped[i].forEach((line) => { pdf.text(line, x + 2, ly); ly += lineH; });
    x += width;
  });

  return y + rowHeight;
}

// ── KORISNICI ────────────────────────────────────────────────────
// company: dokument firme (name, pib, maticniBroj)
// users: već sortiran niz korisnika koji treba prikazati u datom redosledu
export async function generateUsersPdf({ company, users, roleLabelFn }) {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerFont(pdf);

  let y = drawHeader(pdf, company, t("users_pdf_title"), users.length);

  const cols = [
    [t("full_name_short"), 45],
    ["Email", 55],
    [t("role_label"), 30],
    [t("status"), 25],
    [t("created_date_label"), 25],
  ];
  y = drawTableHeader(pdf, cols, y);
  users.forEach((u, i) => {
    y = drawTableRowWrapped(pdf, cols, [
      u.name || "—",
      u.email || "—",
      roleLabelFn ? roleLabelFn(u.role) : (u.role || "—"),
      u.active === false ? t("inactive") : t("active"),
      u.createdAt ? formatDate(u.createdAt) : "—",
    ], y, i % 2 === 0);
  });

  drawPageNumbers(pdf);
  drawFooter(pdf);
  pdf.save(`${t("users_pdf_title").toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

// ── DOBAVLJAČI ───────────────────────────────────────────────────
// Svaki dobavljač se prikazuje kao zaseban blok (naziv + podaci + sve unete
// lokacije preuzimanja), jer tabela sa fiksnim kolonama ne bi lepo primila
// promenljiv broj lokacija po dobavljaču.
// suppliers: već sortiran niz dobavljača
// locationsBySupplierId: { [supplierId]: [{ name, address }, ...] }
function drawKeyValueRow(pdf, pairs, y) {
  // pairs: [[label, value], [label, value]] — do dva u redu, poravnata u dve kolone
  const colW = PW / 2;
  pdf.setFontSize(9);
  const lineH = 4.6;
  let maxLines = 1;
  const wrapped = pairs.map(([label, value]) => {
    if (!label) return null;
    const text = `${label}: ${value || "—"}`;
    const lines = pdf.setFont(REPORT_FONT, "normal") && pdf.splitTextToSize(text, colW - 4);
    maxLines = Math.max(maxLines, lines.length);
    return lines;
  });
  y = checkPageBreak(pdf, y, maxLines * lineH + 2);
  wrapped.forEach((lines, i) => {
    if (!lines) return;
    let ly = y;
    pdf.setTextColor(50);
    lines.forEach((line) => { pdf.text(line, M + i * colW, ly); ly += lineH; });
  });
  return y + maxLines * lineH;
}

function drawFullWidthRow(pdf, label, value, y) {
  if (!value) return y;
  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9);
  const lines = pdf.splitTextToSize(`${label}: ${value}`, PW);
  y = checkPageBreak(pdf, y, lines.length * 4.6 + 2);
  pdf.setTextColor(50);
  lines.forEach((line) => { pdf.text(line, M, y); y += 4.6; });
  return y;
}

function drawSupplierBlock(pdf, supplier, locations, y) {
  y = checkPageBreak(pdf, y, 26);

  // Traka sa nazivom + PIB
  pdf.setFillColor(243, 245, 248);
  pdf.rect(M, y - 4.5, PW, 8, "F");
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(26, 29, 33);
  pdf.text(supplier.name || "—", M + 2, y);
  if (supplier.pib) {
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(85);
    pdf.text(`${t("pib_label")}: ${supplier.pib}`, M + PW - 2, y, { align: "right" });
  }
  y += 8;

  y = drawKeyValueRow(pdf, [
    [t("company_id_label"), supplier.maticniBroj],
    [t("contact_person_label"), supplier.contact],
  ], y);
  y = drawKeyValueRow(pdf, [
    [t("phone_label"), supplier.phone],
    ["Email", supplier.email],
  ], y);
  y = drawKeyValueRow(pdf, [
    [t("bank_account_label"), supplier.bankAccount],
    [t("working_hours_label"), supplier.workingHours],
  ], y);
  y = drawFullWidthRow(pdf, t("address_label"), supplier.address, y);
  y = drawFullWidthRow(pdf, t("note_label"), supplier.note, y);

  y += 1.5;
  y = checkPageBreak(pdf, y, 10);
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(26, 29, 33);
  pdf.text(`📍 ${t("pdf_pickup_locations_label")} (${locations.length})`, M, y);
  y += 5;

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(8.7);
  if (!locations.length) {
    y = checkPageBreak(pdf, y, 6);
    pdf.setTextColor(140);
    pdf.text(t("pdf_no_locations_line"), M + 3, y);
    y += 5;
  } else {
    locations.forEach((l) => {
      const text = l.address ? `${l.name} — ${l.address}` : l.name;
      const lines = pdf.splitTextToSize(`•  ${text}`, PW - 3);
      y = checkPageBreak(pdf, y, lines.length * 4.3 + 1);
      pdf.setTextColor(50);
      lines.forEach((line) => { pdf.text(line, M + 3, y); y += 4.3; });
    });
    y += 1;
  }

  y += 3;
  pdf.setDrawColor(216, 221, 227);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, M + PW, y);
  return y + 8;
}

// company: dokument firme (name, pib, maticniBroj)
// suppliers: već sortiran niz dobavljača koji treba prikazati u datom redosledu
// locationsBySupplierId: mapa { supplierId: [{ name, address }] } — sve lokacije preuzimanja
export async function generateSuppliersPdf({ company, suppliers, locationsBySupplierId = {} }) {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerFont(pdf);

  let y = drawHeader(pdf, company, t("suppliers_pdf_title"), suppliers.length);

  suppliers.forEach((s) => {
    y = drawSupplierBlock(pdf, s, locationsBySupplierId[s.id] || [], y);
  });

  drawPageNumbers(pdf);
  drawFooter(pdf);
  pdf.save(`${t("suppliers_pdf_title").toLowerCase().replace(/\s+/g, "-")}.pdf`);
}
