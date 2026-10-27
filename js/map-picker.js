// ============================================================================
// MAP-PICKER — OpenStreetMap mapa (Leaflet) sa markerom koji se prevlači.
// Klik na mapu ili prevlačenje markera → onChange({ lat, lng }).
// Leaflet se učitava sa CDN-a tek kad zatreba (nema build alata).
// ============================================================================
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4";
let loading = null;

function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = `${LEAFLET}/leaflet.min.css`;
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = `${LEAFLET}/leaflet.min.js`;
    js.onload = () => { globalThis.L.Icon.Default.imagePath = `${LEAFLET}/images/`; resolve(globalThis.L); };
    js.onerror = () => { loading = null; reject(new Error("Leaflet")); };
    document.head.appendChild(js);
  });
  return loading;
}

// container: element sa zadatom visinom. Vraća { setPosition(lat,lng), getPosition(), destroy() }.
export async function createMapPicker(container, { lat = null, lng = null, onChange } = {}) {
  const L = await loadLeaflet();
  const has = Number.isFinite(lat) && Number.isFinite(lng);
  const map = L.map(container).setView(has ? [lat, lng] : [44.0, 21.0], has ? 17 : 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap",
  }).addTo(map);
  let marker = null;
  const place = (la, ln, notify) => {
    if (!marker) {
      marker = L.marker([la, ln], { draggable: true }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); onChange?.({ lat: p.lat, lng: p.lng }); });
    } else marker.setLatLng([la, ln]);
    if (notify) onChange?.({ lat: la, lng: ln });
  };
  if (has) place(lat, lng, false);
  map.on("click", (e) => place(e.latlng.lat, e.latlng.lng, true));
  // Mapa je često prvi put prikazana u skrivenom/novom prozoru — osveži dimenzije
  setTimeout(() => map.invalidateSize(), 80);
  return {
    setPosition(la, ln) { place(la, ln, false); map.setView([la, ln], 17); },
    getPosition() { if (!marker) return null; const p = marker.getLatLng(); return { lat: p.lat, lng: p.lng }; },
    destroy() { map.remove(); },
  };
}
