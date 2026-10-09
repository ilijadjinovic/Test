import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenSuppliers, addSupplier, updateSupplier, deleteSupplier, addSupplierLocation, deleteSupplierLocation, getSupplierLocations } from "./suppliers.js";
import { getCompanySettings } from "./settings.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, currentUid, currentRole, activeSupplierId, activeSupplierName;
let latestSuppliers = [];
let supplierSort = "name_asc";

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  currentUid = user.uid; currentRole = profile.role;
  renderNav({ companyId, uid: user.uid, profile });
  listenSuppliers(companyId, (suppliers) => { latestSuppliers = suppliers; render(sortSuppliers(suppliers)); });
});

// Osnovna lista već stiže sortirana po nazivu (A-Z) iz Firestore upita
// (vidi listenSuppliers), ovde se samo dodaje opcija za obrnut redosled.
function sortSuppliers(suppliers) {
  const sorted = [...suppliers];
  if (supplierSort === "name_desc") {
    sorted.sort((a, b) => (b.name || "").localeCompare(a.name || "", "sr"));
  } else {
    sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sr"));
  }
  return sorted;
}

document.getElementById("suppliers-sort").addEventListener("change", (e) => {
  supplierSort = e.target.value;
  render(sortSuppliers(latestSuppliers));
});

function render(suppliers) {
  const isAdmin = currentRole === ROLES.ADMIN;
  const body = document.getElementById("suppliers-body");
  if (!suppliers.length) { body.innerHTML = `<tr class="empty-row"><td colspan="6">${t("no_suppliers")}</td></tr>`; return; }
  body.innerHTML = suppliers.map((s) => {
    const canEdit = isAdmin || s.createdBy === currentUid;
    return `
    <tr class="row-link" data-id="${s.id}" title="${t("details_label")}">
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td class="mono">${escapeHtml(s.pib || "—")}</td>
      <td>${escapeHtml(s.contact || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${escapeHtml(s.email || "—")}</td>
      <td>
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-action="edit" data-id="${s.id}">✎ ${t("edit")}</button>` : ""}
        <button class="btn btn-sm btn-outline" data-action="locations" data-id="${s.id}" data-name="${escapeHtml(s.name)}">📍 ${t("locations")}</button>
        <a class="btn btn-sm btn-outline" href="./admin-catalog.html?supplier=${s.id}">📦 ${t("catalog")}</a>
        ${isAdmin ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">${t("delete")}</button>` : ""}
      </td>
    </tr>
  `;
  }).join("");

  body.querySelectorAll("button[data-action=delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(t("confirm_delete_supplier"))) return;
      await deleteSupplier(companyId, btn.dataset.id);
      toast(t("toast_supplier_deleted"), "success");
    });
  });
  body.querySelectorAll("button[data-action=locations]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openLocations(btn.dataset.id, btn.dataset.name); });
  });
  body.querySelectorAll("button[data-action=edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openSupplierModal(suppliers.find((s) => s.id === btn.dataset.id), true); });
  });
  body.querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));

  // Klik bilo gde na redu (van dugmadi/linkova) otvara detalje dobavljača.
  // Ako korisnik sme da menja (admin ili tvorac zapisa), otvara se u formi za izmenu;
  // u suprotnom se prikazuju detalji samo za čitanje.
  body.querySelectorAll("tr.row-link").forEach((row) => {
    row.addEventListener("click", () => {
      const supplier = suppliers.find((s) => s.id === row.dataset.id);
      if (!supplier) return;
      const canEdit = isAdmin || supplier.createdBy === currentUid;
      openSupplierModal(supplier, canEdit);
    });
  });
}

let activeEditId = null;
const supplierModal = document.getElementById("supplier-modal");

const supplierFieldIds = ["s-name", "s-pib", "s-maticni", "s-address", "s-bank", "s-contact", "s-phone", "s-email", "s-hours", "s-note"];
const supplierSaveBtn = document.querySelector("#supplier-form button[type=submit]");

function openSupplierModal(supplier = null, editable = true) {
  activeEditId = supplier?.id || null;
  const isDetailsOnly = !!supplier && !editable;
  document.getElementById("supplier-modal-title").textContent = supplier
    ? `${isDetailsOnly ? t("details_label") : t("edit_supplier_title")} — ${supplier.name}`
    : t("new_supplier_title");
  document.getElementById("s-name").value = supplier?.name || "";
  document.getElementById("s-pib").value = supplier?.pib || "";
  document.getElementById("s-maticni").value = supplier?.maticniBroj || "";
  document.getElementById("s-address").value = supplier?.address || "";
  document.getElementById("s-bank").value = supplier?.bankAccount || "";
  document.getElementById("s-contact").value = supplier?.contact || "";
  document.getElementById("s-phone").value = supplier?.phone || "";
  document.getElementById("s-email").value = supplier?.email || "";
  document.getElementById("s-hours").value = supplier?.workingHours || "";
  document.getElementById("s-note").value = supplier?.note || "";

  // Detalji-only prikaz: polja zaključana za izmenu, dugme za čuvanje sakriveno.
  supplierFieldIds.forEach((id) => { document.getElementById(id).disabled = isDetailsOnly; });
  if (supplierSaveBtn) supplierSaveBtn.style.display = isDetailsOnly ? "none" : "";

  supplierModal.classList.remove("hidden");
}

document.getElementById("new-supplier-btn").addEventListener("click", () => openSupplierModal(null));
document.getElementById("close-supplier-modal").addEventListener("click", () => supplierModal.classList.add("hidden"));
document.getElementById("supplier-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById("s-name").value.trim(),
    pib: document.getElementById("s-pib").value.trim(),
    maticniBroj: document.getElementById("s-maticni").value.trim(),
    address: document.getElementById("s-address").value.trim(),
    bankAccount: document.getElementById("s-bank").value.trim(),
    contact: document.getElementById("s-contact").value.trim(),
    phone: document.getElementById("s-phone").value.trim(),
    email: document.getElementById("s-email").value.trim(),
    workingHours: document.getElementById("s-hours").value.trim(),
    note: document.getElementById("s-note").value.trim(),
  };
  try {
    if (activeEditId) {
      await updateSupplier(companyId, activeEditId, data, actorName);
      toast(t("toast_supplier_updated"), "success");
    } else {
      await addSupplier(companyId, { ...data, actorName, createdBy: currentUid });
      toast(t("toast_supplier_added"), "success");
    }
    supplierModal.classList.add("hidden");
    e.target.reset();
    activeEditId = null;
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_supplier_added"), "error");
  }
});

// Lokacije preuzimanja robe — naručilac sme da doda, briše samo admin (vidi refreshLocations i firestore.rules).
const locationModal = document.getElementById("location-modal");
document.getElementById("close-location-modal").addEventListener("click", () => locationModal.classList.add("hidden"));

async function openLocations(supplierId, name) {
  activeSupplierId = supplierId; activeSupplierName = name;
  document.querySelector("#location-modal h2").textContent = `${t("pickup_locations_title")} — ${name}`;
  locationModal.classList.remove("hidden");
  await refreshLocations();
}

async function refreshLocations() {
  const isAdmin = currentRole === ROLES.ADMIN;
  const locs = await getSupplierLocations(companyId, activeSupplierId);
  const host = document.getElementById("location-list");
  host.innerHTML = locs.length
    ? locs.map((l) => `<div class="attachment-item"><span>📍 ${escapeHtml(l.name)} ${l.address ? "— " + escapeHtml(l.address) : ""}</span>${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${l.id}" style="margin-left:auto;">✕</button>` : ""}</div>`).join("")
    : `<p class="muted">${t("no_locations_added_hint")}</p>`;
  host.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteSupplierLocation(companyId, activeSupplierId, btn.dataset.id);
      refreshLocations();
    });
  });
}

document.getElementById("location-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await addSupplierLocation(companyId, activeSupplierId, {
      name: document.getElementById("l-name").value.trim(),
      address: document.getElementById("l-address").value.trim(),
      createdBy: currentUid,
    });
    e.target.reset();
    refreshLocations();
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_supplier_added"), "error");
  }
});

// --- Izvoz spiska dobavljača u PDF (uključujući SVE unete lokacije preuzimanja) ---
const pdfBtn = document.getElementById("suppliers-pdf-btn");
pdfBtn.addEventListener("click", async () => {
  const suppliers = sortSuppliers(latestSuppliers);
  if (!suppliers.length) { toast(t("no_suppliers"), "error"); return; }
  pdfBtn.disabled = true;
  const originalLabel = pdfBtn.textContent;
  pdfBtn.textContent = t("generating_pdf_ellipsis");
  try {
    const [{ generateSuppliersPdf }, company] = await Promise.all([
      import("./list-pdf.js"),
      getCompanySettings(companyId),
    ]);
    const locationsBySupplierId = {};
    await Promise.all(suppliers.map(async (s) => {
      locationsBySupplierId[s.id] = await getSupplierLocations(companyId, s.id);
    }));
    await generateSuppliersPdf({ company, suppliers, locationsBySupplierId });
  } catch (err) {
    console.error(err);
    toast(t("toast_pdf_generate_error"), "error");
  } finally {
    pdfBtn.disabled = false;
    pdfBtn.textContent = originalLabel;
  }
});
