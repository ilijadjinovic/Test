import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { getCompanySettings, updateCompanySettings } from "./settings.js";
import { toast, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName;

requireAuth([ROLES.ADMIN], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  const s = await getCompanySettings(companyId);
  if (!s) return;
  document.getElementById("s-name").value = s.name || "";
  document.getElementById("s-pib").value = s.pib || "";
  document.getElementById("s-address").value = s.address || "";
  document.getElementById("s-phone").value = s.phone || "";
  document.getElementById("s-hours").value = s.workingHours || "";
  document.getElementById("s-currency").value = s.currency || "RSD";
  document.getElementById("s-language").value = s.language || "sr";
  document.getElementById("s-assignment").value = s.assignmentMode || "admin_bira";
  document.getElementById("s-gps").checked = !!s.gpsTrackingEnabled;
});

document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await updateCompanySettings(companyId, {
    name: document.getElementById("s-name").value.trim(),
    pib: document.getElementById("s-pib").value.trim(),
    address: document.getElementById("s-address").value.trim(),
    phone: document.getElementById("s-phone").value.trim(),
    workingHours: document.getElementById("s-hours").value.trim(),
    currency: document.getElementById("s-currency").value,
    language: document.getElementById("s-language").value,
    assignmentMode: document.getElementById("s-assignment").value,
    gpsTrackingEnabled: document.getElementById("s-gps").checked,
  }, actorName);
  toast(t("toast_settings_saved"), "success");
});
