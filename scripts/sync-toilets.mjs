#!/usr/bin/env node
// 제주 공중화장실 데이터 → data/toilets.json
//
// 사용법
//   node scripts/sync-toilets.mjs                       # 공식 API(키 있으면) → 실패 시 공식 CSV 다운로드
//   node scripts/sync-toilets.mjs 제주시.csv 서귀포시.csv  # 내려받은 CSV 파일로 변환
//
// 인증키는 환경변수 JEJU_OPEN_DATA_SERVICE_KEY 로만 받습니다. (앱 코드/저장소에 넣지 마세요)
// 외부 패키지 없이 Node 20+ 에서 동작합니다.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "data/toilets.json");
// 공공데이터포털 '파일데이터 → 자동변환 OpenAPI' (odcloud). 활용신청 승인된 일반 인증키로 호출.
const ODCLOUD_BASE = "https://api.odcloud.kr/api";
const ODCLOUD_DOCS = "https://infuser.odcloud.kr/oas/docs?namespace=15110521/v1";
const ODCLOUD_LATEST = "/15110521/v1/uddi:53e4caf3-7c1b-44a4-a39c-d203040442e9"; // 제주시_공중화장실_20251231
const DATASET_PAGE = "https://www.data.go.kr/data/15110521/fileData.do";
const FALLBACK_CSV = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003607188&fileDetailSn=1&insertDataPrcus=N";

// ---------- helpers ----------
const text = (v) => (v == null ? "" : String(v).trim());
const num = (v) => { const n = Number(text(v).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
function yesNo(v) {
  const s = text(v).toUpperCase();
  if (["Y", "YES", "1", "TRUE", "있음", "유", "O", "설치"].includes(s)) return true;
  if (["N", "NO", "0", "FALSE", "없음", "무", "X", "미설치"].includes(s)) return false;
  return null;
}
const normKey = (k) => text(k).replace(/^﻿/, "").replace(/[\s_\-()（）]/g, "").toLowerCase();

function pick(rec, ...keys) {
  for (const k of keys) {
    const v = rec[normKey(k)];
    if (v !== undefined && v !== null && text(v) !== "") return v;
  }
  return "";
}

function decode(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes);
  const utf = new TextDecoder("utf-8").decode(bytes);
  if (!utf.includes("�")) return utf;
  return new TextDecoder("euc-kr").decode(bytes);
}

function parseCsv(src) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  const [header, ...body] = rows;
  const keys = header.map(normKey);
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

function normalizeObjectKeys(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [normKey(k), v]));
}

function olleCourse(...vals) {
  const m = vals.join(" ").match(/올레\s*(?:길)?\s*(\d{1,2}(?:-\d)?)\s*코스/);
  return m ? m[1] : null;
}

function hoursInfo(raw) {
  const s = raw.replace(/\s/g, "");
  const maintenance = /공사|폐쇄|미운영|사용불가|휴장|정비중|운영중지/.test(s);
  const open24h = /상시|연중무휴|24시간|00:00[~\-]24:00|00:00[~\-]23:59/.test(s);
  return { status: maintenance ? "maintenance" : open24h ? "open24h" : raw ? "limited" : "unknown", open24h: open24h && !maintenance };
}

function normalize(rawRec, provider) {
  const r = normalizeObjectKeys(rawRec);
  const name = text(pick(r, "toiletNm", "화장실 명", "화장실명"));
  const road = text(pick(r, "rnAdres", "도로명 주소", "소재지도로명주소", "도로명주소"));
  const lot = text(pick(r, "lnmAdres", "지번 주소", "소재지지번주소", "지번주소"));
  const lat = Number(text(pick(r, "laCrdnt", "위도 좌표", "위도", "WGS84위도", "위도좌표")));
  const lng = Number(text(pick(r, "loCrdnt", "경도 좌표", "경도", "WGS84경도", "경도좌표")));
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 33.0 || lat > 34.2 || lng < 125.9 || lng > 127.2) return null;

  const dM = num(pick(r, "maleDspsnClosetCnt", "남성 장애인 대변기 수", "남성용장애인용대변기수"));
  const dMU = num(pick(r, "maleDspsnUrinalCnt", "남성 장애인 소변기 수", "남성용장애인용소변기수"));
  const dF = num(pick(r, "femaleDspsnClosetCnt", "여성 장애인 대변기 수", "여성용장애인용대변기수"));
  const kid = num(pick(r, "maleChildClosetCnt", "남성 어린이 대변기 수", "남성용어린이용대변기수"))
    + num(pick(r, "maleChildUrinalCnt", "남성 어린이 소변기 수", "남성용어린이용소변기수"))
    + num(pick(r, "femaleChildClosetCnt", "여성 어린이 대변기 수", "여성용어린이용대변기수"));
  const unisex = yesNo(pick(r, "mwmnCmnuseToiletYn", "남녀 공용 화장실 여부", "남녀공용화장실여부"));
  const hours = text(pick(r, "opnTimeInfo", "개방 시간 정보", "개방시간", "개방시간상세", "개방 시간"));
  const id = text(pick(r, "dataCd", "데이터 코드", "관리번호", "번호")) || `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const type = text(pick(r, "toiletInstlPlacePttnNm", "화장실 설치 장소 유형 명", "화장실 유형", "구분명", "구분"));
  const dong = text(pick(r, "emdNm", "읍면동 명", "읍면동명"));
  const address = road || lot;

  return {
    id: `${provider === "서귀포시" ? "sgp" : "jj"}-${id}`,
    name,
    address,
    lotAddress: road && lot && road !== lot ? lot : "",
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    hours,
    ...hoursInfo(hours),
    wheelchair: dM + dMU + dF > 0,
    disabledFixtures: [dM, dMU, dF],
    unisex,
    diaper: yesNo(pick(r, "diaperExhgTablYn", "기저귀 교환대 설치 여부", "기저귀교환대유무", "기저귀 교환 탁자 여부")),
    child: kid > 0,
    bell: yesNo(pick(r, "emgncBellInstlYn", "비상 벨 설치 여부", "비상벨설치여부")),
    cctv: yesNo(pick(r, "toiletEntrncCctvInstlYn", "화장실 입구 CCTV 설치 여부", "화장실입구CCTV설치유무")),
    olle: olleCourse(name, address),
    dong,
    type,
    org: text(pick(r, "mngrInsttNm", "관리 기관 명", "관리기관명")),
    tel: text(pick(r, "telno", "전화번호")) || null,
    own: text(pick(r, "toiletPosesnSeNm", "화장실 소유 구분 명", "화장실소유구분")),
    ref: text(pick(r, "regDt", "데이터 기준일", "데이터기준일자")),
    provider,
  };
}

// ---------- sources ----------
// 가장 최신 기준일의 API 경로 찾기 (새 버전이 올라오면 자동으로 따라감)
async function latestOdcloudPath() {
  try {
    const docs = await (await fetch(ODCLOUD_DOCS, { signal: AbortSignal.timeout(20000) })).json();
    const entries = Object.entries(docs.paths || {}).map(([p, v]) => ({ p, date: (JSON.stringify(v).match(/_(\d{8})/g) || []).map((d) => d.slice(1)).sort().at(-1) || "" }));
    entries.sort((a, b) => a.date.localeCompare(b.date));
    if (entries.length) return entries.at(-1).p;
  } catch {}
  return ODCLOUD_LATEST;
}

async function fromApi(key) {
  const apiPath = await latestOdcloudPath();
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(ODCLOUD_BASE + apiPath);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perPage", "1000");
    url.searchParams.set("serviceKey", key);
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    let json;
    try { json = JSON.parse(body); } catch { throw new Error(`API 응답을 해석할 수 없음 (HTTP ${res.status})`); }
    if (!res.ok || !Array.isArray(json.data)) throw new Error(json.msg || json.message || `HTTP ${res.status}`);
    rows.push(...json.data);
    if (rows.length >= (json.matchCount ?? json.totalCount ?? 0) || json.data.length === 0) break;
  }
  console.log(`API 경로: ${apiPath}`);
  return rows;
}

async function fromRemoteCsv() {
  let url = FALLBACK_CSV;
  try {
    const html = await (await fetch(DATASET_PAGE, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) })).text();
    const m = html.match(/"contentUrl"\s*:\s*"([^"]+)"/);
    if (m) url = m[1].replaceAll("&amp;", "&");
  } catch {}
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  return parseCsv(decode(new Uint8Array(await res.arrayBuffer())));
}

function guessProvider(file, rows) {
  const sample = JSON.stringify(rows.slice(0, 20));
  if (/서귀포/.test(file) || (/서귀포시/.test(sample) && !/제주시/.test(sample))) return "서귀포시";
  return "제주시";
}

// ---------- main ----------
async function main() {
  const files = process.argv.slice(2);
  const all = [];
  const sources = [];

  if (files.length) {
    for (const f of files) {
      const rows = parseCsv(decode(new Uint8Array(await readFile(f))));
      const provider = guessProvider(path.basename(f), rows);
      const recs = rows.map((r) => normalize(r, provider)).filter(Boolean);
      console.log(`${path.basename(f)}: ${rows.length}행 → 지도 표시 가능 ${recs.length}곳 (${provider})`);
      all.push(...recs);
      sources.push({ provider, mode: "csv-file", rows: rows.length, mapped: recs.length });
    }
  } else {
    const key = process.env.JEJU_OPEN_DATA_SERVICE_KEY?.trim();
    let rows, mode = "official-csv";
    if (key) {
      try { rows = await fromApi(key); mode = "odcloud-api"; }
      catch (e) { console.warn(`OpenAPI 사용 불가 (${e.message}) → 공식 CSV로 대체`); }
    }
    if (!rows) rows = await fromRemoteCsv();
    const recs = rows.map((r) => normalize(r, "제주시")).filter(Boolean);
    console.log(`${mode}: ${rows.length}건 → 지도 표시 가능 ${recs.length}곳`);
    all.push(...recs);
    sources.push({ provider: "제주시", mode, rows: rows.length, mapped: recs.length });
  }

  // 중복 제거: 같은 id 또는 같은 이름+거의 같은 좌표
  const seen = new Set();
  const toilets = all.filter((t) => {
    const k1 = t.id, k2 = `${t.name}@${t.lat.toFixed(4)},${t.lng.toFixed(4)}`;
    if (seen.has(k1) || seen.has(k2)) return false;
    seen.add(k1); seen.add(k2); return true;
  });

  if (!toilets.length) throw new Error("변환된 화장실이 0곳입니다. CSV 형식을 확인하세요.");

  const refDates = toilets.map((t) => t.ref).filter(Boolean).sort();
  const out = {
    meta: {
      dataset: "제주특별자치도 공중화장실 (공공데이터포털)",
      sourcePages: [DATASET_PAGE],
      sources,
      count: toilets.length,
      referenceDate: refDates.at(-1) || null,
      generatedAt: new Date().toISOString(),
    },
    toilets,
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(out) + "\n", "utf8");
  console.log(`저장 완료: data/toilets.json (${toilets.length}곳)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
