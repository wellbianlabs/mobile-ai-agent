/**
 * 해양 기상(파고·주기·너울) — Open-Meteo Marine. 키 불필요.
 * 해안/해상 좌표에서만 값이 있고, 내륙은 wave_height=null → null 반환.
 * 해양·수산/해운·항만 등 전문 대응(조업·출항·하역·양식)의 근거로 쓴다.
 */

export interface Marine {
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  swellM: number | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function getMarine(lat: number, lon: number): Promise<Marine | null> {
  const url =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&current=wave_height,wave_period,wave_direction,swell_wave_height&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: Record<string, unknown> };
    const c = data.current ?? {};
    const waveHeightM = num(c.wave_height);
    if (waveHeightM === null) return null; // 내륙(해상 격자 없음)
    return {
      waveHeightM,
      wavePeriodS: num(c.wave_period),
      waveDir: num(c.wave_direction),
      swellM: num(c.swell_wave_height),
    };
  } catch {
    return null;
  }
}
