// ============================================================================
// GEO — koordinate adresa (OpenStreetMap/Nominatim), udaljenosti i redosled
// stanica (najkraća ruta, računa se lokalno — bez spoljnih servisa za rutiranje)
// i linkovi za Google Maps. Besplatno, bez API ključeva. Nema uvoza (ni Firebase ni
// i18n), pa se čista logika testira u Node-u: node tests/geo-logic.test.mjs
//
// Nominatim: najviše 1 upit u sekundi (ovde se čuva razmak od 1,1 s); ista adresa
// se čuva u kešu pregledača da se ne traži dvaput.
// Udaljenosti su PROCENA: vazdušna linija × 1,3 (koeficijent puta). Tačnu rutu i
// vreme računa Google Maps kad se ruta otvori.
// ============================================================================

// Ograničenje pretrage geokodiranja na državu (ISO kod). Prazan string = bez ograničenja.
export const GEO_COUNTRY = "rs";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Do ovolikog broja stanica traži se TAČAN najkraći redosled (Held-Karp), preko toga heuristika.
export const EXACT_MAX_STOPS = 12;
// Google Maps link prima najviše 9 usputnih tačaka (waypoints) + odredište.
export const MAX_WAYPOINTS_PER_LINK = 9;

// --- Osnovne funkcije ---------------------------------------------------------
export function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}
export function hasCoords(o) { return !!o && isValidCoord(Number(o.lat), Number(o.lng)); }

export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function fmtKm(m) {
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
export function fmtMinutes(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// --- Čitanje koordinata iz teksta / Google Maps linka -----------------------------
// Prihvata: "44.8125, 20.4612" | "44.8125 20.4612" | "44.8125°N 20.4612°E" |
// pun Google Maps link (.../@44.81,20.46,17z... ili ...!3d44.81!4d20.46 ili ?q=44.81,20.46).
// Kratki linkovi (maps.app.goo.gl) se NE mogu pročitati bez otvaranja — tada vraća null.
export function parseCoords(text) {
  if (text == null) return null;
  let s = String(text).trim();
  if (!s) return null;
  try { s = decodeURIComponent(s); } catch { /* ostavi kako jeste */ }
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const tries = [
    new RegExp(`!3d${num}!4d${num}`),                                  // tačna pin pozicija
    new RegExp(`@${num},${num}`),                                      // centar prikaza
    new RegExp(`[?&](?:q|ll|query|destination|center)=${num}\\s*,\\s*${num}`),
    new RegExp(`^${num}\\s*°?\\s*[NnSs]?\\s*[,;\\s]\\s*${num}\\s*°?\\s*[EeWwIi]?$`),
  ];
  for (const re of tries) {
    const m = s.match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }
  return null;
}

// --- Google Maps linkovi -----------------------------------------------------------
// Tačka je ili {lat,lng} ili tekst adrese (stanice bez koordinata idu po adresi)
const fmtPt = (p) => (typeof p === "string" ? p : `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`);
export function mapsPointUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fmtPt({ lat, lng }))}`;
}
export function mapsSearchUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
}

// ordered: tačke stanica po redosledu; origin: tačka polaska ili null (= trenutna lokacija telefona);
// endPoint: tačka završetka ili null (ruta se završava na poslednjoj stanici).
// Ako ima više tačaka nego što staje u jedan link, deli se na delove (svaki sledeći kreće gde se prethodni završio).
export function buildGoogleMapsUrls({ origin = null, ordered, endPoint = null }) {
  const seq = [...ordered, ...(endPoint ? [endPoint] : [])];
  const chunks = [];
  const size = MAX_WAYPOINTS_PER_LINK + 1; // usputne + odredište
  for (let i = 0; i < seq.length; i += size) chunks.push(seq.slice(i, i + size));
  let prev = origin;
  return chunks.map((chunk) => {
    const dest = chunk[chunk.length - 1];
    const via = chunk.slice(0, -1);
    const p = new URLSearchParams({ api: "1", destination: fmtPt(dest), travelmode: "driving", dir_action: "navigate" });
    if (prev) p.set("origin", fmtPt(prev));
    if (via.length) p.set("waypoints", via.map(fmtPt).join("|"));
    prev = dest;
    return { url: `https://www.google.com/maps/dir/?${p.toString()}`, stops: chunk.length };
  });
}

// --- Geokodiranje (Nominatim) ---------------------------------------------------------
let lastCallAt = 0;
let queue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheGet(key) {
  try { return JSON.parse(globalThis.localStorage?.getItem(`geo:${key}`) || "null"); } catch { return null; }
}
function cacheSet(key, value) {
  try { globalThis.localStorage?.setItem(`geo:${key}`, JSON.stringify(value)); } catch { /* pun / nedostupan keš */ }
}

async function nominatim(q, fetchFn) {
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", addressdetails: "0", q, "accept-language": "sr-Latn" });
  if (GEO_COUNTRY) params.set("countrycodes", GEO_COUNTRY);
  const res = await fetchFn(`${NOMINATIM_URL}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
  if (!isValidCoord(lat, lng)) return null;
  return { lat, lng, label: hit.display_name || "", quality: qualityOf(hit) };
}

// geoQuality: "tacno" (kuća/zgrada/objekat), "ulica" (ulica ili put), "naselje" (naselje, grad, opština...)
export function qualityOf(hit) {
  const t = String(hit?.addresstype || hit?.type || "").toLowerCase();
  const c = String(hit?.category || hit?.class || "").toLowerCase();
  if (["house", "building", "apartments", "residential", "yes", "commercial", "retail", "industrial", "office", "shop", "amenity", "warehouse"].includes(t) || c === "building" || c === "shop" || c === "amenity" || c === "office") return "tacno";
  if (["road", "street", "footway", "pedestrian", "service", "residential_road", "tertiary", "secondary", "primary", "unclassified", "living_street"].includes(t) || c === "highway") return "ulica";
  return "naselje";
}

// Bez broja kuće i dodataka (bb, sprat, ulaz...) — za slučaj da tačan broj nije u OSM-u.
export function stripHouseNumber(address) {
  return String(address || "")
    .replace(/\b(bb|b\.b\.)\b/gi, " ")
    .replace(/\b\d+[a-zA-Z]?(?:\s*[\/-]\s*\d+[a-zA-Z]?)*\b(?=\s*(?:,|$))/g, " ")
    .replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

// Vraća { lat, lng, source: "auto", quality: "tacno"|"ulica"|"naselje", label } ili null ako adresa nije nađena.
// Ako tačan broj kuće nije u OSM-u, traži se ulica bez broja (kvalitet se tada spušta najviše na "ulica").
export function geocodeAddress(address, { fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  const addr = String(address || "").trim();
  if (!addr) return Promise.resolve(null);
  const key = addr.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  const job = queue.then(async () => {
    const wait = lastCallAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    let hit = await nominatim(addr, fetchFn);
    if (!hit) {
      const simple = stripHouseNumber(addr);
      if (simple && simple.toLowerCase() !== key) {
        await sleep(1100); lastCallAt = Date.now();
        hit = await nominatim(simple, fetchFn);
        if (hit && hit.quality === "tacno") hit.quality = "ulica";
      }
    }
    if (!hit) return null;
    const out = { lat: hit.lat, lng: hit.lng, source: "auto", quality: hit.quality, label: hit.label };
    cacheSet(key, out);
    return out;
  });
  queue = job.catch(() => {});
  return job;
}

// --- Matrica rastojanja i vremena ------------------------------------------------------
// points: [{lat,lng}, ...]. Vraća { distances (m), durations (s), estimated }.
export function haversineMatrix(points, { roadFactor = 1.3, speedKmh = 40 } = {}) {
  const n = points.length;
  const distances = Array.from({ length: n }, () => Array(n).fill(0));
  const durations = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const m = haversineKm(points[i], points[j]) * 1000 * roadFactor;
    distances[i][j] = m;
    durations[i][j] = (m / 1000 / speedKmh) * 3600;
  }
  return { distances, durations, estimated: true };
}

// --- Redosled stanica -----------------------------------------------------------------
// cost: matrica troška (metri ili sekunde). Indeksi: 0 = polazna tačka, 1..n = stanice,
// n+1 = zasebna završna tačka (samo za endMode "point").
// endMode: "start" (povratak na polaznu), "free" (završava na poslednjoj stanici), "point" (n+1).
// Vraća redosled kao niz indeksa stanica (1..n).
export function solveOrder(cost, n, endMode = "free") {
  if (n <= 0) return [];
  const endIdx = endMode === "start" ? 0 : endMode === "point" ? n + 1 : -1;
  const fin = (i) => (endIdx < 0 ? 0 : cost[i][endIdx]);
  if (n === 1) return [1];
  return n <= EXACT_MAX_STOPS ? heldKarp(cost, n, fin) : heuristic(cost, n, fin);
}

function heldKarp(cost, n, fin) {
  const full = 1 << n;
  const dp = new Float64Array(full * n).fill(Infinity);
  const par = new Int8Array(full * n).fill(-1);
  for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = cost[0][i + 1];
  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < n; last++) {
      const cur = dp[mask * n + last];
      if (!(mask & (1 << last)) || cur === Infinity) continue;
      for (let nxt = 0; nxt < n; nxt++) {
        if (mask & (1 << nxt)) continue;
        const nm = mask | (1 << nxt);
        const v = cur + cost[last + 1][nxt + 1];
        if (v < dp[nm * n + nxt]) { dp[nm * n + nxt] = v; par[nm * n + nxt] = last; }
      }
    }
  }
  let best = Infinity, bestLast = 0;
  for (let last = 0; last < n; last++) {
    const v = dp[(full - 1) * n + last] + fin(last + 1);
    if (v < best) { best = v; bestLast = last; }
  }
  const order = [];
  let mask = full - 1, last = bestLast;
  while (last !== -1) {
    order.push(last + 1);
    const p = par[mask * n + last];
    mask &= ~(1 << last);
    last = p;
  }
  return order.reverse();
}

export function pathCost(cost, order, fin) {
  if (!order.length) return 0;
  let c = cost[0][order[0]];
  for (let i = 0; i < order.length - 1; i++) c += cost[order[i]][order[i + 1]];
  return c + fin(order[order.length - 1]);
}

function heuristic(cost, n, fin) {
  // najbliži sused iz polazne tačke, pa 2-opt poboljšanja
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const order = [];
  let cur = 0;
  while (left.size) {
    let best = -1, bv = Infinity;
    for (const j of left) if (cost[cur][j] < bv) { bv = cost[cur][j]; best = j; }
    order.push(best); left.delete(best); cur = best;
  }
  let improved = true, best = pathCost(cost, order, fin), guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c = pathCost(cost, cand, fin);
        if (c + 1e-9 < best) { order.splice(0, n, ...cand); best = c; improved = true; }
      }
    }
  }
  return order;
}

// Sastavlja pregled deonica po izračunatom redosledu.
// matrix: { distances, durations }; legs[i] = { fromIdx, toIdx, meters, seconds }
export function buildLegs(matrix, order, endMode, n) {
  const idxs = [0, ...order];
  if (endMode === "start") idxs.push(0);
  else if (endMode === "point") idxs.push(n + 1);
  const legs = [];
  for (let i = 0; i < idxs.length - 1; i++) {
    legs.push({ fromIdx: idxs[i], toIdx: idxs[i + 1], meters: matrix.distances[idxs[i]][idxs[i + 1]], seconds: matrix.durations[idxs[i]][idxs[i + 1]] });
  }
  return {
    legs,
    totalMeters: legs.reduce((s, l) => s + l.meters, 0),
    totalSeconds: legs.reduce((s, l) => s + l.seconds, 0),
  };
}

// --- Stanice rute iz narudžbina ---------------------------------------------------------
// orders: [{ id, orderNumber, items:[{supplierId, supplierName, pickupLocationId, purchaseStatus}],
//            deliveryLocations:[{locationId, locationName, status}] }]
// suppliersById: { id: {name, address} }; supplierLocsById: { supplierId: [{id,name,address,lat,lng}] };
// companyLocsById: { id: {name,address,lat,lng} }
// Vraća { pickups, deliveries }: svaka stanica { key, kind, name, address, lat, lng, hasCoords, orders:[{orderId,orderNumber,count}] }.
// Ista lokacija u više narudžbina = jedna stanica. Kupljene/nenađene stavke ne ulaze u preuzimanja;
// narudžbina bez preostalih preuzimanja ulazi samo isporukama. Isporuke koje su već isporučene se preskaču.
export function buildStops({ orders, suppliersById = {}, supplierLocsById = {}, companyLocsById = {} }) {
  const pickups = new Map(), deliveries = new Map();
  const add = (map, base, order) => {
    let st = map.get(base.key);
    if (!st) { st = { ...base, hasCoords: hasCoords(base), orders: [] }; map.set(base.key, st); }
    let o = st.orders.find((x) => x.orderId === order.id);
    if (!o) { o = { orderId: order.id, orderNumber: order.orderNumber || order.id, count: 0 }; st.orders.push(o); }
    o.count += 1;
  };

  for (const order of orders) {
    for (const item of order.items || []) {
      if (item.purchaseStatus && item.purchaseStatus !== "na_cekanju") continue;
      const sup = suppliersById[item.supplierId] || {};
      const locs = supplierLocsById[item.supplierId] || [];
      const supName = item.supplierName || sup.name || "?";
      let loc = null;
      if (item.pickupLocationId && item.pickupLocationId !== "any") loc = locs.find((l) => l.id === item.pickupLocationId) || null;
      if (!loc) loc = locs.find(hasCoords) || null;      // "bilo koja lokacija": prva sa koordinatama
      const base = loc
        ? { key: `p:${item.supplierId}:${loc.id}`, kind: "pickup", name: `${supName} – ${loc.name}`, address: loc.address || sup.address || "", lat: loc.lat, lng: loc.lng }
        : { key: `p:${item.supplierId}:main`, kind: "pickup", name: supName, address: sup.address || locs.find((l) => l.address)?.address || "", lat: null, lng: null };
      add(pickups, base, order);
    }
    for (const dl of order.deliveryLocations || []) {
      if (dl.status && dl.status !== "ceka") continue;
      const cl = companyLocsById[dl.locationId] || {};
      const base = { key: `d:${dl.locationId || dl.locationName}`, kind: "delivery", name: dl.locationName || cl.name || "?", address: cl.address || "", lat: cl.lat, lng: cl.lng };
      add(deliveries, base, order);
    }
  }
  return { pickups: [...pickups.values()], deliveries: [...deliveries.values()] };
}

const ROAD_FACTOR = 1.3;
// Redosled jedne grupe stanica od tačke polaska (start može biti null = nepoznato, tada je polazak "slobodan").
// Stanice bez koordinata idu na kraj grupe (ne mogu se uporediti), po adresi.
export function orderGroup(start, group) {
  const withC = group.filter((s) => s.hasCoords), without = group.filter((s) => !s.hasCoords);
  if (withC.length > 1) {
    const pts = [start || withC[0], ...withC];
    const cost = haversineMatrix(pts, { roadFactor: 1 }).distances;
    if (!start) for (let j = 0; j < cost.length; j++) cost[0][j] = 0;
    const order = solveOrder(cost, withC.length, "free");
    return [...order.map((i) => withC[i - 1]), ...without];
  }
  return [...withC, ...without];
}

// Prvo sva preuzimanja, pa sve isporuke — roba je uvek preuzeta pre isporuke.
export function planRoute({ start = null, pickups, deliveries }) {
  const p = orderGroup(start, pickups);
  const lastP = [...p].reverse().find((s) => s.hasCoords) || null;
  const d = orderGroup(lastP || start, deliveries);
  return [...p, ...d];
}

// Približna dužina (m) po redosledu, vazdušna linija × 1,3; stanice bez koordinata se preskaču.
export function routeMeters(start, stops) {
  let prev = start && hasCoords(start) ? start : null, m = 0;
  for (const s of stops) {
    if (!s.hasCoords) continue;
    if (prev) m += haversineKm(prev, s) * 1000 * ROAD_FACTOR;
    prev = s;
  }
  return m;
}

// Pomeranje stanice za jedno mesto — ne preko granice preuzimanja/isporuka.
export function moveStop(list, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= list.length || list[j].kind !== list[index].kind) return list;
  const out = [...list];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}

// Tačke za Google link: koordinate ako postoje, inače tekst adrese (ili naziv).
export function stopsToPoints(stops) {
  return stops.map((s) => (s.hasCoords ? { lat: Number(s.lat), lng: Number(s.lng) } : (s.address || s.name)));
}
