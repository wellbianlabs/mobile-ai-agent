# 핸드오프북 — 나만의 모바일 AI 비서

> 새 Claude 세션/계정이 이 문서만 읽고 작업을 이어갈 수 있도록 정리한 인수인계 노트.
> 최종 업데이트: 2026-06-16 — **wellbianlabs 계정으로 이전 완료**(GitHub repo 신규 생성 + Vercel 재배포).

---

## 0. 한 줄 요약

멀티모달 입력 RN(Expo) 앱 + Claude tool-use 백엔드로 만든 **개인 모바일 AI 비서**.
날씨(케이웨더/Open-Meteo)·웹검색·통역·이미지/음성 이해를 제공한다. 백엔드는 **Vercel에 배포 완료**,
앱은 **Expo Go로 실기기 구동 중**.

---

## 1. 구성요소 & 위치

| 항목 | 위치 |
|---|---|
| **백엔드(두뇌) + 웹 테스터** | GitHub: `wellbianlabs/mobile-ai-agent` · 로컬: `D:\Project\Aiagent` |
| **모바일 앱(Expo/RN)** | GitHub: `wellbianlabs/mobile-ai-agent-app` · 로컬: `D:\Project\Multi-Modal Interface` |
| **케이웨더 API 문서** | `C:\Users\rendermachine\Desktop\개발 소스\KW_기상API_OpenAPI_20250929_전체.pdf` |

### 라이브 URL (배포됨 — wellbianlabs Vercel 팀)
- 웹 테스터: **https://mobile-ai-agent-gray.vercel.app/**
- 상태확인: https://mobile-ai-agent-gray.vercel.app/health
- 에이전트 API: `https://mobile-ai-agent-gray.vercel.app/v1/agent/multimodal`
- 날씨 API: `https://mobile-ai-agent-gray.vercel.app/v1/weather?lat=&lon=`
- ⚠️ 공개용은 **`-gray`** 도메인 사용. `-wellbianlabs` 도메인은 Vercel Authentication(SSO) 보호로 외부 차단됨(401).

---

## 2. 계정

| 서비스 | 계정 | 비고 |
|---|---|---|
| GitHub | **`wellbianlabs`** (admin@wellbianlabs.io) | 저장소 소유. push 인증은 wellbianlabs PAT 사용(이 PC 자격증명 관리자에 wellbianlabs 자격증명이 없으면 PAT 필요) |
| Vercel | **team `WELLBIAN`/`wellbianlabs`** (id `team_1CxBKfKNMGIn7MdOC1aRWAg0`), 프로젝트 `mobile-ai-agent` (`prj_5KFZ0GVko58g1bnRwF0gR3CBMuFV`) + `mobile-ai-agent-app` (`prj_a7qoP7Uwjx5naaBKymVCOYcbW5nJ`) | GitHub 연동 → push 시 자동 배포 |
| Anthropic | (Claude API 키 보유) | Vercel 환경변수에 키 보관 |
| 케이웨더 | Air365 OpenAPI | 키는 Vercel 환경변수에 넣는 중(§4) |

> **Claude 계정 변경**: 코드/배포/키는 위 서비스 계정에 묶여 있어 Claude 계정과 무관하게 유지됨.
> 새 Claude 세션은 이 PC에서 로컬 폴더 + GitHub로 그대로 이어가면 된다.

---

## 3. 아키텍처

```
[모바일 앱(Expo/RN, D:\Project\Multi-Modal Interface)]
   온보딩(위치·카메라·사진 동의) → 날씨 히어로(현재위치) → 대화화면
        │  multipart (IMobileAgentUnifiedPayload) + x-access-token
        │  날씨는 GET /v1/weather?lat&lon
        ▼
[Vercel 서버리스 (api/index.ts → src/app.ts, Express)]
   ├─ POST /v1/agent/multimodal → Claude(sonnet-4-6) tool-use 루프
   │     ├─ web_search (Claude 네이티브)
   │     ├─ get_weather (좌표→케이웨더 우선, 폴백 Open-Meteo)
   │     ├─ 통역/번역(모델 자체) · 이미지(멀티모달) · 음성(선택 Groq STT)
   ├─ GET  /v1/weather → 케이웨더/Open-Meteo 현재날씨+요약
   └─ GET  /health
```

- 와이어 계약 정본: 백엔드 `src/types.ts` ↔ 앱 `src/types/payload.ts` (`IMobileAgentUnifiedPayload`). 둘을 함께 유지.

---

## 4. 비밀값 / 환경변수 (값은 커밋 금지)

> 실제 값은 같은 폴더의 **`SECRETS.local.md`** (gitignore됨) 참고. 공개 저장소엔 절대 넣지 말 것.

**Vercel 프로젝트 환경변수** — wellbianlabs `mobile-ai-agent` (Settings → Environment Variables, Production):
| 변수 | 용도 | 상태(2026-06-17 검증, wellbianlabs 프로젝트) |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API | ✅ **설정됨** (`/health` ready:true 확인) |
| `AGENT_ACCESS_TOKEN` | 공개 URL 보호(앱·웹테스터가 같은 토큰 전송) | ✅ 설정됨 (`cf55…348174`, accessProtected:true) |
| `KWEATHER_API_KEY` | 케이웨더 날씨 | ✅ 설정됨 (`/health` kweather:true, `/v1/weather` source:"KWeather" 확인) |
| `AGENT_MODEL` / `ENABLE_WEB_SEARCH` / `GROQ_API_KEY` | 선택 | 기본값 사용 (webSearch:true, serverStt:false) |

> 환경변수 입력 후 **Deployments → 최신 → ⋯ → Redeploy** 해야 반영됨. (Vercel MCP엔 env 설정 기능 없음 → 대시보드 수동.)

**앱 `.env`** (`D:\Project\Multi-Modal Interface\.env`, gitignore됨):
```
EXPO_PUBLIC_AGENT_ENDPOINT=https://mobile-ai-agent-gray.vercel.app/v1/agent/multimodal
EXPO_PUBLIC_AGENT_ACCESS_TOKEN=<백엔드 AGENT_ACCESS_TOKEN 과 동일 = cf55…348174>
```

---

## 5. 실행 / 빌드 / 배포

### 백엔드(로컬 개발)
```powershell
cd D:\Project\Aiagent
npm install
copy .env.example .env   # .env 에 ANTHROPIC_API_KEY 등 채우기
npm run dev              # http://localhost:8787  (smoke: npm run smoke)
```

### 백엔드 배포
`git push origin main` → Vercel 자동 재배포. 환경변수만 바꾼 경우 Vercel에서 **Redeploy** 필요.

### 앱 (Expo Go, 실기기)
```powershell
cd "D:\Project\Multi-Modal Interface"
npm install
npm start                # = expo start --port 8083  → QR 스캔(폰 Expo Go)
# 같은 와이파이 안되면: npm run start:tunnel
```

---

## 6. 환경 특이사항 (이 PC, 꼭 숙지)

- **비관리자 + 가상화 없음** → 안드로이드 **에뮬레이터 부팅 불가**(`emulator -accel-check` = hypervisor 없음). 실기기는 **Expo Go**로.
- **PowerShell 실행정책 차단** → `npm`(npm.ps1) 직접 실행 시 막힘. **해결: `npm.cmd` 사용 또는 cmd 창에서 실행.** (`Set-ExecutionPolicy`는 "Security error"로 거부됨)
- **포트 8081 좀비 프로세스**가 상주 → expo는 **8083**으로 고정해둠(package.json `start`).
- PDF 읽기: `pdftoppm` 없음 → `pdftotext -layout`로 텍스트 추출.
- 빌드 검증은 `npm run typecheck` + `npx expo export --platform android`(번들 OK 확인)로 함(실행은 폰에서).

---

## 7. ✅ 완료 — RN 앱 깃 연동

`D:\Project\Multi-Modal Interface` 는 이제 **git 저장소** (`origin` = `wellbianlabs/mobile-ai-agent-app`, `main`). 초기 커밋 완료.
- `.gitignore`에 추가됨: `/android/`(prebuild 산출물 ~3GB), `/ios/`, `*.apk`/`*.aab`(81MB APK), `SECRETS.local.md`/`*.local.md`. `.env`도 무시됨(토큰 안전).
- ⚠️ `android/`는 무시되므로, 그 안에 **수동 네이티브 수정이 있었다면** config plugin(app.json)으로 옮기거나 선별 커밋해야 함. APK는 `npx expo run:android --variant release` 또는 EAS로 재생성.
- push 인증: wellbianlabs PAT 필요. 1회성으로 `git -c credential.helper= push https://x-access-token:<PAT>@github.com/...` 사용 — **remote URL/config에 토큰 저장 금지**.

---

## 8. 현재 상태 (무엇이 됐나)

- ✅ 백엔드 Claude tool-use 에이전트 (웹검색·날씨·통역·이미지) — Vercel 배포·라이브 검증 완료
- ✅ 케이웨더 연동(한국 좌표 정밀, 해외 Open-Meteo 폴백). `KWEATHER_API_KEY`만 Vercel에 넣고 Redeploy하면 활성(현재는 Open-Meteo 폴백 중)
- ✅ 앱: 권한 온보딩(1회) → 날씨 히어로(시간대·날씨 반응형 하늘 배경, 구름 애니메이션) → 대화화면(라이트 테마)
- ✅ 현재 위치 날씨 즉시 표시 + "날씨" 질의 시 현재 위치 기본값
- ✅ 입력창: 텍스트+갤러리·촬영·음성 아이콘(입력창 내부)+전송, 키보드 회피
- ✅ Expo SDK 52 → **56** 업그레이드 + deprecation 경고 정리(pointerEvents/SafeAreaView/ImageManipulator/getInfoAsync/MediaTypeOptions)

### 기술 스택
- 앱: Expo SDK **56**, React Native **0.85.3**, React **19**, TypeScript 6, Zustand. 주요 모듈: expo-location, expo-linear-gradient, expo-camera, expo-image-picker, expo-image-manipulator, expo-speech-recognition, @react-native-async-storage/async-storage, react-native-safe-area-context.
- 백엔드: Node + Express(서버리스), @anthropic-ai/sdk, 모델 `claude-sonnet-4-6`. (TS, ESM)

---

## 9. 다음 작업 후보 (TODO)

- [x] **wellbianlabs Vercel 환경변수 입력** (`ANTHROPIC_API_KEY`, `AGENT_ACCESS_TOKEN`=cf55…348174) + Redeploy → `/health` `ready:true` 확인 (2026-06-17 완료)
- [x] **케이웨더 키** Vercel에 추가 + Redeploy → `/health` `"kweather":true`, `/v1/weather` `source:"KWeather"` 확인 (2026-06-17 완료)
- [x] RN 앱 GitHub 푸시(§7) — `wellbianlabs/mobile-ai-agent-app` 완료
- [x] 앱 답변 **마크다운/표 렌더링** (2026-06-17). `src/components/Markdown.tsx` — 의존성 없는 자체 렌더러(React 19/RN 0.85 peer-dep 회피). 앱 `44a694c` **푸시 완료**
- [x] **대화 메모리(이전 턴 맥락)** (2026-06-17). 와이어 계약에 `history`(텍스트만) 추가 — 앱은 최근 6턴, 백엔드는 12메시지 상한·user 시작 보장. 백엔드 `b7e0189`/앱 `b58172c` **푸시 완료 → Vercel 배포(dpl_5P2e…) READY**, 라이브에서 멀티턴 기억 검증 완료(history "민수" → "민수")
- [x] **앱 아이콘/스플래시** (2026-06-18). `assets/`(아이콘·어댑티브·스플래시·파비콘) + `scripts/gen_assets.py`(Pillow 생성기) + app.json 연결. 앱 `로컬 커밋, 푸시 대기`
- [x] **정식 릴리스 서명키 + EAS 파이프라인** (2026-06-18). `release.keystore`(alias `multimodal-release`, keytool, **gitignore**·자격증명은 앱 `SECRETS.local.md`) + `eas.json`(development/preview=APK, production=aab)
- [x] **2단계 능동형 — 아침 날씨 브리핑(로컬 알림)** (2026-06-18). `src/services/notifications.ts` + `src/hooks/useMorningBriefing.ts` + WeatherHero 벨 토글(매일 07:30, 앱오픈마다 최신 헤드라인 재예약). ⚠️ **런타임은 개발 빌드 필요**(expo-notifications SDK53+ Expo Go 미지원). typecheck+export 검증 완료, 로컬 커밋·푸시 대기
- [~] **음성 입력** — 코드(`useVoiceSearch.ts`)는 완성·정상. Expo Go 미지원이라 **개발 빌드/APK 빌드만 하면 동작**(아래 §12)
- [ ] (선택) 브리핑 시각 설정 UI, 동적 콘텐츠용 백그라운드 fetch/백엔드 푸시

> ⚠️ **앱 레포 미푸시 커밋 존재**: 아이콘/스플래시·EAS·아침 브리핑 작업이 로컬 커밋만 됨(`git log` 확인). wellbianlabs PAT로 push 필요(§7). 백엔드 레포는 최신까지 push 완료.

### §12. 개발 빌드(음성·알림 활성화) — EAS
이 PC는 Android SDK/에뮬레이터 없음 → **EAS 클라우드 빌드** 권장.
```powershell
cd "D:\Project\Multi-Modal Interface"
npx eas-cli login            # Expo 계정 필요
npx eas-cli build --platform android --profile preview   # 설치형 APK(내부배포)
# 서명: EAS 매니지드(자동) 또는 `npx eas-cli credentials`로 release.keystore 업로드
```
빌드 APK를 폰에 설치하면 **음성 입력 + 아침 브리핑 알림**이 동작한다(Expo Go에선 미동작).

---

## 10. 핵심 파일 지도

**백엔드 (`D:\Project\Aiagent`)**
| 경로 | 역할 |
|---|---|
| `src/app.ts` | Express 앱(라우트·토큰게이트). 로컬/Vercel 공용 |
| `api/index.ts` | Vercel 함수 진입점 |
| `src/agent/runAgent.ts` | Claude tool-use 루프 |
| `src/agent/tools/weather.ts` | get_weather(좌표→케이웨더, 지명→Open-Meteo) |
| `src/weather/*` | kweather / openMeteo / service(통합) / summary(요약) |
| `src/multimodal/*` | multipart 파서 + 선택 STT |
| `public/index.html` | 웹 테스터(마크다운+애니메이션) |
| `vercel.json` | framework:null + rewrites(/health,/v1/*→/api) |

**앱 (`D:\Project\Multi-Modal Interface`)**
| 경로 | 역할 |
|---|---|
| `src/App.tsx` | 온보딩 게이트 → 히어로/대화 라우팅 + SafeAreaProvider |
| `src/components/Onboarding.tsx` | 권한 온보딩(1회) |
| `src/components/WeatherHero.tsx` | 날씨 히어로 홈 |
| `src/components/SkyBackground.tsx` | 시간대·날씨 반응형 하늘(구름/해 애니메이션) |
| `src/components/ComposerBar.tsx` | 입력 바(텍스트+아이콘+전송) |
| `src/components/ConversationView.tsx` | 대화 로그(라이트) |
| `src/hooks/useLocationWeather.ts` | 위치→백엔드 /v1/weather(폴백 Open-Meteo) |
| `src/utils/skyTheme.ts` / `weatherSummary.ts` | 하늘 장면 / 요약 |
| `src/api/agentClient.ts` | 페이로드 전송 + 토큰 + 엔드포인트 |
| `src/store/multimodalStore.ts` | Zustand 상태(입력·대화·위치) |
| `src/types/payload.ts` | 와이어 계약 |

---

## 11. 빠른 검증 명령

```powershell
# 백엔드 라이브 상태
curl https://mobile-ai-agent-gray.vercel.app/health
# 날씨(서울)
curl "https://mobile-ai-agent-gray.vercel.app/v1/weather?lat=37.5665&lon=126.9780" -H "x-access-token: <TOKEN>"
# 앱 타입체크/번들
cd "D:\Project\Multi-Modal Interface"; npm run typecheck
```
(`<TOKEN>` = `SECRETS.local.md` 의 AGENT_ACCESS_TOKEN)
