# 나만의 모바일 AI 비서 (mobile-ai-agent)

멀티모달 입력 인터페이스(React Native/Expo)에 **LLM 두뇌(Claude tool-use 백엔드)**를
붙인 개인 모바일 AI 비서입니다. 텍스트·음성·이미지를 하나로 묶어 보내면 비서가
**웹/자료 검색 · 통역/번역 · 날씨 · 사진/음성 이해**로 답합니다.

이 저장소는 **백엔드(두뇌) + 웹 테스터**이며, Vercel 서버리스로 배포됩니다.
모바일 앱(Expo) 소스는 별도이며 이 백엔드 URL 을 가리키도록 설정합니다.

```
[모바일 앱(Expo)]  --multipart-->  [Vercel 서버리스(api/index.ts)]  --tool-use-->  [Claude API]
  텍스트/음성/이미지                  Express 앱(src/app.ts)                       ├─ web_search (네이티브, 키 불필요)
  IMobileAgentUnifiedPayload                                                      ├─ get_weather (Open-Meteo, 키 불필요)
                                                                                  ├─ 통역/번역 (모델 자체)
                                                                                  ├─ 이미지 이해 (멀티모달)
                                                                                  └─ 음성 전사 (선택: Groq Whisper)
```

> 앱·저장소에는 API 키를 두지 않습니다(유출 방지). 키는 Vercel 환경변수에만 둡니다.

---

## 레이아웃

```
mobile-ai-agent/
├─ api/index.ts          # Vercel 서버리스 진입점 (Express 앱 export)
├─ src/
│  ├─ app.ts             # Express 앱 구성(라우트·도구 게이트) — 로컬/배포 공용
│  ├─ server.ts          # 로컬 개발 서버(app.listen)
│  ├─ config.ts          # 환경설정
│  ├─ types.ts           # 와이어 계약 미러
│  ├─ agent/             # Claude tool-use 루프 + 시스템 프롬프트 + 도구(weather)
│  └─ multimodal/        # multipart 파서 + 선택적 STT
├─ public/index.html     # 웹 테스터(정적, 배포 시 같은 오리진 호출)
├─ scripts/smoke.ts      # 로컬 스모크 테스트
├─ vercel.json           # 라우팅(rewrite) + 함수 maxDuration
└─ .env.example
```

---

## 환경변수

| 변수 | 필수 | 설명 |
|---|:--:|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API 키 (https://console.anthropic.com) |
| `AGENT_ACCESS_TOKEN` | 권장 | 설정 시 `/v1/agent` 호출에 `x-access-token` 헤더 일치 필요(공개 URL 비용 보호) |
| `AGENT_MODEL` |  | 기본 `claude-sonnet-4-6` |
| `ENABLE_WEB_SEARCH` |  | 기본 `true` (Claude 네이티브 웹검색) |
| `GROQ_API_KEY` |  | 음성 파일 서버 전사(Whisper)용, 선택 |
| `PORT` |  | 로컬 포트(기본 8787) |

---

## 로컬 실행

```powershell
npm install
copy .env.example .env       # .env 에 ANTHROPIC_API_KEY 채우기
npm run dev                  # http://localhost:8787
```

- 상태확인: `http://localhost:8787/health`
- **웹 테스터:** `public/index.html` 더블클릭 → 질문/이미지 전송
- 자동 검증: `npm run smoke` (번역·날씨·웹검색 3종)

---

## Vercel 배포

이 저장소는 Vercel "Other" 프로젝트로 바로 배포됩니다(빌드 설정 불필요).

1. Vercel 에 이 GitHub 저장소를 Import (또는 `vercel` CLI / MCP 로 배포).
2. **Project → Settings → Environment Variables** 에 추가:
   - `ANTHROPIC_API_KEY` = (본인 Claude 키)  ← 없으면 API 가 503
   - `AGENT_ACCESS_TOKEN` = (임의의 긴 문자열)  ← 비용 보호용, 강력 권장
3. 재배포(또는 첫 배포) 후:
   - 웹 테스터: `https://<프로젝트>.vercel.app/`
   - API: `https://<프로젝트>.vercel.app/v1/agent/multimodal`
   - 상태: `https://<프로젝트>.vercel.app/health`

> `AGENT_ACCESS_TOKEN` 을 설정하면 웹 테스터/앱에서 같은 토큰을 입력해야 호출됩니다.
> (웹 테스터 상단 "접근 토큰" 칸, 앱은 향후 설정 화면에서 주입)

### ⚠️ 공개 URL 보안
- 토큰 미설정 시 공개 엔드포인트는 **누구나 호출 → 당신의 Claude 비용 소진** 가능.
  반드시 `AGENT_ACCESS_TOKEN` 을 설정하세요.
- 서버리스 함수 `maxDuration` 은 60초(웹검색·다중 도구 호출 여유). Hobby 플랜 상한.

---

## 모바일 앱 연결 (Expo)

별도 RN 앱(`../Multi-Modal Interface`)을 이 백엔드로 연결:

```powershell
cd "..\Multi-Modal Interface"
npm install
# 로컬 백엔드: 안드로이드 에뮬레이터 10.0.2.2 / iOS·웹 localhost (자동)
# 배포 백엔드:
$env:EXPO_PUBLIC_AGENT_ENDPOINT = "https://<프로젝트>.vercel.app/v1/agent/multimodal"
npm start                     # Expo Go 로 QR 스캔(폰)
```

> 이 개발 호스트는 가상화 가속이 없어 **안드로이드 에뮬레이터를 부팅할 수 없습니다**
> (`emulator -accel-check` → hypervisor driver not installed). 실기기 테스트는 Expo Go,
> 빠른 검증은 웹 테스터를 사용하세요.

---

## 도구 요약

- **웹/자료 검색** — Claude 네이티브 `web_search`. 최신 사실·시세·뉴스는 검색 후 답하고 출처 첨부.
- **통역/번역** — 모델 자체 다국어 능력.
- **날씨** — `get_weather`(Open-Meteo, 무료). 지명→위경도→현재+예보.
- **이미지 이해** — 첨부 이미지를 멀티모달로 직접 해석.
- **음성** — 온디바이스 STT 는 텍스트로 전송. 오디오 파일은 `GROQ_API_KEY` 있으면 서버 전사.

---

## 와이어 계약

프론트 `src/types/payload.ts` 의 `IMobileAgentUnifiedPayload` ↔ 백엔드 `src/types.ts` 동일.

## 로드맵

- [ ] 2단계 능동형(아침 브리핑/알림 스케줄·푸시)
- [ ] 대화 메모리(이전 턴 맥락)
- [ ] 캘린더·메일 등 도구 확장
