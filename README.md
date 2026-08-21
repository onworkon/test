# JSFes NFC Stamp

Festival booth stamp management site for Vercel, PostgreSQL, Web NFC, and TOTP fallback.

## Setup

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env.local` and fill the values.
3. Install the locked dependencies with `npm ci`.
4. Run `npm run db:migrate`.
5. Run `npm run db:seed` to create the bracelet number range.
6. Run `npm run booths:sync` to load the editable `../booth.txt` booth data.
7. Create the admin account and register actual NFC tags. Manager accounts are synchronized from `booth.txt`.
8. Run locally with `npm run dev`.

`npm run dev` uses the built-in local server in `scripts/local-dev.js`. Use `npm run vercel:dev` when you specifically want to test with the Vercel CLI.

`DATABASE_URL` and the required secrets must be configured for database-backed API routes. Without them, the local server still serves static pages, but API calls that require the database return configuration errors.

Use secrets of at least 32 characters for `JWT_SECRET` and `MASTER_SECRET`. TLS certificate verification is enabled by default; set `PGSSL_REJECT_UNAUTHORIZED=false` only when a trusted database provider explicitly requires a self-signed certificate.

Run the complete local quality gate before deployment:

```sh
npm test
```

This checks JavaScript syntax, JSON/HTML/CSS structure, migration naming, core security logic, HTTP helpers, security headers, traversal handling, and local route smoke tests.

## 운영 정보 및 비밀번호 변경

현재 운영값은 그대로 유지한다. 변경이 필요할 때 아래 기준에 따라 수정하고, 마지막에 `npm run ops:check`로 반영 상태를 확인한다.

### 부스 정보와 담당자 비밀번호

지속적으로 사용할 기준 파일은 프로젝트 상위 경로의 `../booth.txt`다. 부스별 블록을 다음 순서로 작성하고 블록 사이는 빈 줄로 구분한다.

```text
1
부스명
부스 설명
부스 위치
1234
stamp: 01.webp
tag: 04:12:34:56
```

- 첫 줄: 1~99 사이의 고유 부스 번호
- 둘째 줄: 부스명
- 중간 줄: 설명이며 여러 줄도 가능
- 비밀번호 바로 앞 줄: 위치
- `stamp:` 바로 앞 줄: 정확히 4자리 숫자로 된 담당자 비밀번호. 다른 부스와 같은 비밀번호도 사용할 수 있음
- 필수: 부스 번호와 일치하는 `stamp: 01.webp` 형식의 스탬프 파일명
- 선택: 실제 NFC 태그를 스캔한 뒤 `stamp:` 다음 줄에 `tag: 04:12:34:56` 형식으로 UID 입력

`booth.txt`에는 평문 비밀번호가 있으므로 Git에서 제외되어 있으며 커밋하면 안 된다. 수정 후 먼저 드라이런으로 검증하고, 문제가 없을 때 실제 DB에 반영한다.

```sh
npm run booths:sync -- --dry-run
npm run booths:sync
npm run ops:check
```

`tag:` 줄을 생략한 부스는 DB의 기존 NFC 매핑을 그대로 보존한다. `tag:`를 적은 부스는 기존 매핑을 해당 UID 하나로 신규 등록하거나 교체한다. 파일 안에 동일한 UID가 중복되거나, `tag:`를 생략한 다른 부스가 이미 사용 중인 UID를 지정하면 전체 동기화를 취소한다. UID의 `:`, `-`, 공백은 제거한 뒤 비교하며 8~64자리 16진수만 허용한다. 동기화 결과에는 처리 건수만 나오고 UID 원문은 출력하지 않는다.

동기화는 `booth.txt`를 기준 데이터로 사용한다. 첫 줄의 부스 번호로 `booth-01`~`booth-99` 형식의 `booth_id`를 결정하고, 기존 ID가 다르면 담당자 계정·NFC·스탬프·코드 사용 기록까지 같은 트랜잭션에서 새 ID로 이관한다. 부스명, 설명, 위치, 정렬 순서, 담당자 비밀번호와 스탬프 이미지 경로도 파일 값으로 갱신한다. 파일이 표현하지 않는 운영 상태와 `tag:`를 생략한 기존 NFC 매핑은 보존하며, 파일에서 빠진 부스를 자동 삭제하지 않는다. 비밀번호 원문은 명령 출력이나 DB에 저장하지 않고 bcrypt 해시만 저장한다.

담당자는 `/manager`에서 부스 번호 2자리와 비밀번호 4자리를 붙인 6자리 코드(예: 7번 부스, 비밀번호 `4821`이면 `074821`)로 로그인한다. 로그인 후 4자리 비밀번호를 즉시 변경할 수 있다. 화면에서 바꾼 값은 DB에 바로 적용되지만 `booth.txt`에는 기록되지 않으므로, 다음 `booths:sync` 실행 시 파일의 4자리 값으로 되돌아간다. 영구 변경은 반드시 `booth.txt`를 수정하는 방식으로 처리한다.

### 관리자 비밀번호

관리자 로그인 후 `/admin`의 **비밀번호 변경** 메뉴에서 변경하는 것이 기본 방법이다. 로그인할 수 없을 때만 로컬에서 다음 명령으로 재설정한다.

```sh
npm run staff:upsert -- --role admin --password "새-관리자-비밀번호"
```

변경되면 기존 관리자 로그인 토큰은 폐기된다. 비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 한다. 해시만 별도로 만들 필요가 있을 때는 `npm run hash-password -- "비밀번호"`를 사용할 수 있지만 DB를 직접 수정하는 방식은 권장하지 않는다.

### 상품 지급 페이지 비밀번호

`/prize`는 공개 화면에서 링크되지 않으며 현재 기본 비밀번호는 `0000`이다. 로컬에서는 `.env.local`, 배포 환경에서는 Vercel 환경 변수의 `PRIZE_PASSWORD`를 변경한 뒤 로컬 서버를 재시작하거나 다시 배포한다.

```dotenv
PRIZE_PASSWORD=새-비밀번호
```

상품 지급 토큰에는 현재 `PRIZE_PASSWORD`에서 파생한 자격 증명 버전이 포함된다. 비밀번호를 변경하고 다시 배포하면 기존 상품 지급 토큰은 즉시 거부되며, 사용자·담당자·관리자 세션에는 영향을 주지 않는다.

상품 지급 담당자는 화면에 표시된 번호와 실물 팔찌 번호가 일치할 때만 지급 완료를 처리한다.

### JWT 및 마스터 비밀키

`JWT_SECRET`과 `MASTER_SECRET`은 `.env.local` 또는 배포 환경 변수에서만 변경하며 각각 32자 이상의 임의 문자열을 사용한다.

- `JWT_SECRET` 변경: 기존 사용자·담당자·관리자·상품 지급 토큰이 모두 무효화된다.
- `MASTER_SECRET` 변경: 모든 부스 회전 코드가 바뀐다.

운영 도중에는 장애 대응 목적이 아니라면 두 값을 변경하지 않는다.

### NFC 태그 변경

기준 매핑은 가능하면 `booth.txt`의 선택형 `tag:` 줄로 관리한다. 관리자는 긴급 변경이 필요할 때 `/admin`의 **태그 관리** 메뉴에서 태그를 등록·재매핑·삭제할 수 있다. 명령줄에서 변경하려면 실제 태그 UID와 부스 ID를 지정한다.

```sh
npm run tag:upsert -- --tag-uid 04:12:34:56 --booth-id booth-01
```

태그 UID의 `:`, `-`, 공백은 정규화되므로 `04:12:34:56`, `04-12-34-56`, `04123456`은 같은 값으로 처리된다.

`tag_maps`는 태그 UID와 부스 ID 양쪽을 모두 고유값으로 강제한다. 따라서 한 태그는 한 부스에만, 한 부스도 한 태그에만 연결된다. 관리자 화면이나 `tag:upsert`로 부스의 새 태그를 저장하면 그 부스의 기존 태그 매핑은 같은 트랜잭션에서 교체된다.

담당자 로그인에서는 6자리 코드의 앞 2자리로 고유한 부스 계정을 찾고, 뒤 4자리를 bcrypt 해시와 대조한 뒤 해당 부스 관리 화면을 연다. 로그인 시도 제한은 존재하지 않는 부스 번호를 포함해 전체 부스 로그인, 요청 IP 전체, IP·부스 조합 범위에 각각 적용한다.

### 스탬프판과 상품 조건

스탬프판은 `3×3`, 총 9칸으로 고정한다. 사용자는 서로 다른 부스 9곳에서 한 번씩만 적립할 수 있으며, 서버가 새 스탬프를 무작위 빈 칸에 배정해 DB의 `board_slot`에 저장한다. 따라서 새로고침하거나 다른 기기에서 로그인해도 스탬프 위치가 바뀌지 않는다.

전자 스탬프는 9칸을 모두 채운 경우 상품 수령 조건을 충족한다. 전자기기 사용이 어려워 종이 리플렛에 스탬프를 모은 학생은 상품 지급 담당자가 `/prize`에서 **오프라인 적립(리플렛) 확인**을 선택하면 전자 스탬프 개수와 관계없이 지급할 수 있다. 서버는 체크 여부를 정확한 불리언 값으로 검증하고 지급 방식을 `digital_stamps` 또는 `offline_leaflet`으로 기록한다.

보드가 완성되면 추가 전자 적립을 받지 않으며, 상품 지급 완료 후에도 일반 적립 API가 모든 요청을 차단한다. 전자 스탬프 기준은 임시 환경 변수로 변경하지 않고 기획에 따라 9로 고정한다. 관리자가 지급 상태를 복구하면 지급 방식 기록도 함께 초기화된다.

스탬프 이미지는 `public/assets/stamps/01.webp`부터 `20.webp`까지의 경로를 사용한다. 이미지가 없으면 화면에는 글자 마크가 대신 표시되지만 `npm run ops:check`는 누락 파일을 운영 실패로 보고한다. 이후 동일한 파일명으로 이미지를 추가하면 코드나 DB를 다시 변경할 필요가 없다. 일정 이미지는 `public/assets/images/schedule.png`가 없을 때 경고로 보고하며 화면에는 현재의 준비 중 안내가 표시된다.

For code stamping, each booth has a fixed two-digit `code_number` and a rotating four-digit TOTP. Managers see the combined value in `07-4821` format, and users enter it as the single six-digit value `074821`. The server uses the first two digits to select exactly one booth before validating the TOTP, so no booth list or all-booth code scan is required.

Manual code reissue increments the booth's server-side `code_generation` in a transaction. The previous generation is rejected immediately, while ordinary GET requests only read the current code and never rotate it.

Add the official schedule at `public/assets/images/schedule.png` before deployment. Until it exists, the schedule page shows a preparation message instead of a broken image.

Check the database counts:

```sh
npm run db:check
```

Run the full operational readiness check before the event:

```sh
npm run ops:check
```

Export operational data directly from the database:

```sh
npm run export:csv -- users exports/users.csv
npm run export:csv -- stamps exports/stamps.csv
npm run export:csv -- booths exports/booths.csv
npm run export:csv -- tags exports/tags.csv
npm run export:csv -- logs exports/logs.csv
```

## Main Routes

- User: `/start`, `/map`, `/stamp`, `/schedule` (`/reward`는 `/stamp`로 이동)
- Manager: `/manager`
- Admin: `/admin`
- Prize operator: `/prize` (direct URL only; not linked from the public pages)

## Monitoring

Set `SENTRY_DSN` to send unexpected server errors to Sentry. Admin and manager operations are also stored in the `operation_logs` table and shown on the admin page.

Rate limits are stored in the `rate_limits` table so limits stay consistent across serverless instances.

실시간 사용자는 최근 5분 안에 사용자 페이지에서 클릭, 키 입력, 스크롤 또는 인증 API 요청이 한 번 이상 기록된 팔찌 사용자다. 사용자 활동 시 `last_active`를 갱신하고, 공개 실시간 현황과 관리자 화면은 30초마다 이 값을 다시 집계한다. 아직 활동하지 않은 사전 생성 사용자의 `last_active`는 `NULL`로 유지한다.

Schema changes should be added to `db/migrations/` and applied with `npm run db:migrate`. `npm run db:schema` remains available for quick local initialization only.

Applied migrations are recorded with SHA-256 checksums. Never edit an already-applied migration; add a new numbered migration instead.
