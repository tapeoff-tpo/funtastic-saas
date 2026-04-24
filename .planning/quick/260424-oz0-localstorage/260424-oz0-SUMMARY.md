---
quick_id: 260424-oz0
description: 사이드바 접기/펼치기 기능 추가 (<< 버튼 + localStorage 상태 저장)
date: 2026-04-24
commit: 5b59f1d
status: implementation-complete
human_verify_pending: true
---

# Quick Task 260424-oz0 — Summary

## What Shipped

사이드바에 접기/펼치기 토글을 추가하여 메인 컨텐츠 전체 화면 확보가 가능해졌다.

### 변경 파일
| 파일 | 변경 내용 |
|---|---|
| `src/components/layout/app-shell.tsx` | Server → Client component 전환. `useState` + `useEffect`로 collapse 상태 관리, localStorage 영속화, 접힌 상태일 때 좌상단 고정 `>>` 펼치기 버튼 렌더 |
| `src/components/layout/sidebar.tsx` | `ChevronsLeft` 아이콘 추가. `SidebarProps.onCollapse?` optional prop 수신. 로고 영역 우측에 `<<` 접기 버튼 렌더 |

### 동작
- **펼친 상태**: 사이드바 상단 우측에 `<<` 버튼 → 클릭 시 접힘
- **접힌 상태**: 사이드바 DOM에서 제거, 메인 영역 좌상단에 `>>` 버튼 (fixed, z-50) → 클릭 시 펼침
- **영속화**: `localStorage['funtastic-sidebar-collapsed']` = `'true'` / `'false'`
- **SSR 안전**: 초기 `useState(false)`로 서버/클라이언트 첫 렌더 일치, mount 후 `useEffect`에서 localStorage 값 반영
- **장애 내성**: localStorage 접근은 try/catch — 프라이빗 모드 등에서도 기본값(펼침)으로 동작

## Verification Status

| Check | Result |
|---|---|
| TypeScript compile (target files) | ✅ no errors |
| Git commit | ✅ `5b59f1d` |
| 브라우저 수동 검증 (Task 3) | ⏳ 사용자 검증 대기 |

## Human-Verify Checkpoint (pending)

사용자는 아래를 수동으로 확인 필요:
1. `npm run dev` → 로그인 후 `/dashboard` 접속
2. 사이드바 상단 `<<` 클릭 → 사이드바 숨김, 좌상단 `>>` 노출, 메인이 전체 너비
3. `>>` 클릭 → 사이드바 복귀
4. 접힌 상태에서 F5 새로고침 → 상태 유지
5. 브라우저 콘솔에 Hydration 경고 없음
6. 기존 내비게이션/로그아웃 정상 동작

## Follow-ups

없음 — 독립적이고 완결된 기능.
