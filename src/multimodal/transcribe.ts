import { config } from '../config.js';
import type { NormalizedAudio } from '../types.js';

/**
 * 선택적 서버측 음성 전사(STT).
 *
 * 온디바이스 음성검색은 이미 텍스트로 변환되어 payload.text 로 도착하므로
 * 보통 이 함수가 필요 없다. 단 hold-to-talk 으로 첨부된 "오디오 파일"은 전사되지
 * 않은 상태이므로, GROQ_API_KEY 가 있으면 Groq Whisper(whisper-large-v3)로 전사한다.
 *
 * 키가 없으면 null 을 반환하고 에이전트는 텍스트/이미지만으로 진행한다.
 */
export async function transcribeAudio(audio: NormalizedAudio): Promise<string | null> {
  if (!config.groqApiKey) return null;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType });
  form.append('file', blob, audio.fileName);
  form.append('model', 'whisper-large-v3');
  // 언어 자동 감지에 맡긴다(통역 시 원어 보존이 중요).

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.warn('[transcribe] Groq STT 실패:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.warn('[transcribe] STT 예외:', (err as Error).message);
    return null;
  }
}
