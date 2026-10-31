// ============================================================================
// QR KOD — Poglavlje 11.1: svaka narudžbina dobija jedinstveni QR kod koji
// vodi na order-detail.html?order=ID&confirm=1 (otvara ekran potvrde prijema)
// Koristi lagani CDN generator (qrcode-generator), bez build alata.
// ============================================================================

let libPromise = null;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return libPromise;
}

export function orderQrUrl(companyId, orderId) {
  const base = window.location.origin + window.location.pathname.replace(/[^/]+$/, "");
  return `${base}order-detail.html?company=${companyId}&order=${orderId}&confirm=1`;
}

// Renderuje QR kod u dati DOM element (div)
export async function renderQrCode(el, text) {
  await loadQrLib();
  el.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(el, { text, width: 160, height: 160, colorDark: "#0f172a", colorLight: "#ffffff" });
}
