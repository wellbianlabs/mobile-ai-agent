/**
 * 와이어 계약 미러 — 프론트엔드 src/types/payload.ts 의 IMobileAgentUnifiedPayload 와
 * 동일한 형태를 백엔드에서 신뢰한다. 프론트와 합의 없이 바꾸지 말 것.
 */

export type DeviceKind = 'iOS' | 'Android';
export type NetworkType = 'WiFi' | '5G' | 'LTE';

export interface IMobileAgentUnifiedPayload {
  meta: {
    device: DeviceKind;
    networkType: NetworkType;
    /** 디바이스 기준 절대 시각(epoch ms). */
    sentTimestamp: number;
    /** 프론트가 보낼 수도 있는 로케일(ko-KR 등). 선택. */
    locale?: string;
  };
  inputs: {
    text: string;
    hasAudio: boolean;
    audioData?: {
      /** multipart field name 포인터(보통 "audio"). */
      uri: string;
      format: 'aac' | 'opus';
      durationSec: number;
    };
    images: Array<{
      /** multipart field name 포인터(= fileName). */
      uri: string;
      mimeType: 'image/jpeg';
      fileName: string;
    }>;
  };
}

/** 백엔드 → 프론트 응답. 프론트 AgentResponse 와 호환(ok/requestId/message). */
export interface AgentResponse {
  ok: boolean;
  requestId: string;
  /** 비서의 자연어 답변. */
  message: string;
  /** 사용된 도구 이름 목록(웹검색/날씨 등). UI 배지 표기용. */
  toolsUsed: string[];
  /** 웹검색 인용 출처. */
  citations: Array<{ title?: string; url: string }>;
  /** 음성 첨부가 서버에서 전사되었으면 그 텍스트. */
  transcript?: string;
  /** 처리 시간(ms). */
  elapsedMs: number;
}

// ── 내부 정규화 타입(파서 → 에이전트) ──────────────────────────────────────

export interface NormalizedImage {
  /** image/jpeg 등. */
  mimeType: string;
  /** base64 (data 프리픽스 없음). */
  base64: string;
  fileName: string;
}

export interface NormalizedAudio {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  durationSec: number;
}

export interface NormalizedInput {
  text: string;
  images: NormalizedImage[];
  audio: NormalizedAudio | null;
  meta: IMobileAgentUnifiedPayload['meta'];
}
