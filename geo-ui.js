// ============================================================================
// GEO-UI — zajednički delovi za koordinate: polje „Odmah odredi koordinate" sa
// mapom (forme za dodavanje), prozor za podešavanje na mapi, masovno određivanje
// i tabela rezultata. Koordinate se čuvaju na lokacijama preuzimanja dobavljača i
// na lokacijama firme (magacinima): lat, lng, geoSource (auto|manual),
// geoQuality (tacno|ulica|naselje), geoUpdatedAt.
// ============================================================================
import { t } from "./i18n.js";
import { serverTimestamp } from "./firebase-init.js";
import { escapeHtml, toast } from "./utils.js";
import { geocodeAddress, hasCoords, mapsPointUrl, mapsSearchUrl } from "./geo.js";
import { createMapPicker } from "./map-picker.js";

// --- Polja koja se upisuju u dokument lokacije ---------------------------------------------
export function geoFields(hit) {
  return { lat: hit.lat, lng: hit.lng, geoSource: "auto", geoQuality: hit.quality || "naselje", geoUpdatedAt: serverTimestamp() };
}
export function manualFields(p) {
  return { lat: p.lat, lng: p.lng, geoSource: "manual", geoQuality: "tacno", geoUpdatedAt: serverTimestamp() };
}

// Status za tabele: ✅ tačno/ručno · ⚠ ulica/naselje · ❌ bez koordinata
export function geoStatus(o) {
  if (!hasCoords(o)) return "none";
  if (o.geoSource === "manual" || o.geoQuality === "tacno") return "ok";
  return "approx";
}
export function coordsBadgeHtml(o) {
  const st = geoStatus(o);
  if (st === "none") return `<span class="muted">❌ ${t("geo_no_coords")}</span>`;
  const label = o.geoSource === "manual" ? t("geo_q_manual") : t(`geo_q_${o.geoQuality || "naselje"}`);
  return `<span title="${Number(o.lat).toFixed(6)}, ${Number(o.lng).toFixed(6)}">${st === "ok" ? "✅" : "⚠"} ${escapeHtml(label)}</span>`;
}

// Najbolji pokušaj bez prekidanja toka (npr. pri dodavanju): vraća polja ili {}.
export async function tryGeocodeFields(address) {
  try {
    const hit = address ? await geocodeAddress(address) : null;
    return hit ? geoFields(hit) : {};
  } catch (err) {
    console.warn("Geokodiranje nije uspelo:", err);
    return {};
  }
}

// --- Polje „☑ Odmah odredi koordinate" za forme dodavanja ---------------------------------
// host: prazan element u formi. getAddress: () => string.
// Vraća { resolve(): Promise<polja|{}>, reset() }. resolve() se zove pri snimanju: ako je štiklirano a koordinate
// još nisu određene, geokodira adresu; ako ništa nije nađeno, vraća {} (lokacija se snima bez koordinata, uz ❌ upozorenje).
export function createGeoField(host, { getAddress }) {
  host.innerHTML = `
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0 8px;">
      <input type="checkbox" data-g="chk" checked /> ${t("geo_now_label")}
    </label>
    <div class="row-actions" style="gap:8px;align-items:center;margin-bottom:6px;">
      <button type="button" class="btn btn-sm btn-outline" data-g="btn">${t("geo_determine_btn")}</button>
      <span class="muted" data-g="status" style="font-size:12px;"></span>
    </div>
    <div data-g="map" class="hidden" style="height:220px;border-radius:8px;overflow:hidden;margin-bottom:10px;"></div>`;
  const q = (k) => host.querySelector(`[data-g="${k}"]`);
  let picker = null, current = null;   // current = { lat, lng, source, quality }

  const statusText = () => {
    if (!current) return "";
    const ico = current.source === "manual" || current.quality === "tacno" ? "✅" : "⚠";
    const lbl = current.source === "manual" ? t("geo_q_manual") : t(`geo_q_${current.quality}`);
    return `${ico} ${lbl} · ${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`;
  };

  async function showMap() {
    q("map").classList.remove("hidden");
    try {
      if (picker) { picker.setPosition(current.lat, current.lng); return; }
      picker = await createMapPicker(q("map"), {
        lat: current.lat, lng: current.lng,
        onChange: (p) => { current = { lat: p.lat, lng: p.lng, source: "manual", quality: "tacno" }; q("status").textContent = statusText(); },
      });
    } catch (err) { console.warn("Mapa nije dostupna:", err); q("map").classList.add("hidden"); }
  }

  async function determine() {
    const address = (getAddress() || "").trim();
    if (!address) { q("status").textContent = t("geo_need_address"); return false; }
    q("status").textContent = t("geo_searching");
    try {
      const hit = await geocodeAddress(address);
      if (!hit) { current = null; q("status").textContent = `❌ ${t("geo_not_found")}`; return false; }
      current = { lat: hit.lat, lng: hit.lng, source: "auto", quality: hit.quality };
      q("status").textContent = statusText();
      await showMap();
      return true;
    } catch (err) {
      console.error(err);
      q("status").textContent = `❌ ${t("geo_service_error")}`;
      return false;
    }
  }
  q("btn").addEventListener("click", determine);

  return {
    async resolve() {
      if (!q("chk").checked) return {};
      if (!current) await determine();
      if (!current) { toast(t("geo_saved_without"), "error"); return {}; }
      return current.source === "manual"
        ? manualFields(current)
        : { lat: current.lat, lng: current.lng, geoSource: "auto", geoQuality: current.quality, geoUpdatedAt: serverTimestamp() };
    },
    reset() {
      current = null; q("status").textContent = ""; q("map").classList.add("hidden");
      if (picker) { picker.destroy(); picker = null; }
      q("chk").checked = true;
    },
  };
}

// --- Prozor za podešavanje jedne tačke na mapi ---------------------------------------------
// onSave(polja) → Promise
export function openCoordsEditor({ title, address = "", lat = null, lng = null, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = 300;
  overlay.innerHTML = `
    <div class="modal-card wide">
      <div class="modal-head"><h2>${escapeHtml(title || t("geo_editor_title"))}</h2><button type="button" class="icon-btn" data-act="close">✕</button></div>
      <div class="field"><label>${t("address_label")}</label><div>${escapeHtml(address) || `<span class="muted">—</span>`}</div></div>
      <div class="row-actions" style="gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-outline" data-act="auto" ${address ? "" : "disabled"}>${t("geo_auto_btn")}</button>
        <button type="button" class="btn btn-sm btn-outline" data-act="gmaps">${t("geo_open_gmaps")}</button>
      </div>
      <div data-m="map" style="height:340px;border-radius:8px;overflow:hidden;"></div>
      <div class="muted" data-m="status" style="font-size:12px;min-height:18px;margin:8px 0;">${t("geo_map_hint")}</div>
      <button type="button" class="btn btn-primary" style="width:100%;" data-act="save">${t("save")}</button>
    </div>`;
  document.body.appendChild(overlay);
  const status = overlay.querySelector('[data-m="status"]');
  let picker = null, pos = hasCoords({ lat, lng }) ? { lat: Number(lat), lng: Number(lng) } : null;
  let source = "manual", quality = "tacno";
  const close = () => { picker?.destroy(); overlay.remove(); };

  const mapLat = pos?.lat ?? null, mapLng = pos?.lng ?? null;
  createMapPicker(overlay.querySelector('[data-m="map"]'), {
    lat: mapLat, lng: mapLng,
    onChange: (p) => { pos = p; source = "manual"; quality = "tacno"; status.textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`; },
  }).then(async (p) => {
    picker = p;
    // Nema koordinata: pokušaj automatski da bi se mapa otvorila blizu adrese
    if (!pos && address) overlay.querySelector('[data-act="auto"]').click();
  }).catch(() => { status.textContent = t("geo_map_unavailable"); });

  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay) return close();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") close();
    if (act === "gmaps") window.open(pos ? mapsPointUrl(pos.lat, pos.lng) : mapsSearchUrl(address), "_blank", "noopener");
    if (act === "auto") {
      status.textContent = t("geo_searching");
      try {
        const hit = await geocodeAddress(address);
        if (!hit) { status.textContent = `❌ ${t("geo_not_found")}`; return; }
        pos = { lat: hit.lat, lng: hit.lng }; source = "auto"; quality = hit.quality;
        picker?.setPosition(hit.lat, hit.lng);
        status.textContent = `${hit.quality === "tacno" ? "✅" : "⚠"} ${t(`geo_q_${hit.quality}`)} — ${t("geo_map_hint")}`;
      } catch (err) { console.error(err); status.textContent = `❌ ${t("geo_service_error")}`; }
    }
    if (act === "save") {
      if (!pos) { status.textContent = t("geo_pick_first"); return; }
      try {
        await onSave(source === "manual" ? manualFields(pos) : { lat: pos.lat, lng: pos.lng, geoSource: "auto", geoQuality: quality, geoUpdatedAt: serverTimestamp() });
        toast(t("geo_saved"), "success");
        close();
      } catch (err) { console.error(err); toast(err.message || t("geo_service_error"), "error"); }
    }
  });
}

// --- Masovno određivanje koordinata -----------------------------------------------------------
// items = [{ label, address, lat, lng, save(polja), ...ostalo }]. Obrađuju se samo one BEZ koordinata (1 zahtev/s).
// Vraća redove za tabelu: { item, status: "ok"|"approx"|"none"|"skipped" }.
export async function geocodeMissing(items, { onProgress } = {}) {
  const rows = [];
  const todo = items.filter((it) => !hasCoords(it));
  items.filter((it) => hasCoords(it)).forEach((it) => rows.push({ item: it, status: geoStatus(it), already: true }));
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    onProgress?.(i + 1, todo.length, it.label);
    if (!it.address) { rows.push({ item: it, status: "none" }); continue; }
    try {
      const hit = await geocodeAddress(it.address);
      if (!hit) { rows.push({ item: it, status: "none" }); continue; }
      const f = geoFields(hit);
      await it.save(f);
      Object.assign(it, { lat: hit.lat, lng: hit.lng, geoSource: "auto", geoQuality: hit.quality });
      rows.push({ item: it, status: hit.quality === "tacno" ? "ok" : "approx" });
    } catch (err) {
      console.error(err);
      rows.push({ item: it, status: "none" });
    }
  }
  return rows;
}

// Tabela rezultata ✅ / ⚠ / ❌ sa dugmetom [Podesi] (mapa). Prikazuje samo obrađene (nove) i sve ⚠/❌.
export function showBatchResults(rows, { onChanged } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = 250;
  const counts = { ok: 0, approx: 0, none: 0 };
  rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const shown = rows.filter((r) => !r.already || r.status !== "ok");
  const icon = { ok: "✅", approx: "⚠", none: "❌" };
  overlay.innerHTML = `
    <div class="modal-card wide">
      <div class="modal-head"><h2>${t("geo_results_title")}</h2><button type="button" class="icon-btn" data-act="close">✕</button></div>
      <p class="muted">✅ ${counts.ok} · ⚠ ${counts.approx} · ❌ ${counts.none}</p>
      <div class="table-wrap"><table class="data-table"><tbody>
        ${shown.length ? shown.map((r, i) => `
          <tr><td>${icon[r.status]}</td>
          <td><strong>${escapeHtml(r.item.label)}</strong><div class="muted" style="font-size:12px;">${escapeHtml(r.item.address || "—")}</div></td>
          <td><button type="button" class="btn btn-sm btn-outline" data-set="${i}">${t("geo_adjust_btn")}</button></td></tr>`).join("")
          : `<tr class="empty-row"><td>${t("geo_all_ok")}</td></tr>`}
      </tbody></table></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-act=close]")) { overlay.remove(); onChanged?.(); return; }
    const b = e.target.closest("[data-set]");
    if (!b) return;
    const it = shown[Number(b.dataset.set)].item;
    openCoordsEditor({
      title: it.label, address: it.address, lat: it.lat, lng: it.lng,
      onSave: async (f) => { await it.save(f); Object.assign(it, f); b.closest("tr").firstElementChild.textContent = "✅"; },
    });
  });
}
