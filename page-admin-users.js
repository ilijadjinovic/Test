import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenCompanyUsers, createCompanyUser, updateCompanyUser } from "./users.js";
import { getCompanySettings } from "./settings.js";
import { escapeHtml, toast, ROLES, roleLabel, formatDate } from "./utils.js";

await loadLang();
let companyId, currentName, currentRole;
let latestUsers = [];
let userSort = "name_asc";

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId;
  currentName = profile.name;
  currentRole = profile.role;
  renderNav({ companyId, uid: user.uid, profile });
  listenCompanyUsers(companyId, (users) => { latestUsers = users; renderUsers(sortUsers(users)); });

  // Naručilac sme samo da DODAJE isporučioce — ograniči izbor uloge u formi
  // i ukloni mogućnost deaktivacije naloga (to ostaje isključivo admin).
  if (currentRole === ROLES.NARUCILAC) {
    const roleSelect = document.getElementById("u-role");
    [...roleSelect.options].forEach((opt) => { if (opt.value !== ROLES.ISPORUCILAC) opt.remove(); });
    roleSelect.value = ROLES.ISPORUCILAC;
    roleSelect.disabled = true;
  }
});

// Redosled uloga kada je izabrano sortiranje "Po ulozi" (admin firme prvi, pa naniže).
const ROLE_SORT_ORDER = { [ROLES.ADMIN]: 0, [ROLES.NARUCILAC]: 1, [ROLES.ISPORUCILAC]: 2 };

function sortUsers(users) {
  const sorted = [...users];
  if (userSort === "name_desc") {
    sorted.sort((a, b) => (b.name || "").localeCompare(a.name || "", "sr"));
  } else if (userSort === "role") {
    sorted.sort((a, b) => {
      const diff = (ROLE_SORT_ORDER[a.role] ?? 99) - (ROLE_SORT_ORDER[b.role] ?? 99);
      return diff !== 0 ? diff : (a.name || "").localeCompare(b.name || "", "sr");
    });
  } else {
    sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sr"));
  }
  return sorted;
}

document.getElementById("users-sort").addEventListener("change", (e) => {
  userSort = e.target.value;
  renderUsers(sortUsers(latestUsers));
});

function renderUsers(users) {
  const isAdmin = currentRole === ROLES.ADMIN;
  const body = document.getElementById("users-body");
  if (!users.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">${t("no_users")}</td></tr>`; return; }
  body.innerHTML = users.map((u) => `
    <tr class="row-link" data-id="${u.id}" title="${t("details_label")}">
      <td><strong>${escapeHtml(u.name)}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-blue">${roleLabel(u.role)}</span></td>
      <td>${u.active === false ? `<span class="badge badge-red">${t("inactive")}</span>` : `<span class="badge badge-teal">${t("active")}</span>`}</td>
      <td>${isAdmin ? `<button class="btn btn-sm btn-outline" data-id="${u.id}" data-active="${u.active !== false}">${u.active === false ? t("activate") : t("deactivate")}</button>` : ""}</td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await updateCompanyUser(companyId, btn.dataset.id, { active: btn.dataset.active !== "true" });
      toast(t("toast_user_status_updated"), "success");
    });
  });

  // Klik bilo gde na redu (van dugmeta za status) otvara detalje korisnika.
  body.querySelectorAll("tr.row-link").forEach((row) => {
    row.addEventListener("click", () => {
      const u = users.find((x) => x.id === row.dataset.id);
      if (u) openUserDetails(u);
    });
  });
}

const userDetailsModal = document.getElementById("user-details-modal");

function openUserDetails(u) {
  document.getElementById("ud-name").value = u.name || "";
  document.getElementById("ud-email").value = u.email || "";
  document.getElementById("ud-role").value = roleLabel(u.role);
  document.getElementById("ud-status").value = u.active === false ? t("inactive") : t("active");
  document.getElementById("ud-created").value = u.createdAt ? formatDate(u.createdAt) : "—";
  userDetailsModal.classList.remove("hidden");
}

document.getElementById("close-user-details-modal").addEventListener("click", () => userDetailsModal.classList.add("hidden"));

const modal = document.getElementById("user-modal");
document.getElementById("new-user-btn").addEventListener("click", () => modal.classList.remove("hidden"));
document.getElementById("close-modal").addEventListener("click", () => modal.classList.add("hidden"));

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await createCompanyUser(companyId, {
      name: document.getElementById("u-name").value.trim(),
      email: document.getElementById("u-email").value.trim(),
      password: document.getElementById("u-password").value,
      role: document.getElementById("u-role").value,
      actorName: currentName,
    });
    toast(t("toast_user_created"), "success");
    modal.classList.add("hidden");
    e.target.reset();
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_user_create_error"), "error");
  } finally {
    btn.disabled = false;
  }
});

// --- Izvoz spiska korisnika u PDF ---
const pdfBtn = document.getElementById("users-pdf-btn");
pdfBtn.addEventListener("click", async () => {
  const users = sortUsers(latestUsers);
  if (!users.length) { toast(t("no_users"), "error"); return; }
  pdfBtn.disabled = true;
  const originalLabel = pdfBtn.textContent;
  pdfBtn.textContent = t("generating_pdf_ellipsis");
  try {
    const [{ generateUsersPdf }, company] = await Promise.all([
      import("./list-pdf.js"),
      getCompanySettings(companyId),
    ]);
    await generateUsersPdf({ company, users, roleLabelFn: roleLabel });
  } catch (err) {
    console.error(err);
    toast(t("toast_pdf_generate_error"), "error");
  } finally {
    pdfBtn.disabled = false;
    pdfBtn.textContent = originalLabel;
  }
});
