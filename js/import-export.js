// ============================================================================
// UVOZ / IZVOZ — Poglavlje 12
// Uvoz: CSV i Excel za katalog proizvoda, dobavljače, korisnike
// Izvoz: PDF, Excel, CSV
// Koristi lagane CDN biblioteke (PapaParse, SheetJS, jsPDF) — bez build alata.
// ============================================================================
import { t } from "./i18n.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureLibs() {
  await Promise.all([
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"),
  ]);
}

async function getJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  return window.jspdf.jsPDF;
}

// --- UVOZ ---
// file: File objekat (.csv ili .xlsx). Vraća niz objekata (redova) sa ključevima iz header-a.
export async function importFile(file) {
  await ensureLibs();
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  if (isCsv) {
    const text = await file.text();
    // eslint-disable-next-line no-undef
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    return parsed.data;
  }
  const buf = await file.arrayBuffer();
  // eslint-disable-next-line no-undef
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // eslint-disable-next-line no-undef
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// --- IZVOZ CSV ---
export function exportCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")].concat(
    rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))
  );
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

// --- IZVOZ EXCEL ---
export async function exportExcel(filename, rows, sheetName = "Podaci") {
  await ensureLibs();
  // eslint-disable-next-line no-undef
  const ws = XLSX.utils.json_to_sheet(rows);
  // eslint-disable-next-line no-undef
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line no-undef
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  // eslint-disable-next-line no-undef
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// --- IZVOZ PDF (tabela) ---
// PDF se crta direktno kroz jsPDF native API (font registrovan preko
// addFileToVFS/addFont, tekst ispisan sa pdf.text() na mm koordinatama) — isti
// pouzdan pristup kao reports.js i order-print.js. Ranija verzija je koristila
// jsPDF .html() + html2canvas (rasterizacija HTML-a preko slike u canvasu),
// ali html2canvas ume da pogrešno izmeri ili potpuno izgubi glifove iz custom
// TTF fonta za srpske dijakritike (č/ć/š/ž/đ). Native crtanje teksta nikad ne
// rasterizuje sadržaj, pa ovog problema nema — usput otpada i zavisnost od
// html2canvas biblioteke (više se ne učitava).
const REPORT_FONT = "DejaVuSans";
const M  = 15;   // margina
const PW = 180;  // širina sadržaja (A4 210 - 2*15)
const PH = 277;  // iskoristiva visina stranice

// Font se učitava dinamički (lazy) — fajl je ~2MB base64, ne opterećuje
// običan prikaz stranice.
async function registerFont(pdf) {
  const { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } = await import("./fonts-dejavu.js");
  pdf.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_REGULAR_B64);
  pdf.addFileToVFS("DejaVuSans-Bold.ttf", DEJAVU_SANS_BOLD_B64);
  pdf.addFont("DejaVuSans.ttf", REPORT_FONT, "normal");
  pdf.addFont("DejaVuSans-Bold.ttf", REPORT_FONT, "bold");
  pdf.setFont(REPORT_FONT, "normal");
}

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

function drawTableHeader(pdf, cols, y) {
  y = checkPageBreak(pdf, y, 9);
  pdf.setFillColor(243, 245, 248);
  pdf.rect(M, y - 4, PW, 7, "F");
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(26, 29, 33);
  let x = M;
  cols.forEach(([label, width]) => {
    const lines = pdf.splitTextToSize(String(label), width - 3);
    pdf.text(lines[0] || "", x + 2, y);
    x += width;
  });
  return y + 6;
}

// Prelama tekst po celim rečima — visina reda raste sa brojem linija koje
// zahteva najduži sadržaj ćelije u tom redu.
function drawTableRowWrapped(pdf, cols, values, y, shade = false) {
  const lineH = 4;
  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(8);
  const wrapped = cols.map(([, width], i) => pdf.splitTextToSize(String(values[i] ?? ""), width - 3));
  const maxLines = Math.max(1, ...wrapped.map((w) => w.length));
  const rowHeight = maxLines * lineH + 2;

  y = checkPageBreak(pdf, y, rowHeight + 2);
  if (shade) {
    pdf.setFillColor(250, 251, 252);
    pdf.rect(M, y - 3.2, PW, rowHeight, "F");
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

export async function exportPdf(filename, title, rows) {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerFont(pdf);

  let y = M;
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(15);
  pdf.setTextColor(26, 29, 33);
  pdf.text(title, M, y);
  y += 10;

  if (!rows.length) {
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(120);
    pdf.text(t("no_data"), M, y);
    drawPageNumbers(pdf);
    pdf.save(`${filename}.pdf`);
    return;
  }

  const headers = Object.keys(rows[0]);
  const colWidth = PW / headers.length;
  const cols = headers.map((h) => [h, colWidth]);

  y = drawTableHeader(pdf, cols, y);
  rows.forEach((r, i) => {
    y = drawTableRowWrapped(pdf, cols, headers.map((h) => r[h]), y, i % 2 === 0);
  });

  drawPageNumbers(pdf);
  pdf.save(`${filename}.pdf`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
