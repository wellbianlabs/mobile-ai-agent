import { config } from '../config.js';

import type { HourPoint, NormalizedCurrent, NormalizedToday } from './summary.js';

/**
 * 케이웨더 세계 날씨(World) 연동 — 해외 좌표용.
 *
 *  1) 도시 코드 목록:  kw-code-world1  (5400여 도시, code→위경도/지명; 1회 캐시)
 *  2) 좌표 → 최근접 도시 코드(haversine)
 *  3) 현재 실황:       kw-world-r1/{code}    (temp/senseTemp/humi/ws/daylight/rainF/snowF)
 *  4) 시간별 48h:      kw-world-3d1/{code}   (date/nHour/temp/humi/ws/rainP[] +0h~+47h)
 *
 * 날씨 상태(맑음/구름/비/눈)는 wIcon 범례가 비공개라 강수확률(rainP)·강수/적설 플래그로
 * 도출한다(실데이터 기반). 키 미권한/실패 시 null → 호출부가 Open-Meteo 로 폴백.
 */

export interface KWeatherWorldResult {
  place: string;
  current: NormalizedCurrent;
  today: NormalizedToday;
  hourly: HourPoint[];
}

interface WorldCity {
  code: string;
  lat: number;
  lon: number;
  cityKo: string;
  countryKo: string;
}

const base = () => `${config.kweatherBase}/w3/v2/kw-sensors`;
const key = () => encodeURIComponent(config.kweatherApiKey);

async function kwFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { error?: string; data?: unknown };
    if (json.error && json.error !== '0') return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ── 도시 코드 목록(1회 캐시) ──────────────────────────────────────────────
let cityDirPromise: Promise<WorldCity[]> | null = null;

async function fetchCityDir(): Promise<WorldCity[]> {
  const data = await kwFetch(`${base()}/kw-code-world1?api_key=${key()}`);
  if (!data || typeof data !== 'object') return [];
  const out: WorldCity[] = [];
  for (const [code, entry] of Object.entries(data as Record<string, unknown>)) {
    const d = (entry as { data?: Record<string, unknown> })?.data;
    if (!d) continue;
    const lat = Number(d.lat);
    const lon = Number(d.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      code,
      lat,
      lon,
      cityKo: (typeof d.city_ko === 'string' && d.city_ko) || (d.city_en as string) || '',
      countryKo: (typeof d.country_ko === 'string' && d.country_ko) || (d.country_en as string) || '',
    });
  }
  return out;
}

function getCityDir(): Promise<WorldCity[]> {
  if (!cityDirPromise) {
    cityDirPromise = fetchCityDir().catch(() => {
      cityDirPromise = null; // 실패 시 다음 호출에 재시도
      return [];
    });
  }
  return cityDirPromise;
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

async function nearestCity(lat: number, lon: number): Promise<WorldCity | null> {
  const cities = await getCityDir();
  let best: WorldCity | null = null;
  let bestKm = Infinity;
  for (const c of cities) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  // 최근접 도시가 500km 이상 떨어지면 신뢰도 낮음 → 폴백(Open-Meteo).
  return best && bestKm <= 500 ? best : null;
}

// ── 상태 도출(강수확률·강수/적설 기반) ────────────────────────────────────
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 강수/적설량이 양수여야 강수로 본다(0·null·undefined = 없음). */
function hasPrecip(v: unknown): boolean {
  const n = num(v);
  return n != null && n > 0;
}

/** rainP(%)·강수/적설 플래그 → 한국어 상태. wIcon 범례 비공개 대체. */
function deriveCondition(rainP: number | null, rainF: unknown, snowF: unknown, temp: number | null): string {
  if (hasPrecip(snowF)) return '눈';
  if (hasPrecip(rainF)) return temp != null && temp <= 0 ? '눈' : '비';
  if (rainP != null) {
    if (rainP >= 60) return '비';
    if (rainP >= 40) return '흐림';
    if (rainP >= 20) return '구름많음';
    if (rainP >= 10) return '구름조금';
  }
  return '맑음';
}

export async function getKWeatherWorld(lat: number, lon: number): Promise<KWeatherWorldResult | null> {
  if (!config.kweatherApiKey) return null;

  const city = await nearestCity(lat, lon);
  if (!city) return null;

  const [nowRaw, fcstRaw] = await Promise.all([
    kwFetch(`${base()}/kw-world-r1/${city.code}?api_key=${key()}`),
    kwFetch(`${base()}/kw-world-3d1/${city.code}?api_key=${key()}`),
  ]);

  const now = (nowRaw as { data?: Record<string, unknown> })?.data;
  if (!now) return null;
  const temp = num(now.temp);
  if (temp === null) return null;

  const fcst = (fcstRaw as { data?: Record<string, unknown> })?.data;
  const dates = (fcst?.date as string[] | undefined) ?? [];
  const nHours = (fcst?.nHour as number[] | undefined) ?? [];
  const temps = (fcst?.temp as number[] | undefined) ?? [];
  const rainPs = (fcst?.rainP as number[] | undefined) ?? [];
  const rainFs = (fcst?.rainF as unknown[] | undefined) ?? [];
  const snowFs = (fcst?.snowF as unknown[] | undefined) ?? [];

  // 현재 시각(YYYYMMDDHH) — 예보 배열에서 현재 이후만 취한다.
  const ts = (now.date as string | undefined) ?? (fcstRaw && (fcstRaw as { service?: { timestamp?: string } }).service?.timestamp) ?? '';
  const cutoff = String(ts).slice(0, 10); // YYYYMMDDHH

  const hourly: HourPoint[] = [];
  let todayMax: number | null = null;
  let todayMin: number | null = null;
  let todayPopMax: number | null = null;
  const todayDate = dates[0] ?? cutoff.slice(0, 8);

  for (let i = 0; i < dates.length && hourly.length < 24; i++) {
    const date = dates[i];
    const hh = nHours[i];
    const t = temps[i];
    if (!date || typeof hh !== 'number' || typeof t !== 'number') continue;
    const stamp = `${date}${String(hh).padStart(2, '0')}`; // YYYYMMDDHH
    const rainP = num(rainPs[i]);

    // 오늘 최고/최저/최대강수확률 집계.
    if (date === todayDate) {
      todayMax = todayMax == null ? t : Math.max(todayMax, t);
      todayMin = todayMin == null ? t : Math.min(todayMin, t);
      if (rainP != null) todayPopMax = todayPopMax == null ? rainP : Math.max(todayPopMax, rainP);
    }

    if (stamp < cutoff) continue; // 과거 시각 제외
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${String(hh).padStart(2, '0')}:00`;
    hourly.push({
      time: iso,
      tempC: Math.round(t),
      popPct: rainP,
      condition: deriveCondition(rainP, rainFs[i], snowFs[i], t),
      isDay: hh >= 6 && hh < 19,
    });
  }

  const firstPop = hourly[0]?.popPct ?? null;
  const condition = deriveCondition(firstPop, now.rainF, now.snowF, temp);
  const isDay = now.daylight === 'D';
  // 지명은 실황 응답(kw-world-r1)의 한국어 도시/국가명을 우선(디렉터리는 한글명이 비어있을 수 있음).
  const cityKo = (typeof now.cityKo === 'string' && now.cityKo) || (now.cityEn as string) || city.cityKo;
  const countryKo =
    (typeof now.countryKo === 'string' && now.countryKo) || (now.countryEn as string) || city.countryKo;
  const place = [cityKo, countryKo].filter(Boolean).join(', ') || '현재 위치';

  return {
    place,
    current: {
      temperatureC: temp,
      feelsLikeC: num(now.senseTemp) ?? temp,
      humidityPct: num(now.humi) ?? 0,
      windMs: num(now.ws) ?? 0,
      condition,
      isDay,
      raining: hasPrecip(now.rainF) || hasPrecip(now.snowF) || (firstPop != null && firstPop >= 60),
    },
    today: { maxC: todayMax, minC: todayMin, precipProbabilityPct: todayPopMax },
    hourly,
  };
}
