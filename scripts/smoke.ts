/**
 * 로컬 스모크 테스트. 서버가 떠 있는 상태에서 실행:
 *   npm run dev   (다른 터미널)
 *   npm run smoke
 *
 * 프론트와 동일한 multipart 구조(payload JSON 파트)를 흉내 내 몇 가지 질문을 보낸다.
 */

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8787';

function wirePayload(text: string) {
  return {
    meta: { device: 'Android', networkType: 'WiFi', sentTimestamp: Date.now(), locale: 'ko-KR' },
    inputs: { text, hasAudio: false, images: [] },
  };
}

async function ask(label: string, text: string): Promise<void> {
  const form = new FormData();
  form.append('payload', JSON.stringify(wirePayload(text)));

  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/agent/multimodal`, { method: 'POST', body: form });
  const data = (await res.json()) as Record<string, unknown>;
  console.log(`\n=== ${label} (${Date.now() - t0}ms, HTTP ${res.status}) ===`);
  console.log('Q:', text);
  console.log('A:', data.message ?? data.error);
  if (Array.isArray(data.toolsUsed) && data.toolsUsed.length) {
    console.log('tools:', data.toolsUsed.join(', '));
  }
  if (Array.isArray(data.citations) && data.citations.length) {
    console.log('출처:', (data.citations as Array<{ url: string }>).map((c) => c.url).join(', '));
  }
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('health:', JSON.stringify(health));

  await ask('번역(통역)', '"이번 주말에 등산 갈래?"를 영어랑 일본어로 번역해줘.');
  await ask('날씨', '서울 내일 날씨 어때? 우산 챙겨야 해?');
  await ask('웹검색', '오늘 기준 최신 아이폰 모델 이름이 뭐야?');
}

main().catch((e) => {
  console.error('스모크 실패:', e);
  process.exit(1);
});
