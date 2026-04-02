# Funtastic SaaS — 이커머스 통합관리 플랫폼

## What This Is

사방넷/플레이오토를 대체하는 자체 이커머스 통합관리 SaaS 플랫폼. 약 30개 온라인 마켓플레이스의 주문수집, 배송처리, 송장업로드, 상품등록, 재고관리를 하나의 시스템에서 처리한다. 자체 배송을 중심으로 하루 500~2000건의 주문을 처리하는 셀러를 위한 시스템이다.

## Core Value

마켓플레이스 주문을 수집하고 송장을 업로드하는 것이 막힘없이 동작해야 한다 — 이것이 되면 사방넷을 끊을 수 있다.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 마켓플레이스 API 연동으로 주문 자동수집 (쿠팡, 네이버 등 30개 마켓)
- [ ] 수집된 주문 통합 조회/관리 대시보드
- [ ] 송장번호 API 자동 업로드 (마켓별)
- [ ] 엑셀 일괄 송장 업로드
- [ ] 자체배송 워크플로우 (주문수집 → 출고 → 송장등록)
- [ ] 상품등록/관리 (마켓별 일괄등록)
- [ ] 재고 관리 및 마켓별 동기화
- [ ] 인증/사용자 관리
- [ ] 펀타스틱B2B 연동 (개발 중인 자사 B2B와 통합)
- [ ] 셀러 서비스 (외부 셀러에게 유료 제공)

### Out of Scope

- 모바일 앱 — 웹 우선, 모바일은 추후 검토
- 실시간 채팅/CS 시스템 — 별도 CS 도구 사용
- 회계/정산 시스템 — 별도 회계 소프트웨어 연동은 추후
- 상세페이지 자동생성 — v2 이후 기능 (셀러별 차별화된 상세페이지)

## Context

- 현재 사방넷을 실제 사용 중이며, 비용 부담이 대체의 주된 동기
- 자체배송 위주의 운영 — 도매처 발주보다는 직접 재고 보유 후 출고
- 하루 주문 처리량 500~2000건 수준의 중대형 셀러
- 펀타스틱B2B라는 자사 B2B 플랫폼을 별도로 개발 중 (API 미확정)
- 송장처리는 API 자동 + 엑셀 수동 업로드 두 가지 모두 필요
- 연동 대상 마켓플레이스: 쿠팡, 네이버, 오늘의집, 도매꾹(도매매), 오너클랜, 온채널, CJ온스타일, 현대홈쇼핑, 스페셜오퍼, 스마일배송, 옥션, 지마켓, 11번가, 바나나B2B, 올웨이즈, Cafe24, GS샵, NS홈쇼핑, 도매의신, 도매창고, 카카오톡스토어, 텐바이텐, 토스쇼핑, 투비즈온, 카카오선물하기, 에이블리, 신세계몰, 펀타스틱B2B

## Constraints

- **Tech stack**: Next.js 16 + Supabase + TypeScript + Tailwind CSS v4 — 이미 초기 프로젝트 세팅 완료
- **Priority**: 주문수집 + 송장처리가 최우선 — 사방넷 대체가 1차 목표
- **Self-use first**: 자체 사용이 우선, 셀러 서비스는 안정화 이후
- **API dependency**: 각 마켓플레이스 API 문서/인증이 필요 (일부 마켓은 파트너 등록 필요)
- **Scale**: 하루 500~2000건 주문 처리 가능한 성능 필요

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js 16 + Supabase 선택 | 빠른 개발 속도 + 인증/DB 통합 솔루션 | — Pending |
| 자체배송 우선 설계 | 실제 운영 방식이 자체배송 위주 | — Pending |
| 마켓 API 모듈식 설계 | 30개 마켓을 점진적으로 추가할 수 있도록 | — Pending |
| v1은 자체사용, 셀러 서비스는 v2 | 안정성 확보 후 외부 제공 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-03 after initialization*
