# Phase 9: 관리자 계정 관리 - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning
**Source:** Direct decisions (interactive Q&A with user, no formal discuss-phase)

<domain>
## Phase Boundary

이 phase가 끝나면:
- 오너(super_admin)가 관리자 페이지에서 직원 여러 명을 관리자(admin) 계정으로 직접 생성/조회/수정/비활성화 할 수 있다
- 직원은 이메일+초기 비밀번호로 로그인하고, 본인 설정 페이지에서 비밀번호를 변경할 수 있다
- 모든 관리자 계정 변경(생성/역할 변경/비활성화/비밀번호 리셋)은 audit log에 기록된다

이 phase는 **계정 모델 + 관리 UI**까지만 다룸. 기능별 권한 게이팅(예: "admin은 송장 업로드만, super_admin만 마켓 자격증명 수정")은 별도 후속 phase.

</domain>

<decisions>
## Implementation Decisions

### Auth Provider
- **Supabase Auth 사용** — 이미 스택에 들어있고 `service_role` 키 보유. 자체 사용자 테이블/세션 관리 안 함.
- 클라이언트 SDK는 익명 키, 관리자 작업은 서버 액션에서만 service_role 키 사용.

### Identity / Login
- **로그인 ID = 실제 이메일** (가짜 이메일 변환 안 함). Supabase 표준 그대로.
- 비밀번호 재설정 메일/매직 링크는 사용 안 함 (이메일 발송 인프라 0개 유지).

### Role Model
- 두 단계 역할만 시작:
  - `super_admin` — 오너. 다른 관리자 계정 CRUD 가능. 시스템 모든 기능 사용.
  - `admin` — 일반 직원. 다른 관리자 관리 불가. 시스템 모든 기능 사용 (게이팅은 추후 phase).
- 역할은 `user_profiles.role` enum 컬럼으로 저장.
- Phase 9 종료 시점에 super_admin은 최소 1명 (현재 오너 본인). 부트스트랩은 SQL seed 또는 수동 1회.

### Account Creation Flow
- **오너가 폼에서 직접 생성**: 이메일 + 역할 입력 (비밀번호 입력 X).
- 시스템이 환경변수 `INITIAL_USER_PASSWORD`(.env.local)에서 초기 비밀번호 가져와 자동 적용.
  - 운영 기본값: `eksrnr2125@` (이 값은 코드에 하드코딩하지 않고 env로 관리)
- Supabase Admin API: `auth.admin.createUser({ email, password, email_confirm: true })`
  - `email_confirm: true` → 인증 메일 발송 스킵
- 이메일/비밀번호는 오너가 직원에게 직접 (구두/메신저 등) 전달.

### First Login & Password Change
- **첫 로그인 강제 비밀번호 변경 없음** — 그냥 로그인 통과.
- **본인 설정 페이지**에서 self-service 비밀번호 변경 가능 (Supabase `auth.updateUser({ password })`).
- **오너 강제 리셋**: 관리자 목록에서 "비밀번호 초기화" 버튼 → `INITIAL_USER_PASSWORD` 값으로 리셋 → 오너가 직원에게 알림.

### Schema
- `user_profiles` 테이블 (Drizzle):
  - `id uuid` (FK → `auth.users.id`, primary key)
  - `email text` (unique, mirror of auth.users.email — 조회 편의)
  - `role text` (enum: `super_admin` | `admin`, default `admin`)
  - `display_name text` (선택, 직원 표시명)
  - `created_at timestamptz` (default now)
  - `created_by uuid` (FK → user_profiles.id, 누가 만들었는지)
  - `deactivated_at timestamptz` (nullable, soft delete)
  - `deactivated_by uuid` (FK → user_profiles.id)
- RLS: 본인 행은 SELECT/UPDATE 가능, super_admin은 전체 SELECT/INSERT/UPDATE 가능.
- `audit_logs` 테이블:
  - `id uuid pk default gen_random_uuid()`
  - `actor_id uuid` (FK → user_profiles.id)
  - `action text` (`account.create` | `account.role_change` | `account.deactivate` | `account.reactivate` | `account.password_reset` | `password.self_change`)
  - `target_id uuid` (대상 계정, FK → user_profiles.id)
  - `metadata jsonb` (변경 전/후 값 등)
  - `created_at timestamptz default now`

### Deletion Policy
- **Soft delete 만 사용** (`deactivated_at` 셋팅).
- Hard delete (auth.users 삭제 + user_profiles 삭제)는 Phase 9에서 미지원.
- 비활성화된 계정은 로그인 차단 (Supabase `auth.admin.updateUserById(id, { ban_duration: 'permanent' })` 또는 미들웨어에서 `deactivated_at IS NOT NULL` 체크).

### UI Surface
- 기존 `src/app/(auth)/admin/accounts/page.tsx` 자리의 "준비 중입니다." placeholder 대체.
- 화면 구성:
  - 관리자 목록 테이블 (TanStack Table, 기존 패턴 따름) — 컬럼: 이메일 / 역할 / 생성일 / 생성자 / 상태(활성/비활성) / 액션
  - "새 관리자 추가" 버튼 → 다이얼로그 (이메일, 역할 입력)
  - 행별 액션: 역할 변경, 비밀번호 초기화, 비활성화/재활성화
  - super_admin만 모든 액션 가능; admin은 페이지 접근 자체 차단
- 본인 설정 페이지 (`/settings`) 또는 별도 라우트 — 비밀번호 변경 폼.

### Validation & Permissions
- 서버 액션에서 호출자 역할 확인 (Supabase 세션의 user → user_profiles.role 조회) 후 super_admin만 통과.
- 비활성화 시 본인 비활성화 시도는 거부 (자기 발 자르기 방지).
- super_admin이 본인 역할을 admin으로 강등 시도 시: 마지막 super_admin이면 거부.

### Out of Scope (Phase 9에서 제외)
- 기능별 권한 게이팅 (admin은 X 못함 같은 세분화)
- MFA / 2FA
- 비밀번호 강도 정책 (특수문자 포함 등) — Supabase 기본 정책만 사용
- 이메일 인증 메일 / 비밀번호 재설정 링크
- 외부 SSO (Google/카카오 등)
- 활동 세션 관리 (강제 로그아웃 등)
- 사용자 프로필 사진/상세정보 (display_name 외)

### Claude's Discretion
- 다이얼로그 UI 라이브러리 선택 (`@base-ui/react` 또는 shadcn/ui Dialog — 기존 프로젝트 패턴 따라)
- 폼 검증 라이브러리 (Zod 스키마는 사용, 폼 라이브러리는 기존 패턴 확인 후 결정)
- 비활성화 메커니즘 구체 구현 (Supabase ban vs 미들웨어 체크 — 기존 미들웨어 구조 보고 결정)
- audit_logs 페이지 노출 여부 — Phase 9에서는 테이블만 만들고 UI 노출은 후속

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `CLAUDE.md` — Tech stack, conventions, scale targets
- `AGENTS.md` — Next.js 16 breaking changes warning, must read `node_modules/next/dist/docs/` before writing Next.js code
- `.planning/REQUIREMENTS.md` — Existing requirement IDs (FOUND-*, ORD-*, MKT-*, etc.); Phase 9 may need new IDs (e.g., ADMIN-01..ADMIN-04)

### Phase 1 (Auth/Foundation) — direct dependency
- `.planning/phases/01-foundation-marketplace-infrastructure/` — 기존 auth 패턴, 미들웨어, Supabase 클라이언트 셋업
- `src/lib/supabase/` — 기존 Supabase 클라이언트 모듈 (server/browser/middleware 분리 확인)
- `src/app/(public)/login/` — 기존 로그인 페이지 (이메일 폼)
- `src/app/(auth)/layout.tsx` — 인증 게이트 미들웨어/레이아웃

### Existing Admin Surface
- `src/app/(auth)/admin/accounts/page.tsx` — 현재 placeholder, 이 phase에서 대체
- `src/app/(auth)/admin/dev-log/` — 기존 admin 페이지 패턴 (구조 참고)

### Database Schema
- `src/lib/db/` 또는 `src/lib/drizzle/` — 기존 Drizzle 스키마 위치 확인 필요
- `supabase/migrations/` — Supabase 마이그레이션 패턴 (RLS 정책 포함)

### UI Patterns
- `src/components/` — shadcn/ui 컴포넌트, 기존 다이얼로그/폼/테이블 패턴
- `src/app/(auth)/orders/` — TanStack Table + 액션 버튼 패턴 (테이블 UI 참고용)

</canonical_refs>

<specifics>
## Specific Ideas

- 폼 입력은 최소화: 이메일 + 역할(드롭다운) 두 개만. 직원 표시명은 옵션.
- 초기 비밀번호 환경변수는 `INITIAL_USER_PASSWORD` (없으면 빌드 실패하도록 server-side에서 검증).
- audit_logs는 작성만 하고 조회 UI는 추후 phase로 넘김 (DB에 기록되니 필요 시 Supabase Studio에서 확인 가능).
- super_admin 부트스트랩: 첫 super_admin은 `supabase/migrations/` 내 SQL seed 또는 README에 수동 등록 절차 명시.
- 본인 비밀번호 변경 페이지는 admin 영역(`/settings` 또는 `/profile`) 안에 둠 — 별도 인증 흐름 만들지 않음.

</specifics>

<deferred>
## Deferred Ideas

- audit_logs 조회 UI / 필터 / CSV 내보내기
- 기능별 권한 게이팅 (RBAC 세분화) — Phase 10 후보
- MFA / TOTP / 패스키
- 비밀번호 강도 / 만료 정책
- SSO (Google/Naver/카카오)
- 강제 로그아웃 / 세션 관리
- 직원 프로필 상세 (사진, 부서, 연락처)
- 가입 승인 워크플로 (오너 직접 생성 방식이라 불필요)

</deferred>

---

*Phase: 09-admin-account-management*
*Context gathered: 2026-04-29 via direct decisions (no formal discuss-phase)*
