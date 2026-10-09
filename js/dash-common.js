// ============================================================================
// DASH-COMMON — zajednički kontroler kontrolnih tabli Naručioca i Isporučioca.
// Jednom napisano: kartice (filteri + vizuelni podsetnik), pravilo "kasne",
// tabela sa paginacijom ("Učitaj još"), pretraga cele istorije, akcije u redu,
// minutni tajmer. Admin tabla koristi samo isLate() iz dash-logic.js.
//
// Podaci: otvorene narudžbine (uživo) + zatvorene/odbijene u poslednjih 30 dana
// (uživo) + starije zatvorene po stranama na zahtev + cela istorija pri pretrazi.
// ============================================================================
import { t } from "./i18n.js";
import { initDatepickers, getISO, setISO } from "./datepicker.js";
import { escapeHtml, formatDate, badgeClassForStatus, statusLabel, toast, ORDER_STATUS_ALL } from "./utils.js";
import { listenOpenOrdersBy, listenRecentClosedBy, getOlderClosedPageBy, getAllOrdersBy } from "./orders.js";
import {
  PAGE_SIZE, RECENT_DAYS, SEARCH_CACHE_MS, CLOSED_STATUSES,
  isLate, lateInfo, dayKey, durationParts, parseCriteria, matchesSearch, compareByCreatedDesc,
} from "./dash-logic.js";

export { isLate, lateInfo } from "./dash-logic.js";

// --- Definicije kartica -------------------------------------------------------
// Ista predikat-funkcija se koristi za broj na kartici i za filter tabele, pa
// broj na kartici uvek odgovara broju redova kad se kartica izabere.
export const CARD_DEFS = {
  all: { labelKey: "my_orders", color: "", predicate: () => true },
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
//   actions: { name: async (order) => void },   // data-action dugmad u redu
//   emptyKey: string,
// }
export function createDashboard(cfg) {
  const S = {
    open: [], recent: [], older: [], olderCursor: null, hasMoreOlder: true, loadingOlder: false,
    gotOpen: false, gotRecent: false,
    filter: "all", showAll: !cfg.activeOnlyDefault, visible: PAGE_SIZE,
    searching: false, results: [], searchCache: null, searchCacheAt: 0, searchCapped: false, searchSeq: 0, searchLoading: false, lastSig: "",
    chips: { status: new Set(), priority: new Set() },
    list: [], now: Date.now(), cardSig: null,
    cutoff: new Date(Date.now() - RECENT_DAYS * 86400000),
  };
  const statHost = $("stat-cards"), chipHost = $("filter-chip"), head = $("orders-head"), body = $("orders-body");
  const pagerHost = $("pager"), toggleBtn = $("toggle-all-btn"), searchInfo = $("search-info");
  const statusHost = $("status-chips"), priorityHost = $("priority-chips");
  const inputs = { text: $("search-text"), from: $("search-from"), to: $("search-to") };

  const base = () => Array.from(byId(S.recent, S.open).values());
  const liveMap = () => byId(S.older, S.recent, S.open);

  function getPool() {
    if (S.searching) {
      const live = liveMap();
      return S.results.map((o) => live.get(o.id) || o).sort(compareByCreatedDesc);
    }
    const b = base();
    if (S.filter !== "all") return b.filter((o) => CARD_DEFS[S.filter].predicate(o, S.now)).sort(cfg.compare(S.now));
    const pool = S.showAll ? Array.from(liveMap().values()) : b.filter((o) => !CLOSED_STATUSES.includes(o.status));
    return pool.sort(cfg.compare(S.now));
  }

  // ---- Kartice -------------------------------------------------------------
  function renderCards(force = false) {
    const b = base();
    const counts = cfg.cardKeys.map((k) => b.filter((o) => CARD_DEFS[k].predicate(o, S.now)).length);
    const sig = `${counts.join(",")}|${S.filter}|${S.searching}|${dayKey(S.now)}`;
    if (!force && sig === S.cardSig) return false;
    S.cardSig = sig;
    const focusedKey = document.activeElement?.dataset?.filter;
    statHost.innerHTML = cfg.cardKeys.map((k, i) => {
      const def = CARD_DEFS[k];
      const active = !S.searching && S.filter === k;
      const attn = def.attention && counts[i] > 0;
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
    if (!S.gotOpen || !S.gotRecent) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length}">${t("loading_ellipsis")}</td></tr>`;
      return;
    }
    const shown = S.list.slice(0, S.visible);
    if (!shown.length) {
      const key = S.searching ? "dash_no_search_results" : (S.filter !== "all" ? "no_orders_for_filter" : (cfg.emptyKey || "no_orders_yet"));
      body.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length}">${t(key)}</td></tr>`;
      return;
    }
    const ctx = { now: S.now };
    body.innerHTML = shown.map((o) => `
      <tr class="row-link ${cfg.rowClass ? cfg.rowClass(o) : ""}" data-id="${escapeHtml(o.id)}" tabindex="0">
        ${cfg.columns.map((c) => `<td class="${c.cls || ""}">${c.render(o, ctx)}</td>`).join("")}
      </tr>`).join("");
  }

  function renderPager() {
    const total = S.list.length;
    const shown = Math.min(S.visible, total);
    const canMem = S.visible < total;
    const canOlder = !S.searching && S.filter === "all" && S.showAll && S.hasMoreOlder;
    if (!S.gotOpen || !S.gotRecent || (S.searching && S.searchLoading) || (!total && !canOlder)) { pagerHost.innerHTML = ""; return; }
    pagerHost.innerHTML = `
      <span class="muted pager-count">${t("dash_showing_count", { shown, total })}</span>
      ${(canMem || canOlder) ? `<button type="button" class="btn btn-sm btn-outline" id="load-more-btn" ${S.loadingOlder ? "disabled" : ""}>${S.loadingOlder ? t("loading_ellipsis") : t("dash_load_more")}</button>` : ""}`;
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

  async function loadMore() {
    if (S.visible < S.list.length) { S.visible += PAGE_SIZE; renderTable(); renderPager(); return; }
    if (S.loadingOlder || !S.hasMoreOlder) return;
    S.loadingOlder = true; renderPager();
    try {
      const res = await getOlderClosedPageBy(cfg.companyId, cfg.ownerField, cfg.uid, S.cutoff, S.olderCursor, PAGE_SIZE);
      S.older = S.older.concat(res.orders);
      S.olderCursor = res.cursor || S.olderCursor;
      S.hasMoreOlder = res.hasMore;
      S.visible += PAGE_SIZE;
      if (!res.orders.length) toast(t("dash_no_older"), "info");
    } catch (err) {
      console.error(err);
      toast(t("dash_load_error"), "error");
    } finally {
      S.loadingOlder = false;
      renderTable(); renderPager();
    }
  }

  // ---- Pretraga cele istorije -----------------------------------------------
  const readCriteria = () => parseCriteria({
    text: inputs.text?.value, statuses: [...S.chips.status], priorities: [...S.chips.priority],
    from: getISO(inputs.from), to: getISO(inputs.to),
  });

  function renderSearchInfo() {
    if (!searchInfo) return;
    if (S.searching && S.searchLoading) { searchInfo.textContent = t("dash_search_loading"); return; }
    if (!S.searching) { searchInfo.textContent = ""; return; }
    searchInfo.textContent = t("dash_search_results", { count: S.list.length }) + (S.searchCapped ? ` ${t("dash_search_capped")}` : "");
  }

  // force = true: pokreni i kad se kriterijumi nisu promenili (dugme "Primeni", posle akcije u redu)
  async function runSearch(force = false) {
    const crit = readCriteria();
    const sig = JSON.stringify([crit.tokens, crit.statuses, crit.priorities, crit.fromMs, crit.toMs]);
    if (!force && sig === S.lastSig) return; // npr. datepicker šalje "change" i pri običnom napuštanju polja
    S.lastSig = sig;
    if (!crit.active) { S.searching = false; S.results = []; S.searchSeq++; S.searchLoading = false; S.visible = PAGE_SIZE; renderAll(); return; }
    const seq = ++S.searchSeq;
    S.searching = true; S.filter = "all";
    try {
      if (!S.searchCache || Date.now() - S.searchCacheAt > SEARCH_CACHE_MS) {
        S.searchLoading = true; renderCards(true); renderTable(); renderPager(); renderSearchInfo();
        const { orders, capped } = await getAllOrdersBy(cfg.companyId, cfg.ownerField, cfg.uid);
        if (seq !== S.searchSeq) return; // u međuvremenu je pokrenuta novija pretraga
        S.searchCache = orders; S.searchCapped = capped; S.searchCacheAt = Date.now();
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
    S.chips.status.clear(); S.chips.priority.clear();
    document.querySelectorAll(".fchip").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
    S.searching = false; S.results = []; S.searchSeq++; S.searchLoading = false; S.lastSig = "";
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
    $("search-apply")?.addEventListener("click", () => runSearch(true));
    $("search-reset")?.addEventListener("click", () => clearSearch(true));
    // Dugmići statusa i prioriteta: klik uključuje/isključuje filter (može više njih), primena je automatska.
    [statusHost, priorityHost].forEach((host) => host?.addEventListener("click", (e) => {
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
    toggleBtn?.addEventListener("click", () => { S.showAll = !S.showAll; S.visible = PAGE_SIZE; renderAll(); });

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

  // Dugmići: statusi u dva reda, prioriteti u trećem
  const chipHtml = (group, value, label) =>
    `<button type="button" class="fchip" data-chip-group="${group}" data-chip-value="${value}" aria-pressed="false">${escapeHtml(label)}</button>`;
  function buildChips() {
    if (statusHost) {
      const half = Math.ceil(ORDER_STATUS_ALL.length / 2);
      statusHost.setAttribute("aria-label", t("status"));
      statusHost.innerHTML = [ORDER_STATUS_ALL.slice(0, half), ORDER_STATUS_ALL.slice(half)]
        .map((row) => `<div class="chip-row">${row.map((s) => chipHtml("status", s, statusLabel(s))).join("")}</div>`).join("");
    }
    if (priorityHost) {
      priorityHost.setAttribute("aria-label", t("priority"));
      priorityHost.innerHTML = `<div class="chip-row">${chipHtml("priority", "hitno", t("urgent"))}${chipHtml("priority", "standardno", t("standard"))}</div>`;
    }
  }

  function onData(kind, orders) {
    S[kind] = orders;
    S[kind === "open" ? "gotOpen" : "gotRecent"] = true;
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
      listenOpenOrdersBy(cfg.companyId, cfg.ownerField, cfg.uid, (o) => onData("open", o), onError);
      listenRecentClosedBy(cfg.companyId, cfg.ownerField, cfg.uid, S.cutoff, (o) => onData("recent", o), onError);
    },
  };
}
