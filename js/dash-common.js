// ============================================================================
// DASH-COMMON — zajednički kontroler kontrolnih tabli Naručioca i Isporučioca.
// Jednom napisano: kartice (filteri + vizuelni podsetnik), pravilo "kasne",
// tabela sa paginacijom ("Učitaj još"), pretraga cele istorije, akcije u redu,
// minutni tajmer. Admin tabla koristi samo isLate() iz dash-logic.js.
//
// Podaci: otvorene narudžbine (uživo) + zatvorene u poslednja 2 dana (uživo, za "Danas
// završeno") + cela istorija po datumu kreiranja u turama po 30 ("Učitaj još") + ukupan
// broj iz baze. "Prikazano X od Y": Y je uvek ukupno za trenutni kriterijum (nema filtera =
// sve narudžbine korisnika; kartica/pretraga = broj koji odgovara tom filteru).
// ============================================================================
import { t } from "./i18n.js";
import { initDatepickers, getISO, setISO } from "./datepicker.js";
import { escapeHtml, formatDate, badgeClassForStatus, statusLabel, toast } from "./utils.js";
import { listenOpenOrdersBy, listenRecentClosedBy, getOrdersPageBy, getAllOrdersBy, countOrdersBy } from "./orders.js";
import {
  PAGE_SIZE, CLOSED_LIVE_HOURS, SEARCH_CACHE_MS, CLOSED_STATUSES,
  isLate, lateInfo, dayKey, durationParts, parseCriteria, matchesSearch, compareByCreatedDesc,
  OUTCOME_STATUSES, periodPresets, allViewList, toMillis,
} from "./dash-logic.js";

export { isLate, lateInfo } from "./dash-logic.js";

// --- Definicije kartica -------------------------------------------------------
// Ista predikat-funkcija se koristi za broj na kartici i za filter tabele, pa
// broj na kartici uvek odgovara broju redova kad se kartica izabere.
export const CARD_DEFS = {
  all: { labelKey: "my_orders", color: "", predicate: () => true },
  awaiting_assign: { labelKey: "dash_awaiting_assign", color: "amber", attention: true, predicate: (o) => o.status === "kreirana" },
  awaiting_accept: { labelKey: "dash_awaiting_accept", color: "amber", attention: true, predicate: (o) => o.status === "ceka_prihvatanje" },
  awaiting_confirm: { labelKey: "dash_awaiting_confirm", color: "amber", attention: true, predicate: (o) => o.status === "isporucena" },
  claims: { labelKey: "dash_claims", color: "red", attention: true, predicate: (o) => o.status === "reklamacija" },
  late: { labelKey: "late", color: "red", attention: false, predicate: (o, now) => isLate(o, now) },
  active_deliveries: { labelKey: "dash_active_deliveries", color: "", attention: false, predicate: (o) => !CLOSED_STATUSES.includes(o.status) },
  in_purchase: { labelKey: "in_purchase", color: "amber", attention: false, predicate: (o) => o.status === "u_nabavci" },
  finished_today: {
    labelKey: "finished_today", color: "teal", attention: false,
    predicate: (o, now) => o.status === "zatvorena" && dayKey(o.closedAt || o.updatedAt) === dayKey(now),
  },
};

// --- Pomoćni HTML za ćelije -----------------------------------------------------
export function formatDurationText(ms) {
  const { d, h, m } = durationParts(ms);
  if (d > 0) return `${d}${t("unit_d")} ${h}${t("unit_h")}`;
  if (h > 0) return m ? `${h}${t("unit_h")} ${m}${t("unit_min")}` : `${h}${t("unit_h")}`;
  return `${Math.max(1, m)} ${t("unit_min")}`;
}
export function lateTagHtml(o, now = Date.now()) {
  const info = lateInfo(o, now);
  if (!info) return "";
  return `<span class="late-tag" data-late-id="${escapeHtml(o.id)}">${t("late_by", { time: formatDurationText(info.overdueMs) })}</span>`;
}
export function statusCellHtml(o, { showReason = false, now = Date.now() } = {}) {
  const reason = showReason && o.status === "odbijena" && o.rejectionReason
    ? `<span class="reject-reason">${t("dash_rejection_reason")}: ${escapeHtml(o.rejectionReason)}</span>` : "";
  return `<span class="badge ${badgeClassForStatus(o.status)}">${statusLabel(o.status)}</span>${lateTagHtml(o, now)}${reason}`;
}
export function priorityCellHtml(o) {
  return o.priority === "hitno"
    ? `<span class="badge badge-urgent">${t("urgent")}</span>`
    : `<span class="badge badge-gray">${t("standard")}</span>`;
}
export const closedCellHtml = (o) => (CLOSED_STATUSES.includes(o.status) && (o.closedAt || o.updatedAt)
  ? formatDate(o.closedAt || o.updatedAt) : t("not_closed_yet"));
export const listCellHtml = (arr) => (arr && arr.length ? escapeHtml(arr.join(", ")) : "—");

const byId = (...lists) => {
  const map = new Map();
  lists.forEach((list) => list.forEach((o) => map.set(o.id, o)));
  return map;
};
const $ = (id) => document.getElementById(id);

// --- Kontroler ----------------------------------------------------------------
// cfg: {
//   companyId, uid, ownerField ("createdByUid" | "assignedToUid"),
//   cardKeys: [...],           // redosled kartica
//   columns: [{ headKey, cls, render(o, ctx) }],
//   compare: (now) => (a, b) => number,
//   activeOnlyDefault: bool,   // isporučilac: podrazumevano samo aktivne + "Prikaži sve"
//   rowClass: (o) => string,
//   isAttention: (o, now) => bool,   // blok "Zahteva pažnju" na vrhu liste (odvojen linijom)
//   actions: { name: async (order) => void },   // data-action dugmad u redu
//   emptyKey: string,
// }
export function createDashboard(cfg) {
  const S = {
    open: [], today: [], pages: [], pageCursor: null, exhausted: false, loadingPage: false,
    gotPage: false, total: null, totalLoading: false, openSig: null, // total = ukupan broj narudžbina korisnika (iz baze)
    gotOpen: false, gotToday: false,
    filter: "all", showAll: !cfg.activeOnlyDefault, visible: PAGE_SIZE,
    searching: false, results: [], searchCache: null, searchCacheKey: "", searchCacheAt: 0, searchCapped: false, searchSeq: 0, searchLoading: false, lastSig: "",
    chips: { outcome: new Set(), priority: new Set() },
    list: [], now: Date.now(), cardSig: null,
    cutoff: new Date(Date.now() - CLOSED_LIVE_HOURS * 3600000),
  };
  const statHost = $("stat-cards"), chipHost = $("filter-chip"), head = $("orders-head"), body = $("orders-body");
  const pagerHost = $("pager"), toggleBtn = $("toggle-all-btn"), searchInfo = $("search-info");
  const chipsHost = $("filter-chips"), presetsHost = $("period-presets");
  const filtersToggle = $("filters-toggle"), filtersPanel = $("filters-panel"), filtersCount = $("filters-count");
  const inputs = { text: $("search-text"), from: $("search-from"), to: $("search-to") };

  // Kartice i filteri rade nad otvorenim + danas zatvorenim (uživo, pa su brojevi tačni).
  const base = () => Array.from(byId(S.today, S.open).values());
  const liveMap = () => byId(S.pages, S.today, S.open); // novije verzije poslednje, pa pobeđuju
  // Podrazumevani prikaz "sve narudžbine": lista se puni u turama iz baze (ne iz memorije).
  const inAllMode = () => !S.searching && S.filter === "all" && S.showAll;
  const floorMs = () => {
    if (S.exhausted) return -Infinity;
    const last = S.pageCursor?.data?.().createdAt;
    return toMillis(last) ?? Infinity;
  };

  function getPool() {
    if (S.searching) {
      const live = liveMap();
      return S.results.map((o) => live.get(o.id) || o).sort(compareByCreatedDesc);
    }
    if (S.filter !== "all") return base().filter((o) => CARD_DEFS[S.filter].predicate(o, S.now)).sort(cfg.compare(S.now));
    if (S.showAll) {
      return allViewList(Array.from(liveMap().values()), { floorMs: floorMs(), isAttention: cfg.isAttention, compare: cfg.compare, now: S.now });
    }
    return S.open.slice().sort(cfg.compare(S.now)); // samo aktivne (isporučilac, bez "Prikaži sve")
  }

  // ---- Kartice -------------------------------------------------------------
  function renderCards(force = false) {
    const b = base();
    // "Moje narudžbine" = ukupan broj svih narudžbina korisnika (iz baze), ostale kartice broje iz uživo podataka
    const counts = cfg.cardKeys.map((k) => (k === "all" ? (S.total ?? "…") : b.filter((o) => CARD_DEFS[k].predicate(o, S.now)).length));
    const sig = `${counts.join(",")}|${S.filter}|${S.searching}|${dayKey(S.now)}`;
    if (!force && sig === S.cardSig) return false;
    S.cardSig = sig;
    const focusedKey = document.activeElement?.dataset?.filter;
    statHost.innerHTML = cfg.cardKeys.map((k, i) => {
      const def = CARD_DEFS[k];
      const active = !S.searching && S.filter === k;
      const attn = def.attention && Number(counts[i]) > 0;
      return `<div class="stat-card ${def.color}${active ? " active" : ""}${attn ? " attention" : ""}" data-filter="${k}" role="button" tabindex="0" aria-pressed="${active}">
        <div class="stat-label">${t(def.labelKey)}</div><div class="stat-value">${counts[i]}</div></div>`;
    }).join("");
    statHost.querySelectorAll("[data-filter]").forEach((card) => {
      card.addEventListener("click", () => selectFilter(card.dataset.filter));
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFilter(card.dataset.filter); } });
    });
    if (focusedKey) statHost.querySelector(`[data-filter="${focusedKey}"]`)?.focus();
    return true;
  }

  function selectFilter(key) {
    if (S.searching) clearSearch(false);
    S.filter = S.filter === key && key !== "all" ? "all" : key; // drugi klik na istu karticu vraća na "sve"
    S.visible = PAGE_SIZE;
    renderAll();
  }

  function renderChip() {
    if (S.searching || S.filter === "all") { chipHost.innerHTML = ""; return; }
    chipHost.innerHTML = `
      <span class="muted" style="font-size:13px;">${t("showing_filter_label")}: <strong>${t(CARD_DEFS[S.filter].labelKey)}</strong></span>
      <button type="button" class="btn btn-sm btn-ghost" id="reset-filter-btn">${t("show_all_orders_btn")}</button>`;
    $("reset-filter-btn").addEventListener("click", () => selectFilter("all"));
  }

  // ---- Tabela --------------------------------------------------------------
  function renderHead() {
    head.innerHTML = `<tr>${cfg.columns.map((c) => `<th class="${c.cls || ""}">${t(c.headKey)}</th>`).join("")}</tr>`;
  }

  function renderTable() {
    S.list = getPool();
    if (S.searching && S.searchLoading) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length}">${t("dash_search_loading")}</td></tr>`;
      return;
    }
    if (!S.gotOpen || !S.gotToday || (inAllMode() && !S.gotPage)) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length}">${t("loading_ellipsis")}</td></tr>`;
      return;
    }
    const shown = inAllMode() ? S.list : S.list.slice(0, S.visible); // u prikazu "sve" ture dolaze iz baze
    if (!shown.length) {
      const key = S.searching ? "dash_no_search_results" : (S.filter !== "all" ? "no_orders_for_filter" : (cfg.emptyKey || "no_orders_yet"));
      body.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length}">${t(key)}</td></tr>`;
      return;
    }
    const ctx = { now: S.now };
    // Blok "Zahteva pažnju": narudžbine koje su na vrhu zbog razloga, a ne zbog datuma, odvojene
    // bojom, levom ivicom i linijom ispod poslednje. Bez pretrage i bez filtera kartice.
    const grouped = !!cfg.isAttention && !S.searching && S.filter === "all";
    const attn = grouped ? shown.map((o) => cfg.isAttention(o, S.now)) : [];
    const lastAttn = grouped ? attn.lastIndexOf(true) : -1;
    const hasOthers = lastAttn >= 0 && S.list.some((o) => !cfg.isAttention(o, S.now));
    const groupRow = (cls, key) => `<tr class="group-row ${cls}"><td colspan="${cfg.columns.length}"><span class="group-label">${t(key)}</span></td></tr>`;
    const html = [];
    shown.forEach((o, i) => {
      if (i === 0 && attn[0]) html.push(groupRow("attn", "dash_group_attention"));
      const cls = [cfg.rowClass ? cfg.rowClass(o) : "", attn[i] ? "row-attention" : "", i === lastAttn && hasOthers ? "row-attention-last" : ""].filter(Boolean).join(" ");
      html.push(`<tr class="row-link ${cls}" data-id="${escapeHtml(o.id)}" tabindex="0">
        ${cfg.columns.map((c) => `<td class="${c.cls || ""}">${c.render(o, ctx)}</td>`).join("")}
      </tr>`);
      if (i === lastAttn && hasOthers && i < shown.length - 1) html.push(groupRow("", "dash_group_other"));
    });
    body.innerHTML = html.join("");
  }

  function renderPager() {
    // Y = ukupno za trenutni kriterijum: bez filtera — svih narudžbina korisnika (iz baze);
    // sa karticom/pretragom — broj narudžbina koje tom kriterijumu odgovaraju.
    const inList = S.list.length;
    const allMode = inAllMode();
    const shown = allMode ? inList : Math.min(S.visible, inList);
    const total = allMode ? Math.max(S.total ?? 0, inList) : inList;
    const canMore = allMode ? !S.exhausted : S.visible < inList;
    const loading = !S.gotOpen || !S.gotToday || (S.searching && S.searchLoading) || (allMode && !S.gotPage);
    if (loading || (!total && !canMore)) { pagerHost.innerHTML = ""; return; }
    const totalText = allMode && S.total == null ? "…" : total;
    pagerHost.innerHTML = `
      <span class="muted pager-count">${t("dash_showing_count", { shown, total: totalText })}</span>
      ${canMore ? `<button type="button" class="btn btn-sm btn-outline" id="load-more-btn" ${S.loadingPage ? "disabled" : ""}>${S.loadingPage ? t("loading_ellipsis") : t("dash_load_more")}</button>` : ""}`;
    $("load-more-btn")?.addEventListener("click", loadMore);
  }

  function renderToggle() {
    if (!toggleBtn) return;
    toggleBtn.hidden = S.searching;
    toggleBtn.textContent = S.showAll ? t("dash_show_active_only") : t("dash_show_all");
    toggleBtn.setAttribute("aria-pressed", String(S.showAll));
  }

  function renderAll() {
    renderCards(true);
    renderChip();
    renderTable();
    renderPager();
    renderToggle();
    renderSearchInfo();
  }

  // Jedna tura (30) istorije po datumu kreiranja; nova tura se samo dodaje na kraj liste.
  async function loadPage() {
    if (S.loadingPage || S.exhausted) return;
    S.loadingPage = true; renderPager();
    try {
      const res = await getOrdersPageBy(cfg.companyId, cfg.ownerField, cfg.uid, S.pageCursor, PAGE_SIZE);
      S.pages = S.pages.concat(res.orders);
      S.pageCursor = res.cursor || S.pageCursor;
      S.exhausted = !res.hasMore;
    } catch (err) {
      console.error(err);
      toast(t("dash_load_error"), "error");
    } finally {
      S.gotPage = true; S.loadingPage = false;
      renderCards(); renderTable(); renderPager();
    }
  }

  // Ukupan broj narudžbina korisnika (jedan upit brojanja u bazi, bez čitanja dokumenata)
  async function loadTotal() {
    if (S.totalLoading) return;
    S.totalLoading = true;
    try {
      S.total = await countOrdersBy(cfg.companyId, cfg.ownerField, cfg.uid);
    } catch (err) {
      console.error("Brojanje narudžbina:", err);
    } finally {
      S.totalLoading = false;
      renderCards(); renderPager();
    }
  }

  // Podaci za prikaz "sve" (prva tura + ukupan broj) — za isporučioca tek kad izabere "Prikaži sve"
  function ensureAllData() {
    if (!S.gotPage && !S.loadingPage) loadPage();
    if (S.total == null && !S.totalLoading) loadTotal();
  }

  function loadMore() {
    if (inAllMode()) { loadPage(); return; }
    S.visible += PAGE_SIZE; renderTable(); renderPager();
  }

  // ---- Pretraga cele istorije -----------------------------------------------
  const readCriteria = () => parseCriteria({
    text: inputs.text?.value, statuses: [...S.chips.outcome].flatMap((k) => OUTCOME_STATUSES[k]), priorities: [...S.chips.priority],
    from: getISO(inputs.from), to: getISO(inputs.to),
  });

  function renderSearchInfo() {
    if (!searchInfo) return;
    if (S.searching && S.searchLoading) { searchInfo.textContent = t("dash_search_loading"); return; }
    if (!S.searching) { searchInfo.textContent = ""; return; }
    searchInfo.textContent = t("dash_search_results", { count: S.list.length }) + (S.searchCapped ? ` ${t("dash_search_capped")}` : "");
  }

  // Broj aktivnih filtera (dugmići statusa/prioriteta + zadati datumi) na dugmetu "Filteri",
  // da se vidi da su filteri uključeni i kad je panel uvučen. Tekst pretrage se ne računa (stalno je vidljiv).
  function renderFilterCount() {
    if (!filtersCount) return;
    syncPresetHighlight();
    const n = S.chips.outcome.size + S.chips.priority.size + (getISO(inputs.from) ? 1 : 0) + (getISO(inputs.to) ? 1 : 0);
    filtersCount.textContent = String(n);
    filtersCount.hidden = n === 0;
  }

  // force = true: pokreni i kad se kriterijumi nisu promenili (dugme "Primeni", posle akcije u redu)
  async function runSearch(force = false) {
    renderFilterCount();
    const crit = readCriteria();
    const sig = JSON.stringify([crit.tokens, crit.statuses, crit.priorities, crit.fromMs, crit.toMs]);
    if (!force && sig === S.lastSig) return; // npr. datepicker šalje "change" i pri običnom napuštanju polja
    S.lastSig = sig;
    if (!crit.active) { S.searching = false; S.results = []; S.searchSeq++; S.searchLoading = false; S.visible = PAGE_SIZE; renderAll(); return; }
    const seq = ++S.searchSeq;
    S.searching = true; S.filter = "all";
    try {
      // Ako je zadat period (Od/Do), baza vraća samo narudžbine kreirane u tom periodu; bez perioda čita se cela istorija.
      const rangeKey = `${crit.fromMs ?? ""}|${crit.toMs ?? ""}`;
      if (!S.searchCache || S.searchCacheKey !== rangeKey || Date.now() - S.searchCacheAt > SEARCH_CACHE_MS) {
        S.searchLoading = true; renderCards(true); renderTable(); renderPager(); renderSearchInfo();
        const { orders, capped } = await getAllOrdersBy(cfg.companyId, cfg.ownerField, cfg.uid, undefined, { fromMs: crit.fromMs, toMs: crit.toMs });
        if (seq !== S.searchSeq) return; // u međuvremenu je pokrenuta novija pretraga
        S.searchCache = orders; S.searchCacheKey = rangeKey; S.searchCapped = capped; S.searchCacheAt = Date.now();
      }
    } catch (err) {
      console.error(err);
      S.searchLoading = false; S.searching = false; S.lastSig = "";
      toast(t("dash_load_error"), "error");
      renderAll();
      return;
    }
    S.searchLoading = false;
    S.results = S.searchCache.filter((o) => matchesSearch(o, crit));
    S.visible = PAGE_SIZE;
    renderAll();
  }

  function clearSearch(rerun = true) {
    if (inputs.text) inputs.text.value = "";
    setISO(inputs.from, ""); setISO(inputs.to, "");
    S.chips.outcome.clear(); S.chips.priority.clear();
    document.querySelectorAll(".fchip").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
    S.searching = false; S.results = []; S.searchSeq++; S.searchLoading = false; S.lastSig = "";
    renderFilterCount();
    if (rerun) { S.visible = PAGE_SIZE; renderAll(); }
  }

  function afterAction() {
    if (S.searching) { S.searchCache = null; runSearch(true); }
  }

  // ---- Događaji ---------------------------------------------------------------
  const debounced = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  function bindEvents() {
    inputs.text?.addEventListener("input", debounced(() => runSearch(false), 400));
    // Datumi se primenjuju automatski čim se izabere/ukuca datum ("change" šalje datepicker.js);
    // dugme "Primeni" radi isto na zahtev.
    [inputs.from, inputs.to].forEach((el) => el?.addEventListener("change", () => runSearch(false)));
    // Dugme "Filteri": širi / uvlači panel sa dugmićima i datumima da ne zauzimaju mesto kad nisu potrebni
    filtersToggle?.addEventListener("click", () => {
      const open = filtersPanel.hidden;
      filtersPanel.hidden = !open;
      filtersToggle.setAttribute("aria-expanded", String(open));
    });
    $("search-reset")?.addEventListener("click", () => clearSearch(true));
    // Dugmići (Aktivne / Zatvorene / Odbijene / Hitne): klik uključuje/isključuje filter, primena je automatska.
    // Ishodi se međusobno sabiraju („ili“), a „Hitne“ se kombinuju sa njima („i“).
    [chipsHost].forEach((host) => host?.addEventListener("click", (e) => {
      const chip = e.target.closest(".fchip");
      if (!chip) return;
      const set = S.chips[chip.dataset.chipGroup];
      const val = chip.dataset.chipValue;
      const on = !set.has(val);
      if (on) set.add(val); else set.delete(val);
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-pressed", String(on));
      runSearch(false);
    }));
    toggleBtn?.addEventListener("click", () => { S.showAll = !S.showAll; S.visible = PAGE_SIZE; if (S.showAll) ensureAllData(); renderAll(); });

    const openDetails = (row) => { window.location.href = `./order-detail.html?order=${row.dataset.id}`; };
    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (btn) {
        e.stopPropagation();
        const row = btn.closest("tr");
        const order = S.list.find((o) => o.id === btn.dataset.id);
        const fn = cfg.actions?.[btn.dataset.action];
        if (!order || !fn || btn.disabled) return;
        const rowBtns = row ? row.querySelectorAll("[data-action]") : [btn];
        rowBtns.forEach((b) => { b.disabled = true; });
        try {
          await fn(order, { now: S.now, button: btn });
        } catch (err) {
          console.error(err);
          toast(t("dash_action_error"), "error");
        } finally {
          rowBtns.forEach((b) => { b.disabled = false; });
          afterAction();
        }
        return;
      }
      if (e.target.closest("a, button, input, select")) return;
      const row = e.target.closest("tr.row-link");
      if (row) openDetails(row);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.closest("a, button, input, select")) return;
      const row = e.target.closest("tr.row-link");
      if (row) openDetails(row);
    });

    // Minutni tajmer: kašnjenje i "Danas završeno" se preračunavaju lokalno, bez
    // čitanja iz baze. Stanje narudžbina uvek dolazi iz uživo pretplate, pa čim
    // neko na drugom uređaju promeni status, narudžbina ispadne iz "Kasne" i ovde.
    const tick = () => {
      if (document.hidden) return;
      S.now = Date.now();
      if (renderCards()) { renderTable(); renderPager(); } else updateLateTags();
    };
    setInterval(tick, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }

  function updateLateTags() {
    body.querySelectorAll(".late-tag[data-late-id]").forEach((el) => {
      const o = S.list.find((x) => x.id === el.dataset.lateId);
      const info = o && lateInfo(o, S.now);
      if (info) el.textContent = t("late_by", { time: formatDurationText(info.overdueMs) });
    });
  }

  // Jedan red od 4 dugmeta + prečice za period
  const chipHtml = (group, value, label) =>
    `<button type="button" class="fchip" data-chip-group="${group}" data-chip-value="${value}" aria-pressed="false">${escapeHtml(label)}</button>`;
  const PRESET_KEYS = { this_month: "dash_p_this_month", last_month: "dash_p_last_month", last_90: "dash_p_90" };
  function buildChips() {
    if (chipsHost) {
      chipsHost.setAttribute("aria-label", t("dash_filters"));
      chipsHost.innerHTML = `<div class="chip-row">${[
        ["outcome", "active", "dash_f_active"], ["outcome", "closed", "dash_f_closed"],
        ["outcome", "rejected", "dash_f_rejected"], ["priority", "hitno", "dash_f_urgent"],
      ].map(([g, v, k]) => chipHtml(g, v, t(k))).join("")}</div>`;
    }
    if (presetsHost) {
      presetsHost.innerHTML = Object.entries(PRESET_KEYS)
        .map(([k, label]) => `<button type="button" class="fchip" data-preset="${k}" aria-pressed="false">${escapeHtml(t(label))}</button>`).join("");
      // Klik postavlja "Od/Do" i odmah filtrira; ponovni klik na izabranu prečicu briše period
      presetsHost.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-preset]");
        if (!btn) return;
        const range = periodPresets()[btn.dataset.preset];
        const same = getISO(inputs.from) === range.from && getISO(inputs.to) === range.to;
        setISO(inputs.from, same ? "" : range.from);
        setISO(inputs.to, same ? "" : range.to);
        runSearch(false);
      });
    }
  }
  // Prečica je istaknuta samo dok "Od/Do" tačno odgovaraju njenom periodu (ručna izmena datuma je gasi)
  function syncPresetHighlight() {
    if (!presetsHost) return;
    const ranges = periodPresets();
    presetsHost.querySelectorAll("[data-preset]").forEach((btn) => {
      const r = ranges[btn.dataset.preset];
      const on = getISO(inputs.from) === r.from && getISO(inputs.to) === r.to;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  function onData(kind, orders) {
    if (kind === "open") {
      // Nova ili obrisana narudžbina menja ukupan broj — osveži ga (zatvaranje samo premešta, ali je upit jeftin)
      const sig = orders.map((o) => o.id).sort().join(",");
      if (S.gotOpen && sig !== S.openSig && S.total != null) loadTotal();
      S.openSig = sig;
    }
    S[kind] = orders;
    S[kind === "open" ? "gotOpen" : "gotToday"] = true;
    S.now = Date.now();
    renderAll();
  }
  const onError = (err) => {
    console.error("Kontrolna tabla — greška pri čitanju narudžbina:", err);
    toast(t("dash_load_error"), "error");
  };

  return {
    start() {
      renderHead();
      buildChips();
      initDatepickers(document);
      bindEvents();
      renderAll();
      if (S.showAll) ensureAllData();
      listenOpenOrdersBy(cfg.companyId, cfg.ownerField, cfg.uid, (o) => onData("open", o), onError);
      listenRecentClosedBy(cfg.companyId, cfg.ownerField, cfg.uid, S.cutoff, (o) => onData("today", o), onError);
    },
  };
}
