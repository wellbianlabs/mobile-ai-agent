import { config } from '../config.js';

/**
 * 기상청(KMA) API허브 ASOS 일자료(kma_sfcdd3) 연동 — 한국 과거관측.
 * 좌표→최근접 ASOS 관측소 매핑 후, "오늘과 같은 날짜"를 최근 N년 조회해
 * "과거 오늘"과 "예년 평균"을 만든다. 응답은 고정폭 텍스트(주석 # + 데이터행).
 *
 * 컬럼(공백 분리): 0 YYYYMMDD, 1 STN, 10 TA_AVG, 11 TA_MAX, 13 TA_MIN, 38 RN_DAY.
 * 결측: 온도는 -50 이하를 결측 처리(겨울 -9℃ 보존), 강수 음수는 0(무강수).
 */

export interface PastToday {
  /** 관측소명. */
  station: string;
  /** MM-DD 라벨. */
  date: string;
  /** 예년 평균에 사용한 연수. */
  sampleYears: number;
  normalMaxC: number | null;
  normalMinC: number | null;
  normalAvgC: number | null;
  /** 가장 최근 연도의 같은 날. */
  lastYear: { year: number; maxC: number | null; minC: number | null; rainMm: number | null } | null;
}

interface Station {
  id: number;
  name: string;
  lat: number;
  lon: number;
}

// 주요 ASOS 관측소(좌표→최근접 매핑용).
const STATIONS: Station[] = [
  { id: 90, name: '속초', lat: 38.2509, lon: 128.5647 },
  { id: 100, name: '대관령', lat: 37.6771, lon: 128.7183 },
  { id: 101, name: '춘천', lat: 37.9026, lon: 127.7357 },
  { id: 105, name: '강릉', lat: 37.7515, lon: 128.891 },
  { id: 108, name: '서울', lat: 37.5714, lon: 126.9658 },
  { id: 112, name: '인천', lat: 37.4776, lon: 126.6249 },
  { id: 114, name: '원주', lat: 37.3376, lon: 127.9466 },
  { id: 115, name: '울릉도', lat: 37.4811, lon: 130.8986 },
  { id: 119, name: '수원', lat: 37.2723, lon: 126.9853 },
  { id: 127, name: '충주', lat: 36.9705, lon: 127.9527 },
  { id: 129, name: '서산', lat: 36.7766, lon: 126.4939 },
  { id: 131, name: '청주', lat: 36.6392, lon: 127.4407 },
  { id: 133, name: '대전', lat: 36.372, lon: 127.3721 },
  { id: 135, name: '추풍령', lat: 36.2206, lon: 127.9946 },
  { id: 138, name: '포항', lat: 36.0329, lon: 129.38 },
  { id: 140, name: '군산', lat: 36.0053, lon: 126.7614 },
  { id: 143, name: '대구', lat: 35.8784, lon: 128.6531 },
  { id: 146, name: '전주', lat: 35.8408, lon: 127.119 },
  { id: 152, name: '울산', lat: 35.5821, lon: 129.337 },
  { id: 156, name: '광주', lat: 35.1729, lon: 126.8916 },
  { id: 159, name: '부산', lat: 35.1047, lon: 129.032 },
  { id: 162, name: '통영', lat: 34.8454, lon: 128.4356 },
  { id: 165, name: '목포', lat: 34.8172, lon: 126.3814 },
  { id: 168, name: '여수', lat: 34.7392, lon: 127.7406 },
  { id: 184, name: '제주', lat: 33.5141, lon: 126.5297 },
  { id: 189, name: '서귀포', lat: 33.2461, lon: 126.5653 },
  { id: 192, name: '진주', lat: 35.1636, lon: 128.0401 },
  { id: 201, name: '강화', lat: 37.7073, lon: 126.446 },
  { id: 232, name: '천안', lat: 36.7793, lon: 127.1219 },
  { id: 235, name: '보령', lat: 36.3273, lon: 126.5577 },
  { id: 247, name: '남원', lat: 35.4213, lon: 127.3963 },
  { id: 277, name: '영덕', lat: 36.5331, lon: 129.4093 },
  { id: 279, name: '구미', lat: 36.1308, lon: 128.3206 },
  { id: 284, name: '거창', lat: 35.6671, lon: 127.9116 },
  { id: 294, name: '거제', lat: 34.8881, lon: 128.6044 },
];

function inKorea(lat: number, lon: number): boolean {
  return lat >= 33.0 && lat <= 38.7 && lon >= 124.5 && lon <= 132.0;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function nearestStation(lat: number, lon: number): Station {
  let best = STATIONS[0]!;
  let bestKm = Infinity;
  for (const s of STATIONS) {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  return best;
}

function parseTemp(v: string | undefined): number | null {
  const f = Number(v);
  return Number.isFinite(f) && f > -50 ? f : null;
}
function parseRain(v: string | undefined): number | null {
  const f = Number(v);
  if (!Number.isFinite(f)) return null;
  return f < 0 ? 0 : f; // -9 = 무강수
}

interface DailyRow {
  maxC: number | null;
  minC: number | null;
  avgC: number | null;
  rainMm: number | null;
}

async function fetchDaily(stnId: number, yyyymmdd: string): Promise<DailyRow | null> {
  const url =
    `${config.kmaApiBase}/kma_sfcdd3.php?tm1=${yyyymmdd}&tm2=${yyyymmdd}` +
    `&stn=${stnId}&authKey=${encodeURIComponent(config.kmaApiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const text = await res.text();
    const row = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (!row) return null;
    const t = row.split(/\s+/);
    if (t.length < 39 || t[0] !== yyyymmdd) return null;
    return {
      avgC: parseTemp(t[10]),
      maxC: parseTemp(t[11]),
      minC: parseTemp(t[13]),
      rainMm: parseRain(t[38]),
    };
  } catch {
    return null;
  }
}

function avg(nums: Array<number | null>): number | null {
  const xs = nums.filter((n): n is number => n != null);
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

/** Asia/Seoul 기준 MM-DD 와 연도. */
function kstNow(): { mm: string; dd: string; year: number } {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const iso = k.toISOString();
  return { mm: iso.slice(5, 7), dd: iso.slice(8, 10), year: Number(iso.slice(0, 4)) };
}

const cache = new Map<string, PastToday>();
const SAMPLE_YEARS = 5;

/** 과거 오늘 + 예년(최근 N년) 평균. 한국·키 있을 때만, 서버 캐시. */
export async function getKmaPastToday(lat: number, lon: number): Promise<PastToday | null> {
  if (!config.kmaApiKey || !inKorea(lat, lon)) return null;

  const st = nearestStation(lat, lon);
  const { mm, dd, year } = kstNow();
  if (mm === '02' && dd === '29') return null; // 윤일 회피(간단화)
  const cacheKey = `${st.id}-${mm}${dd}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const years = Array.from({ length: SAMPLE_YEARS }, (_, i) => year - 1 - i);
  const rows = await Promise.all(years.map((y) => fetchDaily(st.id, `${y}${mm}${dd}`)));

  const valid = rows.map((r, i) => ({ year: years[i]!, r })).filter((x) => x.r);
  if (valid.length === 0) return null;

  const lastY = valid[0]!; // 가장 최근 연도
  const result: PastToday = {
    station: st.name,
    date: `${mm}-${dd}`,
    sampleYears: valid.length,
    normalMaxC: avg(valid.map((x) => x.r!.maxC)),
    normalMinC: avg(valid.map((x) => x.r!.minC)),
    normalAvgC: avg(valid.map((x) => x.r!.avgC)),
    lastYear: {
      year: lastY.year,
      maxC: lastY.r!.maxC,
      minC: lastY.r!.minC,
      rainMm: lastY.r!.rainMm,
    },
  };
  cache.set(cacheKey, result);
  return result;
}
