import type { Request } from 'express';

import type {
  ConversationMessage,
  IMobileAgentUnifiedPayload,
  NormalizedAudio,
  NormalizedImage,
  NormalizedInput,
} from '../types.js';

/**
 * multer 가 채운 multipart 요청을 정규화한다.
 *
 * 폼 구조(프론트 agentClient.ts 와 동일):
 *   - "payload"           : IMobileAgentUnifiedPayload JSON 문자열
 *   - "audio"             : 오디오 파일 파트(hasAudio 일 때)
 *   - <fileName> (image)  : 이미지 파일 파트들(각 images[i].fileName 이름)
 *
 * JSON 내 uri 는 해당 파일 파트의 field name 포인터다.
 */

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude 이미지 권장 상한 여유.
const MAX_HISTORY_MESSAGES = 12; // user/assistant 합산 상한(≈6턴). 컨텍스트 폭주 방지.
const MAX_HISTORY_CHARS = 4000; // 메시지 1건 길이 상한.

type MulterFile = Express.Multer.File;

/** 클라이언트가 보낸 history 를 검증·정규화한다(역할/텍스트 확인, 길이 제한). */
function normalizeHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim()) {
      out.push({ role, text: text.trim().slice(0, MAX_HISTORY_CHARS) });
    }
  }
  // 최신 N개만 유지. Claude 는 user 로 시작하는 교차 배열을 요구하므로,
  // 선두가 assistant 면 잘라내 user 로 시작하도록 맞춘다.
  const tail = out.slice(-MAX_HISTORY_MESSAGES);
  while (tail[0]?.role === 'assistant') tail.shift();
  return tail;
}

function filesByField(req: Request): Map<string, MulterFile[]> {
  const map = new Map<string, MulterFile[]>();
  const files = req.files;
  if (Array.isArray(files)) {
    for (const f of files) {
      const arr = map.get(f.fieldname) ?? [];
      arr.push(f);
      map.set(f.fieldname, arr);
    }
  }
  return map;
}

export class PayloadError extends Error {}

export function parseUnifiedRequest(req: Request): NormalizedInput {
  const raw = req.body?.payload;
  if (typeof raw !== 'string') {
    throw new PayloadError('multipart 필드 "payload"(JSON 문자열)가 없습니다.');
  }

  let wire: IMobileAgentUnifiedPayload;
  try {
    wire = JSON.parse(raw) as IMobileAgentUnifiedPayload;
  } catch {
    throw new PayloadError('"payload" JSON 파싱에 실패했습니다.');
  }

  if (!wire?.inputs || !wire?.meta) {
    throw new PayloadError('payload 구조가 올바르지 않습니다(meta/inputs 누락).');
  }

  const fields = filesByField(req);

  // ── 이미지 ──
  const images: NormalizedImage[] = [];
  for (const imgRef of wire.inputs.images ?? []) {
    if (images.length >= MAX_IMAGES) break;
    const part = fields.get(imgRef.uri)?.[0];
    if (!part) continue; // 포인터에 해당하는 파일 파트가 없으면 건너뜀(관대 처리).
    if (!ALLOWED_IMAGE_MIME.has(part.mimetype)) continue;
    if (part.size > MAX_IMAGE_BYTES) continue;
    images.push({
      mimeType: part.mimetype,
      base64: part.buffer.toString('base64'),
      fileName: imgRef.fileName || part.originalname || 'image.jpg',
    });
  }

  // ── 오디오 ──
  let audio: NormalizedAudio | null = null;
  if (wire.inputs.hasAudio && wire.inputs.audioData) {
    const part = fields.get(wire.inputs.audioData.uri)?.[0];
    if (part) {
      audio = {
        buffer: part.buffer,
        mimeType: part.mimetype || 'audio/m4a',
        fileName: part.originalname || 'voice.m4a',
        durationSec: wire.inputs.audioData.durationSec ?? 0,
      };
    }
  }

  return {
    text: (wire.inputs.text ?? '').trim(),
    images,
    audio,
    meta: wire.meta,
    history: normalizeHistory(wire.history),
  };
}
