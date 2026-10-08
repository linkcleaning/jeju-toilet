import { DICT, LANG_LABELS, HTML_LANG } from "./i18n.js";
import { icon, mascotSvg, PIN_HTML } from "./icons.js";

// ---------- 상태 ----------
const JEJU_CITY_HALL = { lat: 33.4996, lng: 126.5312 };
const LS = { lang: "jeju-toilet-language", reviews: "jeju-toilet-community-reviews", ratings: "jeju-toilet-ratings" };
const PAGE = 10;

const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  lang: (() => { const s = store.get(LS.lang, null); return DICT[s] ? s : "ko"; })(),
  view: "list",
  query: "",
  filter: "all",
  toilets: [],
  meta: null,
  loadError: null,
  selectedId: null,
  user: { ...JEJU_CITY_HALL },
  locStatus: "locating",
  shown: PAGE,
  reviews: store.get(LS.reviews, {}),
  ratings: store.get(LS.ratings, {}),
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function t(path) {
  const v = path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), DICT[state.lang]);
  if (typeof v === "string") return v;
  const ko = path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), DICT.ko);
  return typeof ko === "string" ? ko : path;
}

// ---------- 계산 ----------
function distanceKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(a.lat * r) * Math.cos(b.lat * r);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function travel(to) {
  const m = Math.max(10, Math.round(distanceKm(state.user, to) * 1000));
  const route = m * 1.18;
  const walk = Math.max(1, Math.ceil(route / 75));
  const drive = Math.max(1, Math.ceil(route / 430));
  const mode = route <= 1300 ? "walk" : "drive";
  const dist = m < 1000 ? `${Math.round(m / 10) * 10}${t("common.meters")}` : `${(m / 1000).toFixed(1)}${t("common.km")}`;
  return { dist, mode, walk: `${walk}${t("detail.minutes")} ${t("detail.walk")}`, drive: `${drive}${t("detail.minutes")} ${t("detail.drive")}` };
}
function seoulMinutes() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}
function isOpenNow(x) {
  if (x.status === "maintenance" || x.status === "closed") return false;
  if (x.open24h) return true;
  const ms = [...String(x.hours || "").matchAll(/(\d{1,2})\s*[:시]?\s*(\d{2})?\s*분?\s*[~\-–]\s*(\d{1,2})\s*[:시]?\s*(\d{2})?/g)];
  if (!ms.length) return null;
  const now = seoulMinutes();
  return ms.some((m) => {
    const s = Number(m[1]) * 60 + Number(m[2] || 0), e = Number(m[3]) * 60 + Number(m[4] || 0);
    if (s > 24 * 60 || e > 24 * 60) return false;
    return e >= s ? now >= s && now <= e : now >= s || now <= e;
  });
}
function statusOf(x) {
  const open = isOpenNow(x);
  if (x.status === "maintenance") return { label: t("detail.maintenance"), cls: "b-closed", txt: "t-closed", open };
  if (x.open24h) return { label: t("facilities.open24h"), cls: "b-open", txt: "t-open", open };
  if (open === true) return { label: t("detail.open"), cls: "b-open", txt: "t-open", open };
  if (open === false) return { label: t("detail.closed"), cls: "b-closed", txt: "t-closed", open };
  return { label: t("detail.limited"), cls: "b-limited", txt: "t-limited", open };
}
const flagCls = (v) => (v === true ? "yes" : v === false ? "no" : "unk");

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.toilets
    .filter((x) => {
      if (q && ![x.name, x.address, x.lotAddress, x.dong, x.type, x.org, x.olle ? `올레 olle ${x.olle}` : ""].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      switch (state.filter) {
        case "openNow": return isOpenNow(x) === true;
        case "open24h": return x.open24h;
        case "wheelchair": return x.wheelchair === true;
        case "diaper": return x.diaper === true;
        case "emergency": return x.bell === true;
        case "olle": return Boolean(x.olle);
        default: return true;
      }
    })
    .map((x) => ({ x, d: distanceKm(state.user, x) }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.x);
}

const dirUrls = (x) => {
  const name = encodeURIComponent(x.name);
  return {
    kakao: `https://map.kakao.com/link/to/${name},${x.lat},${x.lng}`,
    naver: `https://map.naver.com/p/directions/-/${x.lng},${x.lat},${name},,PLACE_POI/-/walk`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}&travelmode=walking`,
  };
};

// ---------- 소리 (귤랑이) ----------
const voice = new Audio("jangsil.wav");
voice.preload = "auto";
function speakFallback() {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance("장실!");
  u.lang = "ko-KR"; u.pitch = 1.75; u.rate = 1.25;
  const v = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("ko"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function playMascot(el) {
  try { voice.pause(); voice.currentTime = 0; voice.play().catch(speakFallback); } catch { speakFallback(); }
  $("#live").textContent = t("mascot.sound");
  document.querySelectorAll(".mascot-btn, .mascot-round").forEach((b) => b.classList.add("speaking"));
  document.querySelectorAll(".bubble strong").forEach((s) => (s.textContent = t("mascot.sound")));
  setTimeout(() => {
    document.querySelectorAll(".speaking").forEach((b) => b.classList.remove("speaking"));
    document.querySelectorAll(".bubble strong").forEach((s) => (s.textContent = t("mascot.name")));
    $("#live").textContent = "";
  }, 560);
}

// ---------- 토스트 ----------
let toastTimer;
function toast(msg, err = false) {
  const el = $("#toast");
  el.textContent = msg; el.className = `toast${err ? " err" : ""}`; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------- 위치 ----------
function locate(onDone) {
  if (!navigator.geolocation) { state.locStatus = "fallback"; render(); onDone?.(false); return; }
  state.locStatus = "locating"; renderList();
  navigator.geolocation.getCurrentPosition(
    (p) => { state.user = { lat: p.coords.latitude, lng: p.coords.longitude }; state.locStatus = "found"; state.shown = PAGE; render(); onDone?.(true); },
    () => { state.locStatus = "fallback"; render(); onDone?.(false); },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

// ---------- 정적 UI ----------
function applyStaticText() {
  document.documentElement.lang = HTML_LANG[state.lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $("#search").placeholder = t("search.placeholder");
  $("#search").setAttribute("aria-label", t("search.label"));
  $("#search-clear").setAttribute("aria-label", t("search.clear"));
  $("#filters").setAttribute("aria-label", t("filters.label"));
  $("#lang-select").setAttribute("aria-label", t("header.language"));
  $("#map-locate").setAttribute("aria-label", t("map.locate"));
  $("#view-map").setAttribute("aria-label", t("map.label"));
  $("#bottom-nav").setAttribute("aria-label", t("app.title"));
}
function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

const FILTERS = [["all", "sparkles"], ["openNow", "clock"], ["open24h", "clock"], ["wheelchair", "wheelchair"], ["diaper", "baby"], ["emergency", "bell"], ["olle", "feet"]];
function renderFilters() {
  $("#filters").innerHTML = FILTERS.map(([k, ic]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${icon(ic)}${esc(t(`filters.${k}`))}</button>`).join("");
}
function renderNav() {
  const items = [["list", "house"], ["map", "map"], ["guide", "info"]];
  $("#bottom-nav").innerHTML = `<div class="nav-grid">${items.map(([k, ic]) => `<button type="button" class="nav-btn" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ""}>${icon(ic)}${esc(t(`nav.${k}`))}</button>`).join("")}</div>`;
}

// ---------- 목록 ----------
function nearestCard(x) {
  if (!x) return "";
  const tr = travel(x), st = statusOf(x), u = dirUrls(x);
  const locLabel = state.locStatus === "found" ? t("list.locationReady") : state.locStatus === "locating" ? t("list.locating") : t("list.locationFallback");
  const statusLabel = x.open24h ? t("facilities.open24h") : st.open === true ? t("detail.open") : st.open === false ? t("detail.closed") : t("detail.unknownStatus");
  return `<section class="nearest" aria-labelledby="nearest-title">
    <div class="glow1"></div><div class="glow2"></div>
    <div class="n-top">
      <div class="pills"><button type="button" class="pill pill-loc press" data-act="locate" aria-label="${esc(t("list.refreshLocation"))}">${icon("refresh")}${esc(t("list.currentLocation"))}</button><span class="pill loc-st ${state.locStatus}"><span class="dot ${state.locStatus}"></span>${esc(state.locStatus === "found" ? t("list.locOk") : state.locStatus === "locating" ? t("list.locWait") : t("list.locFail"))}</span><span class="pill pill-orange">${esc(t("list.firstChoice"))}</span></div>
      <button type="button" class="mascot-btn press" data-act="mascot" aria-label="${esc(t("mascot.aria"))}">${mascotSvg()}<span class="badge">${icon("volume")}</span></button>
    </div>
    <p class="eyebrow">${esc(t("list.nearestEyebrow"))}</p>
    <h2 id="nearest-title">${esc(t("list.nearestNow"))}</h2>
    <button type="button" class="n-card press" data-open="${esc(x.id)}">
      <div class="n-head"><div class="n-ico">${icon("route")}</div><div><h3>${esc(x.name)}</h3><p>${esc(x.address)}</p></div></div>
      <div class="n-route">
        <div class="n-rail" aria-hidden="true"><span class="a"></span><span class="l"></span><span class="b"></span></div>
        <p class="n-from">${esc(t("list.fromMyLocation"))}</p>
        <p class="n-time">${esc(tr.mode === "walk" ? tr.walk : tr.drive)} <span>· ${esc(tr.dist)}</span></p>
        <p class="n-meta"><span>${icon("clock")}${esc(statusLabel)}</span>${x.wheelchair ? `<span>${icon("wheelchair")}${esc(t("filters.wheelchair"))}</span>` : ""}</p>
      </div>
    </button>
    ${state.locStatus === "fallback" ? `<button type="button" class="n-retry press" data-act="locate">${icon("refresh")}${esc(t("list.retryLocation"))}</button>` : ""}
    <div class="n-actions">
      <a class="n-go press" href="${u.kakao}" target="_blank" rel="noreferrer">${icon("nav")}${esc(t("list.startNavigation"))}</a>
      <button type="button" class="n-map press" data-showmap="${esc(x.id)}" aria-label="${esc(t("list.viewOnMap"))}" title="${esc(t("list.viewOnMap"))}">${icon("map")}</button>
    </div>
  </section>`;
}

function avgFor(id) {
  const rs = state.reviews[id] || [];
  return rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null;
}

function cardHtml(x, i) {
  const tr = travel(x), st = statusOf(x), avg = avgFor(x.id);
  const timeLabel = x.open24h ? "24H" : st.open === true ? t("detail.open") : st.open === false ? t("detail.closed") : t("detail.unknownStatus");
  const fac = [["wheelchair", x.wheelchair, "facilities.wheelchair"], ["baby", x.diaper, "facilities.diaper"], ["bell", x.bell, "facilities.emergency"]]
    .filter(([, v]) => v === true).map(([ic, , k]) => `<span class="fi-s" title="${esc(t(k))}">${icon(ic)}</span>`).join("");
  return `<button type="button" class="card" data-open="${esc(x.id)}" aria-label="${esc(x.name)} — ${esc(t("list.openDetails"))}">
    <span class="rank ${i === 0 ? "first" : ""}">${i + 1}</span>
    <span class="c-body">
      <span class="c-name">${esc(x.name)}</span>
      <span class="c-meta">
        <span class="t-green">${esc(tr.mode === "walk" ? tr.walk : tr.drive)} · ${esc(tr.dist)}</span>
        <span class="${st.txt}">${esc(timeLabel)}</span>
        ${avg ? `<span class="t-star">★${avg.toFixed(1)}</span>` : ""}
      </span>
    </span>
    <span class="c-fac">${fac}</span>
    ${icon("chevron", "ic c-chev")}
  </button>`;
}

function renderList() {
  const el = $("#view-list");
  if (state.loadError) {
    el.innerHTML = `<div class="wrap status-msg">${icon("database", "ic")}<div>${esc(t("data.error"))}</div><p>${esc(state.loadError)}</p></div>`;
    return;
  }
  if (!state.toilets.length) { el.innerHTML = `<div class="wrap status-msg">${esc(t("data.loading"))}</div>`; return; }
  const list = filtered();
  const nearest = list.find((x) => isOpenNow(x) === true) ?? list[0] ?? null;
  const shown = list.slice(0, state.shown);
  el.innerHTML = `<div class="wrap">
    ${nearestCard(nearest)}
    <div class="list-head">
      <h2 id="list-title">${esc(t("list.title"))}</h2>
      <span class="count-pill">${list.length.toLocaleString()} ${esc(t("search.results"))}</span>
    </div>
    ${list.length === 0 ? `<div class="empty">${icon("pin")}<p>${esc(t("search.noResults"))}</p></div>`
      : `<div class="cards">${shown.map(cardHtml).join("")}</div>${list.length > shown.length ? `<button type="button" class="more-btn press" data-act="more">${esc(t("common.more"))} (${(list.length - shown.length).toLocaleString()})</button>` : ""}`}
  </div>`;
}

// ---------- 지도 ----------
let map = null, cluster = null, userMarker = null, markerById = new Map(), tileErrors = 0, tilesOk = false;
const hasLeaflet = () => typeof window.L !== "undefined" && typeof window.L.markerClusterGroup === "function";

function initMap() {
  if (map || !hasLeaflet()) return;
  map = L.map("map", { zoomControl: true, attributionControl: true, preferCanvas: false }).setView([33.38, 126.55], 10);
  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, subdomains: "abc", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  tiles.on("tileload", () => { tilesOk = true; $("#map-fallback").hidden = true; });
  tiles.on("tileerror", () => { if (!tilesOk && ++tileErrors > 6) renderFallback(); });
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 48, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const n = c.getChildCount(), s = n < 10 ? 40 : n < 50 ? 46 : 54;
      return L.divIcon({ html: `<div class="cluster" style="width:${s}px;height:${s}px">${n}</div>`, className: "marker-cluster", iconSize: [s, s] });
    },
  });
  map.addLayer(cluster);
  setTimeout(() => { if (!tilesOk) renderFallback(); }, 9000);
}

function pinIcon(sel) {
  return L.divIcon({ html: PIN_HTML, className: `pin-icon${sel ? " sel" : ""}`, iconSize: [42, 46], iconAnchor: [14, 44] });
}

function renderMap() {
  const list = filtered();
  $("#map-count").textContent = `${list.length.toLocaleString()} ${t("map.officialCount")}`;
  if (!hasLeaflet()) { renderFallback(); return; }
  initMap();
  map.invalidateSize();
  cluster.clearLayers(); markerById.clear();
  const markers = list.map((x) => {
    const m = L.marker([x.lat, x.lng], { icon: pinIcon(x.id === state.selectedId), title: x.name, alt: `${x.name} — ${t("map.toiletMarker")}`, keyboard: true });
    m.on("click", () => select(x.id, false));
    markerById.set(x.id, m);
    return m;
  });
  cluster.addLayers(markers);
  if (userMarker) userMarker.remove();
  userMarker = L.marker([state.user.lat, state.user.lng], { icon: L.divIcon({ html: '<div class="user-dot"></div>', className: "", iconSize: [21, 21], iconAnchor: [10, 10] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  if (!$("#map-fallback").hidden) renderFallback();
}

function focusOnMap(x) {
  if (!map) return;
  const m = markerById.get(x.id);
  if (m && cluster) cluster.zoomToShowLayer(m, () => map.panTo([x.lat, x.lng]));
  else map.setView([x.lat, x.lng], Math.max(map.getZoom(), 16));
}

function renderFallback() {
  const fb = $("#map-fallback");
  const list = filtered();
  const cells = new Map();
  list.forEach((x) => { const k = `${Math.floor((x.lng - 126.16) / 0.065)}:${Math.floor((x.lat - 33.2) / 0.055)}`; if (!cells.has(k)) cells.set(k, x); });
  const picks = [...cells.values()].slice(0, 24);
  const pinSvg = PIN_HTML.match(/<svg[\s\S]*?<\/svg>/)[0];
  fb.innerHTML = `<div class="island"></div>${picks.map((x) => {
    const left = 8 + ((x.lng - 126.16) / (126.98 - 126.16)) * 84;
    const top = 30 + ((33.58 - x.lat) / (33.58 - 33.2)) * 40;
    return `<button type="button" class="fb-pin press" data-open="${esc(x.id)}" style="left:${Math.min(92, Math.max(8, left))}%;top:${Math.min(76, Math.max(24, top))}%" aria-label="${esc(x.name)} — ${esc(t("map.toiletMarker"))}">${pinSvg}</button>`;
  }).join("")}<div class="fb-note">${esc(t("map.offline"))}</div>`;
  fb.hidden = false;
}

let mapToastTimer;
function mapToast(msg) {
  const el = $("#map-toast");
  el.innerHTML = `${icon("nav")}${esc(msg)}`; el.hidden = false;
  clearTimeout(mapToastTimer); mapToastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- 상세 ----------
function flag(ic, label, v) {
  const st = v === true ? t("common.available") : v === false ? t("common.unavailable") : t("common.unknown");
  return `<div class="flag ${flagCls(v)}">${icon(ic)}<span class="n">${esc(label)}</span><span class="st">${esc(st)}</span></div>`;
}

function renderDrawer() {
  const el = $("#drawer");
  const x = state.toilets.find((o) => o.id === state.selectedId);
  if (!x) { el.hidden = true; el.innerHTML = ""; return; }
  const tr = travel(x), st = statusOf(x), u = dirUrls(x);
  const reviews = state.reviews[x.id] || [];
  const avg = avgFor(x.id);
  const myRating = state.ratings[x.id] || 0;
  const tip = t("detail.tipTemplate").replace("{type}", x.type || (state.lang === "ko" ? "공공" : "public"));
  const separated = x.unisex === null || x.unisex === undefined ? null : !x.unisex;
  el.innerHTML = `
    <div class="grabber" aria-hidden="true"></div>
    <div class="d-top">
      <div>
        <div class="d-badges">
          <span class="badge-s ${st.cls}"><span class="dot"></span>${esc(st.label)}</span>
          <span class="badge-s b-official">${esc(t("common.official"))}</span>
          ${x.olle ? `<span class="badge-s b-olle">Olle ${esc(x.olle)}</span>` : ""}
        </div>
        <h2 id="drawer-title">${esc(x.name)}</h2>
        <p class="d-addr">${esc(x.address)}${x.lotAddress ? `<br><small>${esc(x.lotAddress)}</small>` : ""}</p>
      </div>
      <button type="button" class="d-close press" data-act="close" aria-label="${esc(t("common.close"))}">${icon("x")}</button>
    </div>
    <div class="d-grid2">
      <div class="d-box box-green">${icon("pin")}<p class="lb">${esc(t("detail.distance"))}</p><p class="v">${esc(tr.mode === "walk" ? tr.walk : tr.drive)} · ${esc(tr.dist)}</p><p class="s">${esc(tr.mode === "walk" ? tr.drive : tr.walk)} ${esc(t("detail.estimate"))}</p></div>
      <div class="d-box box-warm">${icon("clock")}<p class="lb">${esc(t("detail.hours"))}</p><p class="v">${esc(x.hours || t("common.unknown"))}</p></div>
    </div>
    <div class="tip">${icon("info")}<div><b>${esc(t("detail.microTip"))}</b><p>${esc(tip)}</p></div></div>
    <div class="sec"><h3>${icon("wheelchair")}${esc(t("detail.facilities"))}</h3><div class="flags">
      ${flag("wheelchair", t("facilities.wheelchair"), x.wheelchair)}
      ${flag("users", t("facilities.genderSeparated"), separated)}
      ${flag("baby", t("facilities.diaper"), x.diaper)}
      ${flag("baby", t("facilities.toddlerSeat"), x.child)}
      ${flag("sparkles", t("facilities.toiletPaper"), null)}
      ${flag("sparkles", t("facilities.bidet"), null)}
    </div></div>
    <div class="sec"><h3>${icon("shield")}${esc(t("detail.safety"))}</h3><div class="flags">
      ${flag("bell", t("facilities.emergency"), x.bell)}
      ${flag("camera", t("facilities.cctv"), x.cctv)}
      ${flag("shieldCheck", t("facilities.emergencyLinked"), null)}
      ${flag("shieldCheck", t("facilities.illegalCamera"), null)}
      ${flag("shield", t("facilities.safetyMirror"), null)}
    </div>
    <div class="sos"><a href="tel:112">${icon("phone")}112</a><a href="tel:119">${icon("phone")}119</a></div></div>
    <div class="sec"><h3>${icon("feet")}${esc(t("detail.tourism"))}</h3><div class="flags">
      <div class="flag ${x.olle ? "olle" : "unk"}">${icon("feet")}<span class="n">${esc(t("facilities.olle"))}</span><span class="st">${x.olle ? `Olle ${esc(x.olle)}` : esc(t("common.unknown"))}</span></div>
      ${flag("parking", t("facilities.parking"), null)}
      ${flag("zap", t("facilities.ev"), null)}
    </div></div>
    <div class="rating">
      <div class="r-row">
        <div><p class="lb">${esc(t("detail.cleanliness"))}</p>
          ${avg ? `<p class="r-avg">${icon("star", "ic star-fill")}${avg.toFixed(1)} <small>(${reviews.length} ${esc(t("detail.reviews"))})</small></p>` : `<p class="r-none">${esc(t("detail.noReviews"))}</p>`}
        </div>
        <div style="text-align:right"><p class="lb" style="margin-bottom:4px">${esc(t("detail.yourRating"))}</p>
          <div class="stars" role="group" aria-label="${esc(t("detail.yourRating"))}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" class="${n <= myRating ? "on" : ""}" aria-label="${n} ${esc(t("detail.rate"))}">${icon("star")}</button>`).join("")}</div>
        </div>
      </div>
      <form class="r-form" id="review-form"><input id="review-text" maxlength="90" placeholder="${esc(t("detail.reviewPlaceholder"))}" aria-label="${esc(t("detail.cleanliness"))}" /><button type="submit" class="press" aria-label="${esc(t("detail.submitReview"))}">${icon("send")}</button></form>
      <p class="r-note">${esc(t("detail.reviewLocal"))}</p>
      ${reviews.length ? `<div class="r-list">${reviews.slice(0, 3).map((r) => `<div>${icon("message")}<p><b>★ ${r.rating}</b>${esc(r.text)}</p></div>`).join("")}</div>` : ""}
    </div>
    <div class="sec"><h3>${icon("nav")}${esc(t("detail.directions"))}</h3><div class="dirs">
      <a class="dir-kakao press" href="${u.kakao}" target="_blank" rel="noreferrer">${esc(t("detail.kakao"))}${icon("external")}</a>
      <a class="dir-naver press" href="${u.naver}" target="_blank" rel="noreferrer">${esc(t("detail.naver"))}${icon("external")}</a>
      <a class="dir-google press" href="${u.google}" target="_blank" rel="noreferrer">${esc(t("detail.google"))}${icon("external")}</a>
    </div></div>
    <div class="mgmt">${icon("building")}<span>${esc(x.org || t("common.unknown"))}</span>${x.tel ? `<a href="tel:${esc(x.tel.replace(/[^\d+]/g, ""))}">${esc(x.tel)}</a>` : ""}</div>
    ${x.geocoded ? `<p class="geo-note">${icon("info")}${esc(t("detail.geocoded"))}</p>` : ""}
    <div class="d-foot"><span>${icon("calendar")}${esc(t("detail.updated"))} ${esc(x.ref || state.meta?.referenceDate || "-")}</span><button type="button" data-act="report">${esc(t("detail.report"))}</button></div>`;
  el.hidden = false;
  el.scrollTop = 0;
}

function select(id, scrollMap = true) {
  state.selectedId = id;
  renderDrawer();
  if (state.view === "map" && map) {
    markerById.forEach((m, mid) => m.setIcon(pinIcon(mid === id)));
    const x = state.toilets.find((o) => o.id === id);
    if (x && scrollMap) focusOnMap(x);
    else if (x) map.panTo([x.lat, x.lng]);
  }
}

// ---------- 안내 ----------
function renderGuide() {
  const m = state.meta;
  const cards = [
    ["accessibility", "wheelchair", "01", "c-a"],
    ["hours", "clock", "02", "c-b"],
    ["emergency", "phone", "03", "c-c"],
    ["data", "database", "04", "c-d"],
  ];
  $("#view-guide").innerHTML = `<div class="wrap" style="max-width:896px">
    <div class="g-hero"><div class="c1"></div><div class="c2"></div>
      <p class="k">ACCESSIBLE JEJU</p><h2 id="guide-title">${esc(t("guide.title"))}</h2><p>${esc(t("guide.intro"))}</p>${mascotSvg()}</div>
    <div class="g-cards">
      ${cards.map(([k, ic, n, c]) => `<article class="g-card"><div class="top"><div class="g-ico ${c}">${icon(ic)}</div><span class="g-num">${n}</span></div>
        <h3>${esc(t(`guide.${k}Title`))}</h3><p>${esc(t(`guide.${k}Body`))}</p>
        ${k === "emergency" ? `<div class="sos" style="margin-top:16px"><a href="tel:112">${icon("phone")}Police 112</a><a href="tel:119">${icon("phone")}Emergency 119</a></div>` : ""}
        ${k === "data" && m ? `<p class="meta">${m.count.toLocaleString()} · ${esc(t("detail.updated"))} ${esc(m.referenceDate || "-")}<br><a href="${esc(m.sourcePages?.[0] || "https://www.data.go.kr")}" target="_blank" rel="noreferrer">data.go.kr</a></p>` : ""}
      </article>`).join("")}
      <article class="g-card"><div class="top"><div class="g-ico c-e">${icon("download")}</div><span class="g-num">05</span></div><h3>${esc(t("guide.install"))}</h3><p>${esc(t("guide.installBody"))}</p></article>
    </div></div>`;
}

// ---------- 화면 전환 ----------
function renderMascotFloat() {
  const el = $("#mascot-float");
  el.hidden = state.view !== "map";
  if (el.hidden) return;
  el.innerHTML = `<button type="button" class="mascot-round press" data-act="mascot" aria-label="${esc(t("mascot.aria"))}">${mascotSvg()}<span class="badge">${icon("volume")}</span></button>
    <button type="button" class="bubble" data-act="mascot" aria-label="${esc(t("mascot.aria"))}"><strong>${esc(t("mascot.name"))}</strong><span>${esc(t("mascot.prompt"))}</span></button>`;
}

function render() {
  $("#view-list").hidden = state.view !== "list";
  $("#view-map").hidden = state.view !== "map";
  $("#view-guide").hidden = state.view !== "guide";
  $("#search-bar").hidden = state.view === "guide";
  renderNav();
  renderFilters();
  renderMascotFloat();
  if (state.view === "list") renderList();
  if (state.view === "map") renderMap();
  if (state.view === "guide") renderGuide();
  renderDrawer();
}

function setView(v, keepSelection = false) {
  state.view = v;
  if (!keepSelection) state.selectedId = null;
  render();
}

// ---------- 이벤트 ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open],[data-showmap],[data-act],[data-filter],[data-view],[data-rate]");
  if (!b) return;
  if (b.dataset.open) { select(b.dataset.open); return; }
  if (b.dataset.showmap) {
    const id = b.dataset.showmap; state.view = "map"; state.selectedId = id; render();
    const x = state.toilets.find((o) => o.id === id);
    if (x && map) setTimeout(() => focusOnMap(x), 60);
    return;
  }
  if (b.dataset.filter) { state.filter = b.dataset.filter; state.shown = PAGE; if (state.selectedId && !filtered().some((x) => x.id === state.selectedId)) state.selectedId = null; render(); return; }
  if (b.dataset.view) { setView(b.dataset.view); return; }
  if (b.dataset.rate) {
    state.ratings[state.selectedId] = Number(b.dataset.rate); store.set(LS.ratings, state.ratings);
    const keep = $("#review-text")?.value || "";
    renderDrawer(); if ($("#review-text")) $("#review-text").value = keep;
    toast(t("detail.ratingSaved")); return;
  }
  switch (b.dataset.act) {
    case "mascot": playMascot(b); break;
    case "locate": locate(); break;
    case "more": state.shown += 20; renderList(); break;
    case "close": state.selectedId = null; renderDrawer(); if (map) markerById.forEach((m) => m.setIcon(pinIcon(false))); break;
    case "report": toast(t("detail.reportMessage")); break;
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "review-form") return;
  e.preventDefault();
  const id = state.selectedId, text = $("#review-text").value.trim().slice(0, 90), rating = state.ratings[id] || 0;
  if (!rating || !text) { toast(t("detail.reviewRequired"), true); return; }
  const r = { id: crypto.randomUUID?.() || String(Date.now()), rating, text, createdAt: new Date().toISOString(), language: state.lang };
  state.reviews[id] = [r, ...(state.reviews[id] || [])].slice(0, 5);
  store.set(LS.reviews, state.reviews);
  renderDrawer(); toast(t("detail.reviewSaved"));
  if (state.view === "list") renderList();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.selectedId) { state.selectedId = null; renderDrawer(); }
});

let searchTimer;
$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  $("#search-clear").hidden = !state.query;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.shown = PAGE; if (state.view === "list") renderList(); else if (state.view === "map") renderMap(); }, 140);
});
$("#search-clear").addEventListener("click", () => {
  state.query = ""; $("#search").value = ""; $("#search-clear").hidden = true; $("#search").focus();
  state.shown = PAGE; render();
});
$("#map-locate").addEventListener("click", () => {
  locate((ok) => {
    mapToast(ok ? t("map.locationFound") : t("map.locationFallback"));
    if (ok && map) map.setView([state.user.lat, state.user.lng], 15);
  });
});
$("#map-toast").addEventListener("click", (e) => (e.currentTarget.hidden = true));

const sel = $("#lang-select");
sel.innerHTML = Object.entries(LANG_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
sel.value = state.lang;
sel.addEventListener("change", () => {
  state.lang = sel.value; store.set(LS.lang, state.lang);
  applyStaticText(); render();
});

// ---------- 시작 ----------
fillIcons();
applyStaticText();
render();

fetch("data/toilets.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(t("data.missing")); return r.json(); })
  .then((d) => { state.toilets = d.toilets || []; state.meta = d.meta || null; if (!state.toilets.length) throw new Error(t("data.missing")); render(); })
  .catch((err) => { state.loadError = err.message || String(err); render(); });

locate();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
