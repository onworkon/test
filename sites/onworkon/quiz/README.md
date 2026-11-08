# 행사 익명 퀴즈

참가자 `/quiz`, 진행자 `/quiz/admin`, 전용 API `/api/quiz/*`.
실제 onworkon.space 운영 홈페이지 원본을 보존한 통합본이다. GitHub 저장소는 `onworkon/test`, 배포 브랜치는 `deploy/onworkon-space`, Vercel Root Directory는 `sites/onworkon`이다. 기존 저장소 루트의 축제 사이트는 변경하지 않는다.

## 실행과 배포

1. **기존 사이트 DB와 별개인 새 Upstash Redis 데이터베이스**를 만든다. 기존 PostgreSQL이나 기존 Redis를 재사용하지 않는다. 내구성 저장을 사용하고 eviction(자동 키 축출)은 끈다. Redis의 데이터 전체가 퀴즈 전용이어야 한다.
2. `npm ci` 후 `npm run quiz:secrets`를 실행한다. 출력되는 진행자 비밀번호를 안전하게 보관하고, 해시와 세션 비밀키를 환경변수에 넣는다. 출력과 `.env*.local` 파일을 커밋하지 않는다.
3. `quiz/.env.example`의 여섯 값을 로컬 `.env.local`에 추가한다. 기존 환경변수를 바꾸지 않는다. `QUIZ_ORIGIN=http://localhost:3000`으로 설정했다면 브라우저에서도 정확히 `http://localhost:3000`을 사용한다.
4. `sites/onworkon`에서 `npm run quiz:dev`로 실행한 뒤 `/quiz/admin`에서 로그인한다. 이 전용 개발 서버는 퀴즈와 기존 정적 화면만 제공하며 기존 이름 저장 API/DB에 접근하지 않는다. 기존 사이트 자체의 개발 명령은 그대로 유지된다.
5. 반영된 행사 문항을 확인하고 전용 테스트 환경에서 아래 검증을 실행한다.
6. 검토한 변경을 운영 저장소에 반영하고, Vercel 프로젝트에 같은 여섯 환경변수를 설정한다. Production의 `QUIZ_ORIGIN`은 `https://onworkon.space`다. 기존 DB 마이그레이션·시드 명령은 실행하지 않는다. `npm run quiz:build`로 빌드한다. 기존 `npm run build`에는 DB 마이그레이션이 포함되어 있으므로 이번 배포에는 실행하지 않는다.
7. Vercel에 배포한 뒤 참가자 대기, 관리자 로그인·QR, 시작·중복 제출·재접속·종료를 실제 HTTPS 주소에서 점검한다. 사전 연습과 본 행사는 **서로 다른 `QUIZ_EVENT_ID`**를 사용한다. Preview는 별도 테스트 Redis·행사 ID·접속 origin을 사용해야 운영 상태에 영향을 주지 않는다.

서버는 원격 Redis에 저장하며 로컬 파일이나 서버 메모리를 응답 저장소로 사용하지 않는다. 정적 공개 디렉터리는 기존 `dist`를 유지하고, `quiz/public`만 빌드 시 `dist/quiz`에 복사한다. 정답과 서버 코드는 정적 공개 디렉터리 밖에 둔다. 기존 운영 DB의 환경변수·스키마·데이터는 변경하지 않는다.

## 환경변수

| 이름 | 값 / 용도 |
| --- | --- |
| `QUIZ_EVENT_ID` | 행사 식별자. 영문·숫자·`_`·`-`, 1~64자. 예: `student-event-2026` |
| `QUIZ_ORIGIN` | 정확한 접속 origin. 운영 `https://onworkon.space`; 경로·쿼리 없음 |
| `QUIZ_REDIS_REST_URL` | 퀴즈 전용 Redis의 HTTPS REST 주소 |
| `QUIZ_REDIS_REST_TOKEN` | 해당 DB의 쓰기 가능한 REST 토큰, 서버 전용 |
| `QUIZ_ADMIN_PASSWORD_HASH` | 생성 스크립트의 `scrypt$...$...` 값. 평문 비밀번호 아님 |
| `QUIZ_SESSION_SECRET` | 생성 스크립트의 임의 비밀키, 최소 32자 |

행사 ID와 문항은 행사 중 변경하지 않는다. 비밀번호 해시 또는 세션 비밀키를 변경하면 진행자 세션이 무효화된다. 진행자 세션 유효기간은 8시간이다. 로컬의 HTTP localhost를 제외하면 HTTPS만 허용한다. 필수 설정이 없으면 퀴즈 API만 503으로 닫히며 기존 사이트 기능과 인증에는 연결하지 않는다.

## 문항 교체

**`quiz/server/questions.js`**의 `questions`와 `isTest`를 변경한다. 현재는 2026-11-09 사용자가 제공한 **실제 행사 문항 8개**가 반영되어 있다. 학생자치참여예산제, 「다시ON 그날 이야기」, 마음짱 응급구조단, 고교학점제 관련 문항이다. 각 항목의 `id`는 1~8 순서, `prompt`는 문제, `options`는 보기 4개, `correct`는 1부터 세는 정답 번호다.

정답은 `3, 4, 2, 3, 3, 1, 4, 1`이며 `isTest: false`로 설정해 테스트 문항 안내를 숨겼다. 문구는 제공한 내용을 유지하고 줄바꿈·보기 번호는 화면에서 구성한다. Q7의 중복 공백 한 곳만 정리했다. 서버 파일을 `public` 안에 복사하지 않는다. 참가자 API는 현재 문항의 `id`, `prompt`, `options`만 전달하며 채점 결과를 반환하지 않는다.

문항 전체의 해시를 행사 데이터와 함께 보관한다. 같은 행사 ID로 문항·보기·정답·테스트 표시가 바뀌면 409 `CONTENT_CHANGED`로 차단해 서로 다른 배포 버전의 답안이 섞이지 않게 한다. 대기 중 이미 접속자가 있었더라도 문항을 바꿨으면 새 행사 ID로 배포하고 참가자가 새로 접속하게 한다.

## 동작과 집계

- 대기 중 자동 참가 등록 → 진행자가 전체 시작 → 각자 1~8번 제출 → 완료 안내. 인원 제한을 하드코딩하지 않았다.
- 256비트 무작위 참가 토큰을 `quiz:participant:v1:<행사ID>` localStorage에 보관한다. 서버에는 토큰의 SHA-256 해시를 ID로 사용한다. 이름·연락처 등 사용자 정보를 받지 않는다. 같은 브라우저·사이트 저장 공간이 유지되어야 재접속할 수 있다. 브라우저 저장 공간 삭제, 시크릿 창 종료, 다른 기기에서는 기존 참가자를 복구할 수 없다. 여러 기기를 쓰는 동일 인물을 식별하는 기능은 없다.
- 상태, 순서, 중복 여부, 답 저장, 채점, 완료 수 갱신을 **하나의 Redis Lua 스크립트**로 처리한다. 시작·종료도 같은 상태 키에서 직렬화된다. 동일 답 재전송은 멱등 성공하고 카운터를 늘리지 않는다. 다른 답 수정, 순서 건너뛰기, 시작 전·종료 후 제출은 차단한다. 종료 이후 동일 답 재전송도 거부한다.
- 시작 후 신규 토큰의 입장은 거부하고 이미 등록된 토큰은 재접속할 수 있다. 전체 종료는 되돌릴 수 없으며 초기화·재시작 UI는 없다.
- 정답률은 `정답 수 / 제출 답안 수 × 100`, 전체는 분자·분모를 각각 합산한다. 미응답은 제외하고 미완료 참가자의 제출 답안은 포함한다. 한 자리 소수와 `정답 / 제출`을 표시하며 분모 0이면 `—`다.
- 대기 상태는 3초, 참가 중·완료 후는 15초마다 통신한다. 진행자 통계는 2초마다 조회한다. 현재 접속은 **최근 45초 내 통신한 고유 참가 ID**이며 탭을 숨기거나 닫으면 최대 45초 후 빠진다. 접속 수는 정답률 분모와 무관하다. 통신 지연 시 마지막 갱신 상태를 표시한다.
- 진행자 비밀번호는 scrypt 검증, 세션은 서명된 `quiz_admin` HttpOnly/SameSite=Strict 쿠키로 보호한다. 운영 쿠키에는 Secure를 사용한다. 로그인 횟수는 퀴즈 Redis에서 IP 해시별 10회/10분, 전체 100회/10분으로 제한한다. 원본 IP는 퀴즈 저장소에 저장하지 않는다.
- 변경 요청은 origin과 JSON 형식을 확인한다. API와 QR 응답은 `no-store`다. 서버 오류에 요청 본문·토큰·답안을 출력하지 않는다. 기존 분석 스크립트·인증 모듈·DB 모듈을 사용하지 않는다.
- CSV, 내보내기, 순위, 개인 결과, 문항 편집 화면은 없다.

서버·Redis의 처리 여유와 서비스 요금/요청 한도는 선택한 Vercel/Redis 플랜에 달려 있다. 70명 대기 시 참가자 폴링은 대략 초당 23회, 진행 중에는 초당 5회이며, 통계 조회와 답 제출이 더해진다. **실제 배포 용량 검증은 배포 후 해당 환경에서 별도로 해야 한다.**

## 검증 실행

운영과 분리한 테스트 Redis의 정보만 `.env.quiz-test.local`에 작성한다. 테스트는 이 파일과 `QUIZ_TEST_...` 환경변수만 읽으며 운영 `.env.local`을 테스트 자격 증명으로 사용하지 않는다.

```dotenv
QUIZ_TEST_REDIS_REST_URL=https://your-separate-test-database.upstash.io
QUIZ_TEST_REDIS_REST_TOKEN=your-test-token
```

```sh
npm ci
npm run quiz:test
npx playwright install chromium
npm run quiz:e2e
npm run check
npm run test:core
npm run test:http
npm run smoke
```

각 테스트는 무작위 `test-...` 행사 ID를 쓰고 자신이 만든 해당 접두어의 키만 정리한다. `FLUSHDB` 등 전체 데이터 삭제 명령을 쓰지 않는다. 브라우저 테스트는 실제 로컬 서버와 원격 Redis를 사용한다. 화면 캡처는 Git에서 제외되는 `quiz/artifacts/`에 저장한다.

### 실행 결과 — 2026-11-09 (한국 시간)

실제 행사 문항 8개 반영 후 문항 수·보기 수·정답 번호와 문법을 확인했고, `npm run quiz:e2e`를 재실행해 8문항 풀이, 재접속, 저장 실패 재시도, 진행자 집계가 통과함을 확인했다. 갱신된 모바일 화면에서 테스트 안내가 숨겨지고 긴 문구가 정상 줄바꿈되는 것도 확인했다. 실제 운영 홈페이지에 통합한 버전에서 70명 동시 부하와 전체 퀴즈 통합 검증도 다시 통과했다.

| 검사 | 결과 |
| --- | --- |
| Redis + 실제 HTTP 통합 9개 | 통과 |
| 70명 동시 참여, 1,120건 중복 답안 요청 | 정답 560 / 제출 560, 완료 70명; 중복 집계 없음 |
| 고정 인원 제한 여부 | 75명 동시 등록 성공; 같은 ID 반복 등록은 1명 |
| 가중 정답률 | 미완료 참가자 포함 3/5 = 60.0%, 4/6 = 66.7%; 미응답 `—` |
| 순서·변경·시작/종료 경쟁·재접속 | 통과; 처리기를 새로 만들어도 데이터 유지 |
| 접근 제어 | 미인증 통계/QR/제어 거부, 위조·만료 세션 및 다른 origin 거부, 로그인 제한 통과 |
| Chromium 브라우저 | 대기→8문항→완료, 새로고침/재접속, 신규 입장 거부, 저장 실패/저장 후 응답 유실 재시도 통과 |
| 화면 확인 | 모바일 세로, 320px 너비, 1440px 중앙 고정 520px, QR, 진행자 실시간 집계 확인; JS/CSP 오류 없음 |
| 기존 홈페이지 검사 | 기존 테스트 15개 통과; 운영 정적 파일 24개가 통합 소스와 바이트 단위로 일치 |
| `npm test` / `npm run quiz:build` | 실제 운영 홈페이지 통합본에서 모두 통과; 운영 DB 마이그레이션 미실행 |
| 운영 DB | 접근·변경·삭제 없음. 기존 API는 원본 유지 |

통합본 동시 테스트 답안 요청 p95 약 1.90초(로컬 Node + 원격 임시 Redis). 실제 Vercel 운영 지연이나 최대 수용 인원을 보증하는 수치는 아니다. 임시 Redis는 72시간 만료 서비스이며 테스트 키는 실행 후 정리했다. 행사 운영용으로 사용하면 안 된다.

실제 운영 홈페이지 통합본의 의존성 설치 검사에서는 취약점 0건이 보고되었다. 기존 홈페이지 의존성 버전은 유지했다.

## 변경 경계와 행사 후 제거

퀴즈 전용 코드는 `quiz/`와 `api/quiz.js`다. 빌드 산출물은 `dist/quiz/`다. 루트의 ESM 설정과 퀴즈 CommonJS 모듈을 `quiz/package.json`으로 분리했다.

- `vercel.json`: 기존 `dist` 출력과 `api/names.js` 설정을 유지하고 퀴즈 경로·헤더·함수만 추가했다. 빌드 명령은 DB에 접근하지 않는 `quiz:build`로 지정한다.
- `package.json` / lock: `qrcode`, 개발 검증용 `@playwright/test`, `quiz:*` 명령을 추가했다.
- 기존 `dist`의 화면·자산, `src`, `server`, `api/names.js`, DB 마이그레이션 파일은 원본 그대로다.

행사 후 `quiz/`, `api/quiz.js`, `dist/quiz/`와 퀴즈 rewrite/headers/function 설정, `quiz:*` 명령, `QUIZ_*` 환경변수 및 퀴즈 전용 Redis를 제거한다. `qrcode`와 `@playwright/test`가 다른 곳에서 사용되지 않으면 의존성에서도 제거한다. 빌드 명령을 복구할 때는 기존 명령이 DB 마이그레이션을 실행한다는 점을 검토한다. 기존 이름 저장 DB는 제거하거나 수정하지 않는다. 브라우저의 `quiz:participant:v1:*` 키와 `quiz_admin` 쿠키도 퀴즈에만 해당한다.

참고한 공식 문서: [Vercel Node.js 함수](https://vercel.com/docs/functions/runtimes/node-js), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi), [Redis Lua 원자 처리](https://redis.io/docs/latest/develop/programmability/eval-intro/).
