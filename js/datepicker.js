// ============================================================================
// datepicker.js — lagani date-picker (kalendar na klik), bez spoljnih biblioteka
// (aplikacija je PWA i radi offline, pa ne koristimo CDN pakete).
//
// UPOTREBA:
//   <input type="text" class="js-datepicker" data-value="2026-07-24" />
//   ...
//   import { initDatepickers, getISO, setISO } from "./datepicker.js";
//   initDatepickers(container); // pozvati posle svakog dinamičkog renderovanja
//
// - Prikaz korisniku je UVEK u lokalnom formatu dd.mm.gggg. (bez obzira na
//   podešavanja jezika/regiona u browseru korisnika).
// - Stvarna vrednost (za slanje u bazu / ostatak koda) je uvek ISO string
//   "yyyy-mm-dd", dostupna preko input.dataset.iso ili getISO(input).
// - Klik ili fokus na polje otvara kalendar; može se i ručno kucati
//   (auto-formatiranje dok korisnik kuca).
// ============================================================================

import { t } from "./i18n.js";

const MESEC_KEYS = [
  "month_jan", "month_feb", "month_mar", "month_apr", "month_may", "month_jun",
  "month_jul", "month_aug", "month_sep", "month_oct", "month_nov", "month_dec",
];
const DAN_KEYS = ["day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat", "day_sun"];
const meseci = () => MESEC_KEYS.map((k) => t(k));
const dani = () => DAN_KEYS.map((k) => t(k));

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDanas() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidIso(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00`);
  return !isNaN(d);
}

// "2026-07-24" -> "24.07.2026."
function isoToDisplay(iso) {
  if (!isValidIso(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}.`;
}

// "24.07.2026." ili "24.7.2026" ili "24072026" (u toku kucanja) -> "2026-07-24" ili ""
function displayToIso(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (!match) return "";
  const [, dS, mS, yS] = match;
  const d = Number(dS), m = Number(mS), y = Number(yS);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function getISO(input) {
  return input?.dataset.iso || "";
}

export function setISO(input, iso) {
  if (!input) return;
  const clean = isValidIso(iso) ? iso : "";
  input.dataset.iso = clean;
  input.value = isoToDisplay(clean);
}

function zatvoriSvePopover() {
  document.querySelectorAll(".dp-popover").forEach((el) => el.remove());
  document.removeEventListener("mousedown", dpOutsideClickHandler, true);
}

let dpOutsideClickHandler = null;

function otvoriKalendar(input) {
  zatvoriSvePopover();

  const trenutniIso = getISO(input);
  const start = isValidIso(trenutniIso) ? new Date(`${trenutniIso}T00:00:00`) : new Date();
  let viewGodina = start.getFullYear();
  let viewMesec = start.getMonth();

  const pop = document.createElement("div");
  pop.className = "dp-popover";

  function nacrtaj() {
    const prviDan = new Date(viewGodina, viewMesec, 1);
    const pomeraj = (prviDan.getDay() + 6) % 7; // ponedeljak = 0
    const brDana = new Date(viewGodina, viewMesec + 1, 0).getDate();
    const selektovano = getISO(input);
    const danas = isoDanas();

    let celije = "";
    for (let i = 0; i < pomeraj; i++) celije += `<span class="dp-cell dp-empty"></span>`;
    for (let dan = 1; dan <= brDana; dan++) {
      const cellIso = `${viewGodina}-${pad2(viewMesec + 1)}-${pad2(dan)}`;
      const klase = ["dp-cell", "dp-day"];
      if (cellIso === danas) klase.push("dp-today");
      if (cellIso === selektovano) klase.push("dp-selected");
      celije += `<button type="button" class="${klase.join(" ")}" data-iso="${cellIso}">${dan}</button>`;
    }

    pop.innerHTML = `
      <div class="dp-head">
        <button type="button" class="dp-nav" data-nav="-1" aria-label="${t('prev_month_aria')}">‹</button>
        <span class="dp-title">${meseci()[viewMesec]} ${viewGodina}</span>
        <button type="button" class="dp-nav" data-nav="1" aria-label="${t('next_month_aria')}">›</button>
      </div>
      <div class="dp-grid dp-grid-dow">${dani().map((d) => `<span class="dp-dow">${d}</span>`).join("")}</div>
      <div class="dp-grid">${celije}</div>
      <div class="dp-foot">
        <button type="button" class="dp-foot-btn dp-clear">${t("delete")}</button>
        <button type="button" class="dp-foot-btn dp-today-btn">${t("today")}</button>
      </div>
    `;

    pop.querySelectorAll(".dp-nav").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewMesec += Number(btn.dataset.nav);
        if (viewMesec < 0) { viewMesec = 11; viewGodina--; }
        if (viewMesec > 11) { viewMesec = 0; viewGodina++; }
        nacrtaj();
      });
    });
    pop.querySelectorAll(".dp-day").forEach((btn) => {
      btn.addEventListener("click", () => {
        setISO(input, btn.dataset.iso);
        input.dispatchEvent(new Event("change", { bubbles: true }));
        zatvoriSvePopover();
      });
    });
    pop.querySelector(".dp-clear").addEventListener("click", () => {
      setISO(input, "");
      input.dispatchEvent(new Event("change", { bubbles: true }));
      zatvoriSvePopover();
    });
    pop.querySelector(".dp-today-btn").addEventListener("click", () => {
      setISO(input, isoDanas());
      input.dispatchEvent(new Event("change", { bubbles: true }));
      zatvoriSvePopover();
    });
  }

  nacrtaj();
  document.body.appendChild(pop);

  const rect = input.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = window.scrollY + rect.bottom + 6;
  let left = window.scrollX + rect.left;
  if (left + popRect.width > window.scrollX + document.documentElement.clientWidth - 8) {
    left = window.scrollX + rect.right - popRect.width;
  }
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  dpOutsideClickHandler = (e) => {
    if (!pop.contains(e.target) && e.target !== input) zatvoriSvePopover();
  };
  document.addEventListener("mousedown", dpOutsideClickHandler, true);
}

function povezi(input) {
  if (input.dataset.dpInit) return;
  input.dataset.dpInit = "1";

  input.classList.add("date-input");
  input.type = "text";
  input.setAttribute("placeholder", "dd.mm.gggg.");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("inputmode", "numeric");

  // Početna vrednost: data-value (ISO), ili postojeći .value ako je već ISO
  // (kompatibilnost sa starim <input type="date"> vrednostima).
  const pocetno = input.dataset.value || (isValidIso(input.value) ? input.value : "");
  setISO(input, pocetno);

  input.addEventListener("focus", () => otvoriKalendar(input));
  input.addEventListener("click", () => otvoriKalendar(input));

  input.addEventListener("input", () => {
    const cifre = input.value.replace(/\D/g, "").slice(0, 8);
    let out = cifre;
    if (cifre.length > 2) out = `${cifre.slice(0, 2)}.${cifre.slice(2)}`;
    if (cifre.length > 4) out = `${cifre.slice(0, 2)}.${cifre.slice(2, 4)}.${cifre.slice(4)}`;
    input.value = out;
  });

  input.addEventListener("blur", () => {
    const iso = displayToIso(input.value);
    setISO(input, iso);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") zatvoriSvePopover();
  });
}

export function initDatepickers(root = document) {
  root.querySelectorAll(".js-datepicker").forEach(povezi);
}

document.addEventListener("DOMContentLoaded", () => initDatepickers());
