# Scopit Claims 운영 가이드 (한국어 요약)

영어 문서(`DEPLOY.md`, `ADMIN.md`, `LAUNCH_CHECKLIST.md`)를 한 장으로 줄인 요약입니다. 세부 절차는 괄호 안의 영어 문서 항목을 보세요.

## 어디에 무엇이 있나

| 무엇 | 어디 | 비고 |
| --- | --- | --- |
| 사이트 코드와 글 | GitHub 저장소의 `claims/` 폴더 | Scopit 앱(`frontend/`, `backend/`)과 별개 |
| 배포 | Cloudflare Pages 프로젝트 `scopit-claims` | `main`에 머지하면 자동 배포 |
| DB (PA, 면허, 문의) | Cloudflare D1 `scopit-claims` (미리보기용은 `scopit-claims-preview`) | Scopit 앱의 Neon DB와 완전히 별개 |
| 이메일 발송 | Resend, Scopit 앱과 같은 계정 (`claims@scopit.work`) | 무료 한도(하루 100통, 월 3,000통)를 앱과 나눠 씀 |
| PA 뉴스레터 | Buttondown | 무료: 구독자 100명 |
| 관리자 화면 | `https://claims.scopit.work/admin` | 브라우저만 있으면 됨 |
| 검색 노출 | Google Search Console | 방문자 통계 도구는 쓰지 않음 |
| 도메인 DNS | **Namecheap** (Cloudflare 아님) | `claims` CNAME 하나와 메일 전달(`claims@`)만 Namecheap에서 추가 |
| 명령줄 도구 | `npx wrangler` (`claims/` 안에서) | 처음 설정할 때와 DB 구조가 바뀔 때만 사용 |

## 1단계: 지금 할 일 (결정과 검토)

- [ ] PR #11 검토 후 `main`에 머지. 머지만으로는 아무것도 공개되지 않습니다.
- [ ] 남은 결정 7가지 답하기 (`PLAN.md` "Open questions"):
  1. 연락처 이메일 (`hello@scopit.work` 그대로? 별도 `claims@`?)
  2. 노트 제목의 "Xactimate" 유지 여부
  3. 홈 체크리스트, About, Contact 문구 검토
  4. 문의 보관 기간 180일
  5. 한 번에 문의할 수 있는 PA 최대 3명
  6. 승인 시 PA에게 "등록 완료" 메일 보내기
  7. 거절 시 자동 메일 없음 (직접 연락)

## 2단계: 서비스 설정 (계정이 필요해서 직접 하셔야 함)

순서대로 하세요. 중간에 Pages 빌드가 실패하는 건 정상이고, 필요한 값을 다 넣으면 통과합니다.

### 2-1. DB 만들기 (터미널) — DEPLOY.md 1

```bash
cd claims
npm install
npx wrangler login                          # 브라우저가 열리면 Cloudflare 로그인
npx wrangler d1 create scopit-claims
npx wrangler d1 create scopit-claims-preview
```

- [ ] 출력된 `database_id` 두 개를 `wrangler.toml`에 넣기 (Claude에게 알려 주면 넣어 드림. 비밀값 아님)
- [ ] 그다음 테이블 만들기:

```bash
npm run db:migrate:remote     # 운영 DB
npm run db:migrate:preview    # 미리보기 DB
```

### 2-2. Turnstile (스팸 방지) — DEPLOY.md 4

- [ ] Cloudflare 대시보드 > Turnstile > Add widget
  - 호스트 이름: `claims.scopit.work`, `scopit-claims.pages.dev`
  - 모드: Managed
- [ ] **사이트 키**를 `wrangler.toml`의 `PUBLIC_TURNSTILE_SITE_KEY`에 넣기 (공개 값이라 Claude에게 알려 주셔도 됨)
- [ ] **비밀 키**는 2-4에서 대시보드에만 입력

### 2-3. Pages 프로젝트 만들기 — DEPLOY.md 2

- [ ] Workers & Pages > Create > Pages > Connect to Git > 이 저장소
- [ ] 설정:
  - Project name `scopit-claims`
  - Production branch `main`
  - Root directory `claims`
  - Build command `npm run build`
  - Build output `dist`
- [ ] Settings > Builds > Build watch paths에 `claims/*` (Scopit 앱만 바뀐 커밋에서는 빌드하지 않도록)

### 2-4. 비밀값 넣기 — DEPLOY.md 3

Pages > Settings > Variables and Secrets > Add > **Encrypt** 선택. Production과 Preview 둘 다 넣습니다.

| 이름 | 어디서 구하나 |
| --- | --- |
| `CF_D1_API_TOKEN` | My Profile > API Tokens > Create Token > Custom, 권한은 **Account > D1 > Read**만 |
| `CF_ACCOUNT_ID` | 대시보드 오른쪽의 Account ID |
| `TURNSTILE_SECRET_KEY` | 2-2의 비밀 키 |
| `RESEND_API_KEY` | 2-6에서 새로 만든 claims 전용 키 |
| `EMAIL_FROM` | `Scopit Claims <claims@scopit.work>` |
| `ADMIN_NOTIFY_EMAIL` | 새 PA 신청 알림을 받을 주소 |
| `BUTTONDOWN_API_KEY` | 2-7에서 발급 |
| `ADMIN_USER` | 관리자 아이디 (예: `admin`) |
| `ADMIN_PASSWORD` | 터미널에서 `openssl rand -base64 24`로 생성 |
| `IP_HASH_SALT` | 터미널에서 `openssl rand -hex 32`로 생성 |
| `PAGES_DEPLOY_HOOK_URL` | 2-5에서 생성 |

**비밀값은 채팅이나 코드에 절대 붙여 넣지 마세요.** 대시보드에만 넣습니다.

### 2-5. 배포 훅 (자동 재빌드) — DEPLOY.md 5

- [ ] Pages > Settings > Builds > Deploy hooks > Add (이름 `admin-and-nightly`, 브랜치 `main`)
- [ ] 나온 URL을 두 곳에 넣기:
  - Pages 비밀값 `PAGES_DEPLOY_HOOK_URL`
  - GitHub 저장소 > Settings > Secrets and variables > Actions > `CLAIMS_PAGES_DEPLOY_HOOK_URL` (매일 밤 재빌드용)

### 2-6. Resend (이메일) — DEPLOY.md 8

기존 Scopit 계정을 그대로 쓰고, `scopit.work`가 이미 인증돼 있어 DNS 작업은 필요 없습니다.

- [ ] API Keys > Create: 이름 `scopit-claims`, 권한 Sending access, 도메인 `scopit.work`. 앱과 키를 나눠 두면 사이트 키만 따로 끊을 수 있음
- [ ] `claims@scopit.work` 답장 받기: Namecheap > Domain List > `scopit.work` > Manage > Email Forwarding > Add Forwarder (별칭 `claims`, 받을 메일함 지정). 지금 `scopit.work` 메일은 Namecheap 메일 전달로 받고 있음
- [ ] DMARC는 이미 있음 (할 일 없음)
- [ ] Resend > Domains > `scopit.work`에서 모든 레코드가 Verified인지 확인. 공개 DNS에 `send` MX 레코드가 안 보여서, 빠져 있다고 나오면 Namecheap Advanced DNS에 추가
- [ ] 참고: 무료 한도(하루 100통)는 Scopit 앱과 나눠 씀. 문의 1건에 최대 4통. 모자라면 Pro(월 약 $20)

### 2-7. Buttondown (뉴스레터) — DEPLOY.md 9

- [ ] 가입, 뉴스레터 만들기, Settings > API에서 키 발급
- [ ] 이중 확인(double opt-in)은 따로 설정할 필요 없음 (API로 들어온 구독자는 자동으로 확인 메일을 받음)

### 2-8. 관리자 화면 보호 — DEPLOY.md 11

- [ ] `ADMIN_PASSWORD`를 길고 무작위로 만들고, 면허 확인하는 사람에게만 공유
- 참고: Cloudflare Access(회사 이메일 로그인 추가)는 보통 DNS가 Cloudflare에 있어야 해서 지금은 생략. 비밀번호 보호는 이미 되어 있음

### 2-9. 첫 배포와 시험 — DEPLOY.md 12

- [ ] Pages > Deployments > Retry deployment (또는 `main`에 새로 머지)
- [ ] 빌드 로그에서 두 줄 확인:
  - `using wrangler.toml env "production"`
  - `Loaded N verified listing row(s) from D1`
- [ ] **`scopit-claims.pages.dev` 주소로만** 시험:
  - 테스트 PA 신청 → `/admin`에서 면허 확인과 승인 → 테스트 문의
  - 메일이 제대로 오는지 확인
  - 끝나면 테스트 데이터 삭제 (DEPLOY.md 12의 명령)

## 3단계: 출시 전 콘텐츠와 법률

- [ ] 가이드 4개와 노트 4개 최종 원고 → Claude에게 붙여 주면 넣고 "published"로 바꿔 드림
- [ ] 실제 현장 사진: 홈 1장, 가이드·노트마다 1장, 각 사진 설명(alt) 한 줄. 사람이 나오는 스톡 사진은 쓰지 않음
- [ ] 변호사 검토:
  - 법률 문서 4개 (Privacy, Terms, Disclaimer, PA Listing Terms)
  - 주별 규칙 표 13행
  - 문의 동의 문구
  - 검토가 끝난 문장을 Claude에게 주면 반영
- [ ] `npm run launch-check`로 남은 항목 확인 (BLOCKERS가 0이 될 때까지)

## 4단계: 출시

- [ ] **먼저** Cloudflare Pages > Custom domains > `claims.scopit.work` 추가 (순서가 바뀌면 522 오류)
- [ ] **그다음** Namecheap > Advanced DNS > CNAME 추가: Host `claims`, Value `scopit-claims.pages.dev` (Cloudflare가 보여 주는 값 그대로)
- [ ] Pages에서 도메인이 Active가 되고 인증서가 발급될 때까지 대기 (수 분에서 몇 시간)
- [ ] Search Console에 사이트 등록, `https://claims.scopit.work/sitemap.xml` 제출
- [ ] `LAUNCH_CHECKLIST.md`의 마지막 확인 항목 점검

## 평소 운영

| 상황 | 할 일 |
| --- | --- |
| PA 신청 알림 메일이 옴 | `/admin`에서 신청 열기 > 주 면허 조회 링크로 확인 > 날짜와 메모 넣고 "Mark license verified" > "Approve and publish". 1~3분 뒤 사이트에 반영 (ADMIN.md) |
| PA가 면허를 갱신했다고 연락 | `/admin`에서 만료일 수정 → 확인이 초기화되므로 다시 조회하고 확인 |
| PA를 내려야 함 | `/admin` > "Remove from directory" |
| 글이나 코드 수정 | PR을 `main`에 머지하면 자동 배포 |
| DB 구조 변경 (드묾) | `npm run db:migrate:remote` 그리고 `npm run db:migrate:preview` |

## 문제가 생기면

| 증상 | 확인할 곳 |
| --- | --- |
| 빌드 실패: "needs CF_ACCOUNT_ID, CF_D1_DATABASE_ID, and CF_D1_API_TOKEN" | 2-4의 빌드 비밀값 두 개, `wrangler.toml`의 DB ID |
| 빌드 실패: "Turnstile test site key in a production build" | `wrangler.toml`의 `PUBLIC_TURNSTILE_SITE_KEY` |
| 폼 제출 시 "temporarily unavailable" | 런타임 비밀값 누락. Pages > Functions 로그 확인 |
| 메일이 안 감 | Resend 대시보드 > Logs, 하루 100통 한도 |
| 승인했는데 목록에 안 보임 | 면허 확인 날짜와 만료일, Pages > Deployments에서 재빌드 여부 |
| `/admin`이 404 | `ADMIN_USER`, `ADMIN_PASSWORD` 비밀값 |
