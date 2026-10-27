import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenLocations, addLocation, deleteLocation } from "./locations.js";
import { escapeHtml, toast, ROLES } from "./utils.js";
import { coordsBadgeHtml, createGeoField, openCoordsEditor, geocodeMissing, showBatchResults } from "./geo-ui.js";
import { updateLocation } from "./locations.js";

await loadLang();
let companyId, actorName, currentRole, latestLocations = [];

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId; actorName = profile.name; currentRole = profile.role;
  renderNav({ companyId, uid: user.uid, profile });
  listenLocations(companyId, (l) => { latestLocations = l; render(l); });
  if (currentRole === ROLES.ADMIN) document.getElementById("loc-geo-btn").classList.remove("hidden");
});

function render(locations) {
  const isAdmin = currentRole === ROLES.ADMIN;
  const body = document.getElementById("loc-body");
  if (!locations.length) { body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("no_locations")}</td></tr>`; return; }
  body.innerHTML = locations.map((l) => `
    <tr>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>${escapeHtml(l.address || "—")}</td>
      <td>${coordsBadgeHtml(l)}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-outline" data-geo="${l.id}" title="${t("geo_adjust_btn")}">🎯</button> ${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${l.id}">${t("delete")}</button>` : ""}</td>
    </tr>
  `).join("");
  body.querySelectorAll("button[data-geo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const loc = locations.find((x) => x.id === btn.dataset.geo);
      openCoordsEditor({ title: loc.name, address: loc.address || "", lat: loc.lat, lng: loc.lng, onSave: (f) => updateLocation(companyId, loc.id, f) });
    });
  });
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("confirm_delete_location"))) return;
      await deleteLocation(companyId, btn.dataset.id);
      toast(t("toast_location_deleted"), "success");
    });
  });
}

const locGeoField = createGeoField(document.getElementById("loc-geo-host"), { getAddress: () => document.getElementById("loc-address").value });

document.getElementById("loc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const address = document.getElementById("loc-address").value.trim();
    const geo = address ? await locGeoField.resolve() : {};
    await addLocation(companyId, { name: document.getElementById("loc-name").value.trim(), address, actorName, geo });
    toast(t("toast_location_added"), "success");
    e.target.reset();
    locGeoField.reset();
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_location_added"), "error");
  }
});

// Masovno određivanje koordinata (admin) za magacine bez koordinata; 1 zahtev/s; ručno podešeni se ne diraju.
const geoBtn = document.getElementById("loc-geo-btn");
geoBtn.addEventListener("click", async () => {
  geoBtn.disabled = true;
  const original = geoBtn.textContent;
  try {
    const items = latestLocations.map((l) => ({ ...l, label: l.name, save: (f) => updateLocation(companyId, l.id, f) }));
    const rows = await geocodeMissing(items, { onProgress: (i, n, label) => { geoBtn.textContent = `${i}/${n} — ${label}`; } });
    showBatchResults(rows);
  } catch (err) {
    console.error(err);
    toast(err.message || t("geo_service_error"), "error");
  } finally {
    geoBtn.disabled = false;
    geoBtn.textContent = original;
  }
});
