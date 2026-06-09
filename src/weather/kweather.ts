import { config } from '../config.js';

/**
 * 케이웨더(KWeather) Air365 OpenAPI 연동.
 *
 *  1) GPS(lat/lon) → 행정코드(hcode):  w4/v2/gis-loc2addr
 *  2) 현재 실황:                       w3/v2/kw-sensors/kw-odam1/{hcode}
 *  3) 단기예보:                        w3/v2/kw-sensors/kw-shrt1/{hcode}
 *
 * 인증: ?api_key=...  (config.kweatherApiKey)
 * 한국 외 좌표/실패 시 null 을 반환해 호출부가 Open-Meteo 로 폴백하게 한다.
 */

export interface KWeatherResult {
  source: 'KWeather';
  place: string;
  hcode: number;
  current: {
    temperatureC: number;
    feelsLikeC: number;
    humidityPct: number;
    rain1hMm: number;
    /** 강수형태 코드(0 없음). */
    pty: number;
    windMs: number;
    condition: string; // wText (맑음/비/...)
    wIcon: number;
    isDay: boolean;
  };
  today: {
    maxC: number | null;
    minC: number | null;
    /** 향후 강수확률 최대(%) — '비 올 가능성' 판단용. */
    precipProbabilityPct: number | null;
  };
}

const PTY_TEXT: Record<number, string> = {
  0: '없음',
  1: '비',
  2: '비/눈',
  3: '눈',
  4: '소나기',
  5: '빗방울',
  6: '빗방울/눈날림',
  7: '눈날림',
};

interface LocAddr {
  state?: string;
  city?: string;
  city2?: string;
  hcode?: number;
}

async function kwFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { error?: string; data?: unknown };
    if (json.error && json.error !== '0') return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** GPS → 행정코드 + 지명. 한국 외/실패 시 null. */
async function loc2addr(lat: number, lon: number): Promise<LocAddr | null> {
  const url =
    `${config.kweatherBase}/w4/v2/gis-loc2addr` +
    `?api_key=${encodeURIComponent(config.kweatherApiKey)}&lat=${lat}&lon=${lon}`;
  const data = (await kwFetch(url)) as LocAddr | null;
  if (!data || !data.hcode) return null;
  return data;
}

/** kw-odam1 / kw-shrt1 응답에서 첫 코드 항목의 data 를 꺼낸다. */
function firstEntryData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const first = Object.values(data as Record<string, unknown>)[0] as
    | { data?: Record<string, unknown> }
    | undefined;
  return first?.data ?? null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 대한민국 경계 박스(제주·울릉·독도 포함). 밖이면 케이웨더가 부정확하므로 사용하지 않는다. */
function inKorea(lat: number, lon: number): boolean {
  return lat >= 33.0 && lat <= 38.7 && lon >= 124.5 && lon <= 132.0;
}

export async function getKWeather(lat: number, lon: number): Promise<KWeatherResult | null> {
  if (!config.kweatherApiKey) return null;
  if (!inKorea(lat, lon)) return null; // 해외 → Open-Meteo 폴백.

  const addr = await loc2addr(lat, lon);
  if (!addr?.hcode) return null;
  const hcode = addr.hcode;

  const base = `${config.kweatherBase}/w3/v2/kw-sensors`;
  const key = encodeURIComponent(config.kweatherApiKey);

  const [nowRaw, fcstRaw] = await Promise.all([
    kwFetch(`${base}/kw-odam1/${hcode}?api_key=${key}`),
    kwFetch(`${base}/kw-shrt1/${hcode}?api_key=${key}`),
  ]);

  const now = firstEntryData(nowRaw);
  if (!now) return null;

  const t1h = num(now.t1h);
  if (t1h === null) return null; // 실황 기온이 없으면 케이웨더 실패로 간주.

  const pty = num(now.pty) ?? 0;
  const wText =
    (typeof now.wText === 'string' && now.wText.trim()) || (pty > 0 ? PTY_TEXT[pty] ?? '비' : '맑음');

  // 낮/밤: 케이웨더 timestamp(YYYYMMDDHHmm) 시각으로 근사.
  let isDay = true;
  const firstNow = nowRaw && typeof nowRaw === 'object' ? Object.values(nowRaw as Record<string, unknown>)[0] : null;
  const ts = (firstNow as { service?: { timestamp?: string | number } })?.service?.timestamp;
  if (ts != null) {
    const hh = Number(String(ts).slice(8, 10));
    if (Number.isFinite(hh)) isDay = hh >= 6 && hh < 19;
  }

  // 단기예보: 오늘 최저/최고 + 향후 강수확률 최대.
  const fcst = firstEntryData(fcstRaw);
  let maxC: number | null = null;
  let minC: number | null = null;
  let pop: number | null = null;
  if (fcst) {
    const tmx = fcst.tmx as number[] | undefined;
    const tmn = fcst.tmn as number[] | undefined;
    const popArr = fcst.pop as number[] | undefined;
    maxC = Array.isArray(tmx) && tmx.length ? num(tmx[0]) : null;
    minC = Array.isArray(tmn) && tmn.length ? num(tmn[0]) : null;
    if (Array.isArray(popArr) && popArr.length) {
      pop = Math.max(...popArr.slice(0, 12).map((p) => (typeof p === 'number' ? p : 0)));
    }
  }

  const place = [addr.city, addr.city2].filter(Boolean).join(' ') || addr.state || '현재 위치';

  return {
    source: 'KWeather',
    place,
    hcode,
    current: {
      temperatureC: t1h,
      feelsLikeC: num(now.senseTemp) ?? t1h,
      humidityPct: num(now.reh) ?? 0,
      rain1hMm: num(now.rn1) ?? 0,
      pty,
      windMs: num(now.wsd) ?? 0,
      condition: wText,
      wIcon: num(now.wIcon) ?? 0,
      isDay,
    },
    today: { maxC, minC, precipProbabilityPct: pop },
  };
}
