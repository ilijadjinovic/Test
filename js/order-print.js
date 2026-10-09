// ============================================================================
// PDF NARUDŽBENICA — izvoz za štampu (Poglavlje 4/5)
// Zaglavlje firme + stavke grupisane po dobavljaču (kao u app-u) + finansijski
// pregled (ako je uneto) + mesta za potpis naručioca/isporučioca i overu.
//
// PDF se crta direktno kroz jsPDF native API (font registrovan preko
// addFileToVFS/addFont, tekst ispisan sa pdf.text() na mm koordinatama) — isti
// pouzdan pristup kao reports.js. Ranija verzija je koristila jsPDF .html() +
// html2canvas (rasterizacija HTML-a u canvas), ali se pokazalo da html2canvas
// ume da pogrešno izmeri ili potpuno izgubi glifove iz custom TTF fonta za
// srpske dijakritike (č/ć/š/ž/đ) — rezultat je bio npr. "Naru ilac" umesto
// "Naručilac" i razvučen/slepljen razmak između slova. Native crtanje teksta
// nikad ne rasterizuje sadržaj, pa ovog problema nema — font se u PDF ugrađuje
// direktno kao pravi (selektabilan/pretraživ) vektorski font.
// ============================================================================
import { formatDate } from "./utils.js";
import { getSupplierLocations } from "./suppliers.js";
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

// Font se učitava dinamički (lazy) — fajl je ~2MB base64, ne opterećuje
// običan prikaz stranice — i registruje direktno u jsPDF-u (addFileToVFS +
// addFont), umesto kroz CSS @font-face kao ranije.
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

function fmtAmount(n, currency) {
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return `${(Number(n) || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function fmtIsoDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr + "T00:00:00");
  if (isNaN(d)) return String(isoStr);
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── GENERIČKA TABELA (cols: [label, width, align?]) ────────────
function drawTableHeader(pdf, cols, y) {
  y = checkPageBreak(pdf, y, 9);
  pdf.setFillColor(243, 245, 248);
  pdf.rect(M, y - 4, PW, 7, "F");
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(26, 29, 33);
  let x = M;
  cols.forEach(([label, width, align]) => {
    if (align === "right") pdf.text(label, x + width - 2, y, { align: "right" });
    else pdf.text(label, x + 2, y);
    x += width;
  });
  return y + 6;
}

// Prelama tekst po celim rečima (pdf.splitTextToSize) — visina reda raste
// sa brojem linija koje zahteva najduži tekst u tom redu (npr. dug naziv
// proizvoda ili napomena).
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
  cols.forEach(([, width, align], i) => {
    let ly = y;
    wrapped[i].forEach((line) => {
      if (align === "right") pdf.text(line, x + width - 2, ly, { align: "right" });
      else pdf.text(line, x + 2, ly);
      ly += lineH;
    });
    x += width;
  });

  return y + rowHeight;
}

// ── ZAGLAVLJE FIRME ─────────────────────────────────────────────
function drawCompanyHeader(pdf, company) {
  let y = M;
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(26, 29, 33);
  pdf.text(company?.name || t("company_generic"), M, y);
  y += 6;

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(85);
  const lines = [];
  if (company?.address) lines.push(`${t("address_label")}: ${company.address}`);
  const pibLine = [
    company?.pib ? `${t("pib_label")}: ${company.pib}` : null,
    company?.maticniBroj ? `${t("company_id_label")}: ${company.maticniBroj}` : null,
  ].filter(Boolean).join("   ·   ");
  if (pibLine) lines.push(pibLine);
  if (company?.phone) lines.push(`${t("phone_label")}: ${company.phone}`);
  lines.forEach((line) => { pdf.text(line, M, y); y += 4.5; });

  y += 2;
  pdf.setDrawColor(26, 29, 33);
  pdf.setLineWidth(0.6);
  pdf.line(M, y, M + PW, y);
  return y + 8;
}

// ── NASLOV + META PODACI ─────────────────────────────────────────
function drawOrderTitle(pdf, order, y) {
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(26, 29, 33);
  pdf.text(`${t("order_form_title")} ${order.orderNumber}`, M, y);

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(85);
  pdf.text(`${t("created_date_label")}: ${formatDate(order.createdAt)}`, M + PW, y - 4, { align: "right" });
  pdf.text(`${t("priority")}: ${order.priority === "hitno" ? t("urgent") : t("standard")}`, M + PW, y, { align: "right" });

  return y + 9;
}

function drawOrderMeta(pdf, order, deliveryLocations, y) {
  y = checkPageBreak(pdf, y, 16);
  pdf.setFontSize(9.5);

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setTextColor(85);
  pdf.text(`${t("role_narucilac")}:`, M, y);
  pdf.text(`${t("role_isporucilac")}:`, M + 95, y);
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setTextColor(30);
  pdf.text(order.createdByName || "—", M + 26, y);
  pdf.text(order.assignedToName || "—", M + 122, y);
  y += 6;

  if (order.requestedByName) {
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setTextColor(85);
    pdf.text(`${t("requested_by_meta_label")}:`, M, y);
    pdf.setFont(REPORT_FONT, "bold");
    pdf.setTextColor(30);
    pdf.text(order.requestedByName, M + 26, y);
    y += 6;
  }

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setTextColor(85);
  pdf.text(`${t("delivery_locations_title")}:`, M, y);
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setTextColor(30);
  const locText = (deliveryLocations || []).map((l) => l.locationName).join(", ") || "—";
  const locLines = pdf.splitTextToSize(locText, PW - 42);
  pdf.text(locLines, M + 42, y);
  y += locLines.length * 4.5;

  return y + 5;
}

// ── STAVKE PO DOBAVLJAČU (grupisano po lokaciji preuzimanja) ─────
function drawSupplierSection(pdf, group, y, pickupAddressMap) {
  y = checkPageBreak(pdf, y, 22);
  pdf.setFillColor(243, 245, 248);
  pdf.rect(M, y - 4, PW, 7, "F");
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(10.5);
  pdf.setTextColor(26, 29, 33);
  pdf.text(`${t("supplier")}: ${group.name}`, M + 2, y);
  y += 9;

  // Grupisanje stavki po lokaciji preuzimanja (redosled po prvom pojavljivanju)
  const locGroups = [];
  const locIndex = {};
  group.items.forEach((it) => {
    const key = (it.pickupLocationId && it.pickupLocationId !== "any") ? it.pickupLocationId : "any";
    if (!(key in locIndex)) {
      locIndex[key] = locGroups.length;
      locGroups.push({
        name: key === "any" ? t("any_location") : (it.pickupLocationName || t("location")),
        address: key === "any" ? "" : (pickupAddressMap[key] || ""),
        items: [],
      });
    }
    locGroups[locIndex[key]].items.push(it);
  });

  const cols = [
    [t("code"), 22],
    [t("product_label"), 54],
    [t("quantity"), 22],
    [t("delivery_location_label"), 41],
    [t("note"), 41],
  ];

  locGroups.forEach((g) => {
    y = checkPageBreak(pdf, y, 15);
    pdf.setFont(REPORT_FONT, "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(60);
    const locLabel = g.address ? `${t("pickup_location_label")}: ${g.name} — ${g.address}` : `${t("pickup_location_label")}: ${g.name}`;
    pdf.text(locLabel, M + 2, y);
    y += 5;

    y = drawTableHeader(pdf, cols, y);
    g.items.forEach((it, i) => {
      y = drawTableRowWrapped(pdf, cols, [
        it.code || "—",
        it.productName,
        `${it.quantity} ${it.unit}`,
        it.deliveryLocationName || "—",
        it.note || "—",
      ], y, i % 2 === 0);
    });
    y += 4;
  });

  return y + 2;
}

// ── FINANSIJSKI PREGLED ─────────────────────────────────────────
function drawFinanceSection(pdf, purchases, currency, total, y) {
  y = checkPageBreak(pdf, y, 22);
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(10.5);
  pdf.setTextColor(26, 29, 33);
  pdf.text(t("finance_overview_title"), M, y);
  y += 6;

  const cols = [
    [t("supplier"), 55],
    [t("receipt_number_label"), 45],
    [t("receipt_date_label"), 35],
    [t("amount_label"), 45, "right"],
  ];
  y = drawTableHeader(pdf, cols, y);
  purchases.filter((p) => p.paidAmount).forEach((p, i) => {
    y = drawTableRowWrapped(pdf, cols, [
      p.supplierName,
      p.receiptNumber || "—",
      fmtIsoDate(p.receiptDate),
      fmtAmount(p.paidAmount, currency),
    ], y, i % 2 === 0);
  });

  y = checkPageBreak(pdf, y, 9);
  pdf.setDrawColor(216, 221, 227);
  pdf.setLineWidth(0.3);
  pdf.line(M, y - 3, M + PW, y - 3);
  pdf.setFont(REPORT_FONT, "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(26, 29, 33);
  pdf.text(t("order_total_label_caps"), M + PW - 47, y, { align: "right" });
  pdf.text(fmtAmount(total, currency), M + PW, y, { align: "right" });

  return y + 9;
}

// ── OVERA + POTPISI ───────────────────────────────────────────
function drawApproval(pdf, y) {
  y = checkPageBreak(pdf, y, 20);
  pdf.setDrawColor(216, 221, 227);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, M + PW, y);
  y += 7;

  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(30);
  pdf.text(`☐  ${t("approval_statement")}`, M, y);
  y += 7;
  pdf.text(`${t("approval_date_label")}: ______________________`, M, y);
  return y + 14;
}

function drawSignatures(pdf, y) {
  y = checkPageBreak(pdf, y, 24);
  const colW = PW / 3;
  const labels = [t("role_narucilac"), t("role_isporucilac"), t("approved_by_label")];
  labels.forEach((label, i) => {
    const x = M + i * colW;
    pdf.setDrawColor(26, 29, 33);
    pdf.setLineWidth(0.4);
    pdf.line(x, y, x + colW - 8, y);
    pdf.setFont(REPORT_FONT, "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(30);
    pdf.text(label, x, y + 4.5);
    pdf.setTextColor(85);
    pdf.setFontSize(8);
    pdf.text(`${t("date_label")}: ______________`, x, y + 10);
  });
  return y + 18;
}

function drawFooter(pdf, y) {
  y = checkPageBreak(pdf, y, 6);
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  const generatedAt = new Date().toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  pdf.setFont(REPORT_FONT, "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(150);
  pdf.text(`${t("pdf_generated_footer")} — ${generatedAt}`, M, y);
}

// company: dokument firme (name, address, pib, maticniBroj, phone, currency)
// order: dokument narudžbine
// items: sve stavke narudžbine (OrderItems)
// purchases: nabavke po dobavljaču (za finansijski pregled, može biti prazan niz)
// deliveryLocations: lokacije isporuke narudžbine
// companyId: potreban za dovlačenje adresa lokacija preuzimanja dobavljača (SupLocations)
export async function generateOrderPdf({ company, order, items, purchases = [], deliveryLocations = [], companyId }) {
  const JsPDF = await getJsPDF();
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerFont(pdf);

  // Adrese lokacija preuzimanja — po dobavljaču, keširano u mapu { locationId: address }
  const pickupAddressMap = {};
  if (companyId) {
    const supplierIds = [...new Set(items.map((i) => i.supplierId).filter(Boolean))];
    const locsPerSupplier = await Promise.all(supplierIds.map((sid) => getSupplierLocations(companyId, sid)));
    locsPerSupplier.forEach((locs) => locs.forEach((l) => { pickupAddressMap[l.id] = l.address || ""; }));
  }

  let y = drawCompanyHeader(pdf, company);
  y = drawOrderTitle(pdf, order, y);
  y = drawOrderMeta(pdf, order, deliveryLocations, y);

  const bySupplier = {};
  items.forEach((i) => {
    (bySupplier[i.supplierId] ||= { name: i.supplierName, items: [] }).items.push(i);
  });
  Object.values(bySupplier).forEach((group) => { y = drawSupplierSection(pdf, group, y, pickupAddressMap); });

  const currency = company?.currency || "RSD";
  const total = (purchases || []).reduce((s, p) => s + (Number(p.paidAmount) || 0), 0);
  if (total > 0) y = drawFinanceSection(pdf, purchases, currency, total, y);

  y = drawApproval(pdf, y);
  y = drawSignatures(pdf, y);
  drawFooter(pdf, y);
  drawPageNumbers(pdf);

  // orderNumber sada može sadržati "/" (npr. NAR-20260726-1/26), a to nije
  // validno u nazivu fajla (browser bi ga protumačio kao poddirektorijum),
  // pa se samo za ime fajla zamenjuje sa "-".
  const bezbedanBroj = String(order.orderNumber).replace(/\//g, "-");
  pdf.save(`${t("order_form_filename_prefix")}-${bezbedanBroj}.pdf`);
}
