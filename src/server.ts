import { createApp } from './app.js';
import { assertReady, config } from './config.js';

/**
 * 로컬 개발용 HTTP 서버. (Vercel 배포는 api/index.ts 가 createApp() 을 사용한다.)
 *   - POST /v1/agent/multimodal : 멀티모달 페이로드 처리 → 비서 응답
 *   - GET  /health              : 상태 점검
 */
const app = createApp();

app.listen(config.port, () => {
  const ready = assertReady();
  console.log(`▶ AI 비서 백엔드 기동: http://localhost:${config.port}`);
  console.log(
    `  모델: ${config.model} | 웹검색: ${config.enableWebSearch} | 서버STT: ${Boolean(config.groqApiKey)} | 접근보호: ${Boolean(config.accessToken)}`,
  );
  if (!ready.ok) console.warn(`  ⚠ ${ready.reason}`);
});
