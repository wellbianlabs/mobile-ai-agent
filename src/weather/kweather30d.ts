import { config } from '../config.js';

import type { DayPoint } from './summary.js';

/**
 * 케이웨더 30일 장기전망(kw-30d24h) — 국내 전용.
 *
 * 응답은 한국을 7개 권역("1"~"7")으로 나눠 +0d~+30d 일별 배열을 준다
 * (appDate/weather/issueMaxTemp/issueMinTemp ...). 좌표→권역은 표준 권역 센트로이드
 * 최근접으로 추정한다(문서에 권역 인덱스 정의가 비공개라 추정). 화면에 권역명을 표기해
 * 검증 가능하게 한다.
 *
 * ⚠️ 장기전망은 추세 위주(2주 이후 신뢰도 낮음), 권역 단위(도시 정밀 아님).
 */

export interface KWeather30dResult {
  region: string;
  days: DayPoint[];
}

/** 표준 7권역(인덱스 1~7) — 센트로이드 + 권역명(추정 순서, 화면 표기로 검증). */
const REGIONS: Array<{ idx: string; name: string; lat: number; lon: number }> = [
  { idx: '1', name: '수도권', lat: 37.4, lon: 127.0 },
  { idx: '2', name: '강원', lat: 37.8, lon: 128.3 },
  { idx: '3', name: '충청', lat: 36.5, lon: 127.3 },
  { idx: '4', name: '전라', lat: 35.2, lon: 127.0 },
  { idx: '5', name: '경북', lat: 36.3, lon: 128.7 },
  { idx: '6', name: '경남', lat: 35.3, lon: 128.8 },
  { idx: '7', name: '제주', lat: 33.4, lon: 126.5 },
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

function nearestRegion(lat: number, lon: number): (typeof REGIONS)[number] {
  let best = REGIONS[0]!;
  let bestKm = Infinity;
  for (const r of REGIONS) {
    const km = haversineKm(lat, lon, r.lat, r.lon);
    if (km < bestKm) {
      bestKm = km;
      best = r;
    }
  }
  return best;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function getKWeather30d(lat: number, lon: number): Promise<KWeather30dResult | null> {
  if (!config.kweatherApiKey || !inKorea(lat, lon)) return null;

  const region = nearestRegion(lat, lon);
  const url = `${config.kweatherBase}/w3/v2/kw-sensors/kw-30d24h?api_key=${encodeURIComponent(
    config.kweatherApiKey,
  )}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { error?: string; data?: Record<string, unknown> };
    if ((json.error && json.error !== '0') || !json.data) return null;

    const entry = json.data[region.idx] as { data?: Record<string, unknown> } | undefined;
    const d = entry?.data;
    if (!d) return null;

    const appDate = (d.appDate as string[] | undefined) ?? [];
    const weather = (d.weather as string[] | undefined) ?? [];
    const maxs = (d.issueMaxTemp as number[] | undefined) ?? [];
    const mins = (d.issueMinTemp as number[] | undefined) ?? [];

    const days: DayPoint[] = [];
    for (let i = 0; i < appDate.length; i++) {
      const date = appDate[i];
      if (!date || date.length < 8) continue;
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      const max = num(maxs[i]);
      const min = num(mins[i]);
      const w = weather[i];
      days.push({
        date: iso,
        maxC: max != null ? Math.round(max) : null,
        minC: min != null ? Math.round(min) : null,
        popPct: null, // 30일 전망은 강수확률 미제공(강수량 텍스트만)
        condition: typeof w === 'string' ? w.trim() : '',
      });
    }
    if (days.length === 0) return null;
    return { region: region.name, days: days.slice(0, 30) };
  } catch {
    return null;
  }
}
