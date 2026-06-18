import 'dotenv/config';

/**
 * 환경설정 단일 소스. .env(또는 프로세스 환경)에서 읽어 타입 있는 값으로 노출한다.
 * 비밀값(키)은 절대 클라이언트로 내려가지 않으며 이 백엔드 안에서만 사용한다.
 */

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return !['false', '0', 'no', 'off'].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int(process.env.PORT, 8787),

  /** Claude API 키. 없으면 기동은 되지만 /v1/agent 호출 시 503. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  /** 두뇌 모델 — 최상위급(Opus). 케이웨더 영업 파트너급 품질 목표. */
  model: process.env.AGENT_MODEL ?? 'claude-opus-4-8',

  /** 근거(논문·통계·표) 포함 풍부한 답변 위해 상향. */
  maxTokens: int(process.env.AGENT_MAX_TOKENS, 4096),

  /** tool-use 루프 안전 상한(웹검색 근거 수집 여유). */
  maxAgentTurns: int(process.env.MAX_AGENT_TURNS, 8),

  /** Claude 네이티브 웹검색 도구 활성화. */
  enableWebSearch: bool(process.env.ENABLE_WEB_SEARCH, true),

  /** 선택적 서버측 STT(Groq Whisper). 없으면 음성 파일 전사를 건너뛴다. */
  groqApiKey: process.env.GROQ_API_KEY ?? '',

  /**
   * 케이웨더(KWeather) Air365 OpenAPI 키. 설정하면 한국 좌표의 날씨를
   * 케이웨더(한국 현지·정밀)로 조회하고, 실패/해외는 Open-Meteo 로 폴백한다.
   * 미설정 시 항상 Open-Meteo 사용.
   */
  kweatherApiKey: process.env.KWEATHER_API_KEY ?? '',
  kweatherBase: process.env.KWEATHER_BASE ?? 'https://gateway.kweather.co.kr:8443/weather',

  /**
   * 선택적 접근 토큰. 설정하면 /v1/agent 호출 시 x-access-token 헤더(또는 ?token=)가
   * 일치해야 한다. 공개 배포(Vercel) URL 에서 API 키 비용 남용을 막는 용도.
   */
  accessToken: process.env.AGENT_ACCESS_TOKEN ?? '',

  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export function assertReady(): { ok: boolean; reason?: string } {
  if (!config.anthropicApiKey) {
    return { ok: false, reason: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env 를 확인하세요.' };
  }
  return { ok: true };
}
