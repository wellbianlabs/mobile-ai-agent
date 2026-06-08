import { createApp } from '../src/app.js';

/**
 * Vercel 서버리스 함수 진입점.
 * Express 앱 인스턴스는 (req, res) 핸들러이므로 그대로 default export 한다.
 * vercel.json 의 rewrite 로 모든 경로가 이 함수로 들어오고, Express 가 라우팅한다.
 */
const app = createApp();

export default app;
