import cors from 'cors';
import express, { type Express } from 'express';
import multer from 'multer';

import { assertReady, config } from './config.js';
import { runAgent } from './agent/runAgent.js';
import { PayloadError, parseUnifiedRequest } from './multimodal/parseRequest.js';
import { weatherByCoords } from './weather/service.js';

/**
 * Express 앱 구성(리스닝 제외). 로컬 서버(server.ts)와 Vercel 함수(api/index.ts)가
 * 공유한다.
 */
export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    }),
  );

  // 메모리 저장(이미지/오디오는 즉시 사용하고 디스크에 남기지 않음).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  });

  let reqCounter = 0;
  const nextRequestId = (): string => {
    reqCounter += 1;
    return `req_${Date.now().toString(36)}_${reqCounter.toString(36)}`;
  };

  app.get('/health', (_req, res) => {
    const ready = assertReady();
    res.json({
      ok: true,
      ready: ready.ok,
      reason: ready.reason,
      model: config.model,
      modelFast: config.modelFast,
      webSearch: config.enableWebSearch,
      serverStt: Boolean(config.groqApiKey),
      accessProtected: Boolean(config.accessToken),
      kweather: Boolean(config.kweatherApiKey),
    });
  });

  // 앱 홈 화면 현재 위치 날씨(케이웨더 우선·폴백 Open-Meteo). 키를 노출하지 않도록 서버 경유.
  app.get('/v1/weather', async (req, res) => {
    if (config.accessToken) {
      const provided =
        req.header('x-access-token') ||
        (typeof req.query.token === 'string' ? req.query.token : '');
      if (provided !== config.accessToken) {
        return res.status(401).json({ ok: false, error: '접근 토큰이 올바르지 않습니다.' });
      }
    }
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, error: 'lat/lon 쿼리가 필요합니다.' });
    }
    const place = typeof req.query.place === 'string' ? req.query.place : undefined;
    try {
      const dto = await weatherByCoords(lat, lon, place);
      if (!dto) return res.status(502).json({ ok: false, error: '날씨 조회에 실패했습니다.' });
      return res.json({ ok: true, ...dto });
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      return res.status(500).json({ ok: false, error: `날씨 처리 실패: ${message}` });
    }
  });

  app.post('/v1/agent/multimodal', upload.any(), async (req, res) => {
    const requestId = nextRequestId();
    res.setHeader('x-request-id', requestId);

    // 선택적 접근 토큰 게이트(공개 URL 비용 남용 방지). 미설정 시 통과.
    if (config.accessToken) {
      const provided =
        req.header('x-access-token') ||
        (typeof req.query.token === 'string' ? req.query.token : '');
      if (provided !== config.accessToken) {
        return res.status(401).json({ ok: false, requestId, error: '접근 토큰이 올바르지 않습니다.' });
      }
    }

    const ready = assertReady();
    if (!ready.ok) {
      return res.status(503).json({ ok: false, requestId, error: ready.reason });
    }

    const startedAt = Date.now();
    try {
      const input = parseUnifiedRequest(req);
      const result = await runAgent(input);
      return res.json({ ok: true, requestId, elapsedMs: Date.now() - startedAt, ...result });
    } catch (err) {
      if (err instanceof PayloadError) {
        return res.status(400).json({ ok: false, requestId, error: err.message });
      }
      console.error(`[${requestId}] 처리 오류:`, err);
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      return res.status(500).json({ ok: false, requestId, error: `에이전트 처리 실패: ${message}` });
    }
  });

  return app;
}
