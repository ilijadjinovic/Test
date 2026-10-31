import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import {
  addCategory, deleteCategory, getCategories, addProduct, updateProduct, listenProducts, bulkUpdateProducts,
  deleteProduct, bulkDeleteProducts, setProductActive, bulkSetProductsActive, isProductActive,
} from "./catalog.js";
import { escapeHtml, toast, getParam, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, currentUid, currentRole, categories = [], unsubProducts = null;
let currentSupplierId = null, currentProducts = [], selectedIds = new Set();

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  currentUid = user.uid; currentRole = profile.role;
  renderNav({ companyId, uid: user.uid, profile });

  categories = await getCategories(companyId);
  renderCategories(categories);
  fillCategorySelect();

  const suppliers = await getSuppliers(companyId);
  const select = document.getElementById("supplier-select");
  select.innerHTML = suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  const preselect = getParam("supplier");
  if (preselect) select.value = preselect;
  if (suppliers.length) loadProducts(select.value);
  select.addEventListener("change", () => loadProducts(select.value));
});

function loadProducts(supplierId) {
  if (unsubProducts) unsubProducts();
  currentSupplierId = supplierId;
  selectedIds.clear();
  updateBulkEditBar();
  if (!supplierId) return;
  unsubProducts = listenProducts(companyId, supplierId, (products) => renderProducts(products, supplierId));
}

function renderProducts(products, supplierId) {
  currentProducts = products;
  // Izbor se čuva preko re-renderovanja (npr. live update kataloga), ali samo za
  // proizvode koji i dalje postoje.
  const stillValid = new Set(products.map((p) => p.id));
  selectedIds = new Set(Array.from(selectedIds).filter((id) => stillValid.has(id)));

  const body = document.getElementById("products-body");
  if (!products.length) { body.innerHTML = `<tr class="empty-row"><td colspan="9">${t("no_products_for_supplier")}</td></tr>`; updateBulkEditBar(); return; }
  body.innerHTML = products.map((p) => {
    const catName = categories.find((c) => c.id === p.categoryId)?.name || "—";
    const active = isProductActive(p);
    return `<tr class="row-link${active ? "" : " row-inactive"}" data-id="${p.id}" title="${t("details_label")}">
      <td><input type="checkbox" class="product-select-cb" data-id="${p.id}" ${selectedIds.has(p.id) ? "checked" : ""} /></td>
      <td class="mono">${escapeHtml(p.code || "—")}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.unit)}</td>
      <td>${escapeHtml(catName)}</td>
      <td>${p.vatRate}%</td>
      <td>${p.minQuantity}</td>
      <td><span class="badge ${active ? "badge-teal" : "badge-gray"}">${active ? t("active") : t("product_passive")}</span></td>
      <td><div class="row-actions">
        <button class="btn btn-sm btn-outline" data-action="toggle-active" data-id="${p.id}">${active ? t("deactivate_product_btn") : t("activate_product_btn")}</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${p.id}">${t("delete")}</button>
      </div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const product = products.find((x) => x.id === btn.dataset.id);
      if (!product) return;
      if (btn.dataset.action === "delete") await handleDelete([product]);
      else await handleSetActive([product], !isProductActive(product));
    });
  });

  // Klik bilo gde na redu (van dugmeta za brisanje i van checkbox-a) otvara formu za
  // izmenu jednog proizvoda — dostupno i adminu i naručiocu (Poglavlje "Izmena kataloga").
  body.querySelectorAll("tr.row-link").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".product-select-cb")) return;
      const product = products.find((x) => x.id === row.dataset.id);
      if (product) openProductDetail(product, supplierId);
    });
  });

  // Checkbox po redu — selekcija za masovnu izmenu (ne otvara red).
  body.querySelectorAll(".product-select-cb").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
      updateBulkEditBar();
    });
  });

  updateBulkEditBar();
}

// --- Brisanje / pasivizacija (pojedinačno i masovno) — dozvoljeno adminu i naručiocu ---
let busy = false;
const actorOpts = () => ({ actorName, actorUid: currentUid });

async function handleSetActive(items, active) {
  const targets = items.filter((p) => isProductActive(p) !== active);
  if (!targets.length || busy) { if (!targets.length) toast(t("toast_bulk_nothing_to_change"), "info"); return; }
  busy = true;
  try {
    if (targets.length === 1) {
      await setProductActive(companyId, currentSupplierId, targets[0].id, active, { name: targets[0].name, ...actorOpts() });
      toast(t(active ? "toast_product_activated" : "toast_product_deactivated"), "success");
    } else {
      const refs = targets.map((p) => ({ id: p.id, name: p.name }));
      const n = await bulkSetProductsActive(companyId, currentSupplierId, refs, active, actorOpts());
      toast(t(active ? "toast_bulk_activated" : "toast_bulk_deactivated", { count: n }), "success");
    }
  } catch (err) {
    console.error(err);
    toast(t("toast_generic_error"), "error");
  } finally {
    busy = false;
  }
}

// Brisanje: prvo potvrda (sa mogućnošću da se odmah pređe na pasivizaciju), pa tek onda brisanje.
async function handleDelete(items) {
  if (!items.length || busy) return;
  const choice = await askDeleteChoice(items);
  if (choice === "deactivate") return handleSetActive(items, false);
  if (choice !== "delete") return;
  busy = true;
  try {
    if (items.length === 1) {
      await deleteProduct(companyId, currentSupplierId, items[0].id, { name: items[0].name, ...actorOpts() });
      toast(t("toast_product_deleted"), "success");
    } else {
      const refs = items.map((p) => ({ id: p.id, name: p.name }));
      const n = await bulkDeleteProducts(companyId, currentSupplierId, refs, actorOpts());
      toast(t("toast_bulk_deleted", { count: n }), "success");
    }
    items.forEach((p) => selectedIds.delete(p.id));
  } catch (err) {
    console.error(err);
    toast(t("toast_generic_error"), "error");
  } finally {
    busy = false;
    updateBulkEditBar();
  }
}

const deleteModal = document.getElementById("delete-confirm-modal");
let deleteResolver = null;
const MAX_LISTED = 6;

// Vraća Promise: "delete" | "deactivate" | null (otkazano / zatvoreno).
function askDeleteChoice(items) {
  const many = items.length > 1;
  const activeCount = items.filter(isProductActive).length;
  document.getElementById("delete-confirm-question").textContent = many
    ? t("delete_confirm_question_many", { count: items.length })
    : t("delete_confirm_question_one", { name: items[0].name || items[0].code || "" });

  const list = document.getElementById("delete-confirm-list");
  list.classList.toggle("hidden", !many);
  list.innerHTML = items.slice(0, MAX_LISTED).map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")
    + (items.length > MAX_LISTED ? `<li>${t("delete_confirm_and_more", { count: items.length - MAX_LISTED })}</li>` : "");

  // Pasivizacija ima smisla samo za proizvode koji su još aktivni.
  const canDeactivate = activeCount > 0;
  const deactivateBtn = document.getElementById("delete-confirm-deactivate");
  deactivateBtn.classList.toggle("hidden", !canDeactivate);
  deactivateBtn.textContent = many ? t("delete_confirm_passivize_many_btn", { count: activeCount }) : t("delete_confirm_passivize_btn");
  document.getElementById("delete-confirm-alt").classList.toggle("hidden", !canDeactivate);
  document.getElementById("delete-confirm-all-passive").classList.toggle("hidden", canDeactivate);

  deleteModal.classList.remove("hidden");
  deactivateBtn.classList.contains("hidden") ? document.getElementById("delete-confirm-cancel").focus() : deactivateBtn.focus();
  return new Promise((resolve) => { deleteResolver = resolve; });
}

function closeDeleteModal(choice) {
  deleteModal.classList.add("hidden");
  const resolve = deleteResolver;
  deleteResolver = null;
  if (resolve) resolve(choice);
}
document.getElementById("delete-confirm-delete").addEventListener("click", () => closeDeleteModal("delete"));
document.getElementById("delete-confirm-deactivate").addEventListener("click", () => closeDeleteModal("deactivate"));
document.getElementById("delete-confirm-cancel").addEventListener("click", () => closeDeleteModal(null));
document.getElementById("delete-confirm-close").addEventListener("click", () => closeDeleteModal(null));
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteModal(null); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !deleteModal.classList.contains("hidden")) closeDeleteModal(null);
});

const selectedProducts = () => currentProducts.filter((p) => selectedIds.has(p.id));
document.getElementById("bulk-delete-btn").addEventListener("click", () => handleDelete(selectedProducts()));
document.getElementById("bulk-deactivate-btn").addEventListener("click", () => handleSetActive(selectedProducts(), false));
document.getElementById("bulk-activate-btn").addEventListener("click", () => handleSetActive(selectedProducts(), true));

// --- Masovna izmena (bulk edit) — selektuj više proizvoda i promeni zajednička
// polja (kategorija, JM, PDV, min. količina) odjednom umesto jedan po jedan. ---
const selectAllCb = document.getElementById("products-select-all");
selectAllCb.addEventListener("change", () => {
  if (selectAllCb.checked) currentProducts.forEach((p) => selectedIds.add(p.id));
  else selectedIds.clear();
  renderProducts(currentProducts, currentSupplierId);
});

function updateBulkEditBar() {
  const bar = document.getElementById("bulk-edit-bar");
  const count = selectedIds.size;
  bar.classList.toggle("hidden", count === 0);
  document.getElementById("bulk-edit-count").textContent = t("bulk_selected_count", { count });
  selectAllCb.checked = currentProducts.length > 0 && count === currentProducts.length;
  selectAllCb.indeterminate = count > 0 && count < currentProducts.length;
}

document.getElementById("bulk-edit-clear-btn").addEventListener("click", () => {
  selectedIds.clear();
  renderProducts(currentProducts, currentSupplierId);
});

const bulkEditModal = document.getElementById("bulk-edit-modal");
document.getElementById("close-bulk-edit-modal").addEventListener("click", () => bulkEditModal.classList.add("hidden"));

// Svako polje ima svoj "uključi izmenu" checkbox — samo uključena polja se
// primenjuju na sve izabrane proizvode; ostala ostaju nepromenjena po proizvodu.
[["be-unit-on", "be-unit"], ["be-category-on", "be-category"], ["be-vat-on", "be-vat"], ["be-min-on", "be-min"]].forEach(([cbId, fieldId]) => {
  document.getElementById(cbId).addEventListener("change", (e) => {
    document.getElementById(fieldId).disabled = !e.target.checked;
  });
});

document.getElementById("bulk-edit-open-btn").addEventListener("click", () => {
  if (!selectedIds.size) return;
  document.getElementById("bulk-edit-modal-hint").textContent = t("bulk_edit_modal_hint", { count: selectedIds.size });
  ["be-unit-on", "be-category-on", "be-vat-on", "be-min-on"].forEach((id) => { document.getElementById(id).checked = false; });
  ["be-unit", "be-category", "be-vat", "be-min"].forEach((id) => { document.getElementById(id).disabled = true; });
  document.getElementById("be-category").innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">${t("no_category")}</option>`;
  document.getElementById("be-unit").value = "";
  document.getElementById("be-vat").value = "";
  document.getElementById("be-min").value = "";
  bulkEditModal.classList.remove("hidden");
});

document.getElementById("bulk-edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {};
  if (document.getElementById("be-unit-on").checked) data.unit = document.getElementById("be-unit").value.trim();
  if (document.getElementById("be-category-on").checked) data.categoryId = document.getElementById("be-category").value;
  if (document.getElementById("be-vat-on").checked) data.vatRate = Number(document.getElementById("be-vat").value) || 0;
  if (document.getElementById("be-min-on").checked) data.minQuantity = Number(document.getElementById("be-min").value) || 1;

  if (!Object.keys(data).length) { toast(t("toast_bulk_no_field_selected"), "error"); return; }

  const items = currentProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    await bulkUpdateProducts(companyId, currentSupplierId, items, data, actorName);
    toast(t("toast_bulk_updated", { count: items.length }), "success");
    bulkEditModal.classList.add("hidden");
  } catch (err) {
    console.error(err);
    toast(t("toast_generic_error"), "error");
  } finally {
    submitBtn.disabled = false;
  }
});

const productDetailModal = document.getElementById("product-detail-modal");
document.getElementById("close-product-detail-modal").addEventListener("click", () => productDetailModal.classList.add("hidden"));

let editingProduct = null; // { id, supplierId } — proizvod trenutno otvoren u formi za izmenu

function openProductDetail(product, supplierId) {
  editingProduct = { id: product.id, supplierId };
  document.getElementById("product-detail-title").textContent = product.name || product.code || t("details_label");
  document.getElementById("pd-name").value = product.name || "";
  document.getElementById("pd-code").value = product.code || "";
  document.getElementById("pd-barcode").value = product.barcode || "";
  document.getElementById("pd-unit").value = product.unit || "kom";
  document.getElementById("pd-vat").value = product.vatRate ?? 20;
  document.getElementById("pd-min").value = product.minQuantity ?? 1;
  const catSelect = document.getElementById("pd-category");
  catSelect.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">${t("no_category")}</option>`;
  catSelect.value = product.categoryId || "";
  productDetailModal.classList.remove("hidden");
}

document.getElementById("product-edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingProduct) return;
  await updateProduct(companyId, editingProduct.supplierId, editingProduct.id, {
    name: document.getElementById("pd-name").value.trim(),
    code: document.getElementById("pd-code").value.trim(),
    barcode: document.getElementById("pd-barcode").value.trim(),
    unit: document.getElementById("pd-unit").value.trim(),
    categoryId: document.getElementById("pd-category").value,
    vatRate: Number(document.getElementById("pd-vat").value) || 0,
    minQuantity: Number(document.getElementById("pd-min").value) || 1,
  });
  toast(t("toast_product_updated"), "success");
  productDetailModal.classList.add("hidden");
});

function fillCategorySelect() {
  document.getElementById("p-category").innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">${t("no_category")}</option>`;
}

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const supplierId = document.getElementById("supplier-select").value;
  if (!supplierId) { toast(t("toast_select_supplier_first"), "error"); return; }
  const lastCategory = document.getElementById("p-category").value; // zapamti izabranu kategoriju
  await addProduct(companyId, supplierId, {
    name: document.getElementById("p-name").value.trim(),
    code: document.getElementById("p-code").value.trim(),
    barcode: document.getElementById("p-barcode").value.trim(),
    unit: document.getElementById("p-unit").value.trim(),
    categoryId: lastCategory,
    vatRate: Number(document.getElementById("p-vat").value) || 0,
    minQuantity: Number(document.getElementById("p-min").value) || 1,
    actorName,
    createdBy: currentUid,
  });
  toast(t("toast_product_added"), "success");
  e.target.reset();
  document.getElementById("p-unit").value = "kom";
  document.getElementById("p-vat").value = 20;
  document.getElementById("p-min").value = 1;
  document.getElementById("p-category").value = lastCategory; // ostavi istu kategoriju aktivnu
});

function renderCategories(cats) {
  const isAdmin = currentRole === ROLES.ADMIN;
  document.getElementById("categories-body").innerHTML = cats.length
    ? cats.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${c.id}">${t("delete")}</button>` : ""}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="2">${t("no_categories")}</td></tr>`;
  document.querySelectorAll("#categories-body button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteCategory(companyId, btn.dataset.id);
      categories = await getCategories(companyId);
      renderCategories(categories); fillCategorySelect();
    });
  });
}

document.getElementById("category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addCategory(companyId, document.getElementById("c-name").value.trim());
  e.target.reset();
  categories = await getCategories(companyId);
  renderCategories(categories); fillCategorySelect();
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-products").classList.toggle("hidden", btn.dataset.tab !== "products");
    document.getElementById("tab-categories").classList.toggle("hidden", btn.dataset.tab !== "categories");
  });
});
