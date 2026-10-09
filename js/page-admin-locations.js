import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenLocations, addLocation, deleteLocation } from "./locations.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, currentRole;

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId; actorName = profile.name; currentRole = profile.role;
  renderNav({ companyId, uid: user.uid, profile });
  listenLocations(companyId, render);
});

function render(locations) {
  const isAdmin = currentRole === ROLES.ADMIN;
  const body = document.getElementById("loc-body");
  if (!locations.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">${t("no_locations")}</td></tr>`; return; }
  body.innerHTML = locations.map((l) => `
    <tr>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>${escapeHtml(l.address || "—")}</td>
      <td>${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${l.id}">${t("delete")}</button>` : ""}</td>
    </tr>
  `).join("");
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("confirm_delete_location"))) return;
      await deleteLocation(companyId, btn.dataset.id);
      toast(t("toast_location_deleted"), "success");
    });
  });
}

document.getElementById("loc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await addLocation(companyId, { name: document.getElementById("loc-name").value.trim(), address: document.getElementById("loc-address").value.trim(), actorName });
    toast(t("toast_location_added"), "success");
    e.target.reset();
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_location_added"), "error");
  }
});
