# Requirements: Funtastic SaaS

**Defined:** 2026-04-03
**Core Value:** 마켓플레이스 주문을 수집하고 송장을 업로드하는 것이 막힘없이 동작해야 한다 — 이것이 되면 사방넷을 끊을 수 있다.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation (기반)

- [x] **FOUND-01**: 시스템 관리자가 이메일/비밀번호로 로그인할 수 있다
- [x] **FOUND-02**: 로그인 세션이 브라우저 새로고침 후에도 유지된다
- [x] **FOUND-03**: 관리자가 마켓플레이스별 API 인증정보(키/시크릿)를 등록하고 관리할 수 있다
- [x] **FOUND-04**: 등록된 API 인증정보가 암호화되어 안전하게 저장된다
- [x] **FOUND-05**: 마켓플레이스 연동 상태(정상/오류/만료)를 대시보드에서 확인할 수 있다

### Order Management (주문관리)

- [x] **ORD-01**: 연동된 마켓플레이스에서 주문을 자동으로 수집할 수 있다 (스케줄 기반)
- [x] **ORD-02**: 모든 마켓플레이스의 주문을 하나의 통합 대시보드에서 조회할 수 있다
- [x] **ORD-03**: 주문을 마켓플레이스, 날짜, 상태, 상품명, 주문번호, 구매자명으로 필터링/검색할 수 있다
- [x] **ORD-04**: 주문 상태를 관리할 수 있다 (신규→확인→출고대기→출고완료→배송중→배송완료)
- [x] **ORD-05**: 마켓플레이스에서 취소/반품/교환 클레임을 자동 수집할 수 있다
- [x] **ORD-06**: 문제 주문을 보류 처리하고 사유를 기록할 수 있다
- [x] **ORD-07**: 보류된 주문을 해제하고 정상 처리 흐름으로 복귀시킬 수 있다

### Shipping & Invoice (배송/송장)

- [x] **SHIP-01**: 송장번호를 마켓플레이스 API로 자동 업로드할 수 있다
- [x] **SHIP-02**: 엑셀 파일로 송장번호를 일괄 업로드할 수 있다
- [x] **SHIP-03**: 송장 출력(배송 라벨)을 일괄 인쇄할 수 있다
- [x] **SHIP-04**: 같은 구매자/주소의 주문을 합포장으로 묶을 수 있다 (출고편집코드 기반 자동분리 + 최대합포장수량 설정 포함)
- [x] **SHIP-05**: 합포장 대상 주문을 자동으로 감지하고 제안할 수 있다 (냉동/상온, 대형/소형 등 출고편집코드 기반 분리 포함)
- [x] **SHIP-06**: 하나의 주문을 여러 배송으로 분할할 수 있다
- [x] **SHIP-07**: 처리된 주문을 택배사 양식에 맞는 엑셀로 내보낼 수 있다
- [x] **SHIP-08**: 엑셀 내보내기 양식을 택배사별로 커스터마이징할 수 있다

### Product Management (상품관리)

- [ ] **PROD-01**: 상품을 등록하고 여러 마켓플레이스에 일괄 등록할 수 있다
- [ ] **PROD-02**: 내부 카테고리를 마켓플레이스별 카테고리에 매핑할 수 있다
- [ ] **PROD-03**: 등록된 상품의 기본정보(가격, 제목, 설명)를 수정하고 마켓에 반영할 수 있다
- [ ] **PROD-04**: 연동된 마켓플레이스에서 기존 등록 상품을 가져와 내부 상품 DB에 매핑할 수 있다 (역수집)
- [ ] **PROD-05**: 상품 옵션/변형(사이즈, 컬러 등)을 관리하고 옵션별 재고를 추적할 수 있다

### Inventory (재고관리 — 기본)

- [ ] **INV-01**: 중앙 재고 수량을 관리할 수 있다 (상품별 총 재고)
- [ ] **INV-02**: 주문 발생 시 재고가 자동으로 차감된다
- [ ] **INV-03**: 반품/취소 시 재고가 자동으로 복구된다
- [ ] **INV-04**: 수동으로 재고를 조정하고 사유(입고, 불량, 실사 등)를 기록할 수 있다

### Excel & Data (엑셀/데이터)

- [x] **DATA-01**: 주문 목록을 커스터마이징 가능한 엑셀로 내보낼 수 있다
- [ ] **DATA-02**: 상품을 엑셀로 일괄 등록/수정할 수 있다

### Marketplace Adapters (마켓플레이스 어댑터)

- [x] **MKT-01**: 쿠팡 API 연동 (주문수집, 송장업로드, 상품등록)
- [x] **MKT-02**: 네이버 스마트스토어 API 연동 (주문수집, 송장업로드, 상품등록)
- [ ] **MKT-03**: 11번가 API 연동 (주문수집, 송장업로드, 상품등록)
- [ ] **MKT-04**: 지마켓/옥션(ESM) API 연동 (주문수집, 송장업로드, 상품등록)
- [ ] **MKT-05**: 오늘의집 API 연동 (주문수집, 송장업로드)
- [x] **MKT-06**: 추가 마켓플레이스 어댑터를 모듈식으로 확장할 수 있는 구조

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Inventory

- **INV-V2-01**: 마켓플레이스별 재고 자동 동기화
- **INV-V2-02**: 자동품절/재판매 (재고 0이면 마켓 품절처리)
- **INV-V2-03**: 안전재고 설정 및 알림

### Advanced Product Management

- **PROD-V2-01**: 마켓별 옵션 자동 매칭 (플레이오토 수준의 옵션 체계 매핑)
- **PROD-V2-02**: 마켓별 상세 필드 커스터마이징

### Differentiators

- **DIFF-01**: 사은품 자동지급 (조건별 룰 엔진)
- **DIFF-02**: 세트상품 분리 (SKU 분해)
- **DIFF-03**: 바코드 검수 (포장 시 스캔 검증)
- **DIFF-04**: 실시간 주문 대시보드 (WebSocket/SSE)
- **DIFF-05**: 자동화 스케줄러 (수집/동기화 자동 실행)

### Platform

- **PLAT-01**: 멀티테넌트 SaaS (셀러별 계정 분리)
- **PLAT-02**: 유료 구독 모델 (결제/과금)
- **PLAT-03**: 펀타스틱B2B 연동
- **PLAT-04**: 상세페이지 자동생성 (AI 기반, 셀러별 차별화)

### Additional Marketplaces

- **MKT-V2**: CJ온스타일, 현대홈쇼핑, 스페셜오퍼, 스마일배송, 올웨이즈, Cafe24, GS샵, NS홈쇼핑, 도매꾹, 도매매, 오너클랜, 온채널, 도매의신, 도매창고, 카카오톡스토어, 텐바이텐, 토스쇼핑, 투비즈온, 카카오선물하기, 에이블리, 신세계몰, 바나나B2B

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WMS (창고관리시스템) | 별도 제품 도메인, 핵심 OMS 개발 지연 |
| CS/채팅 시스템 | 별도 CS 도구 사용, 각 마켓 자체 CS 인터페이스 존재 |
| 회계/정산 시스템 | 규제 복잡, 별도 회계 소프트웨어 연동은 추후 |
| 모바일 앱 | 웹 우선, 500건+ 주문은 데스크톱 작업, v2+ |
| 상세페이지 자동생성 | v2+ 차별화 기능 |
| 입점대행 | 서비스 비즈니스, 소프트웨어 기능 아님 |
| 위탁판매/발주 자동화 | 자체배송 우선 설계, 드롭십 워크플로우는 별도 |
| 실시간 전체 동기화 | API rate limit으로 불가, 준실시간(5-15분) 대체 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| ORD-01 | Phase 2 | Complete |
| ORD-02 | Phase 2 | Complete |
| ORD-03 | Phase 2 | Complete |
| ORD-04 | Phase 2 | Complete |
| ORD-05 | Phase 2 | Complete |
| ORD-06 | Phase 2 | Complete |
| ORD-07 | Phase 2 | Complete |
| SHIP-01 | Phase 3 | Complete |
| SHIP-02 | Phase 3 | Complete |
| SHIP-03 | Phase 3 | Complete |
| SHIP-04 | Phase 3 | Complete |
| SHIP-05 | Phase 3 | Complete |
| SHIP-06 | Phase 3 | Complete |
| SHIP-07 | Phase 3 | Complete |
| SHIP-08 | Phase 3 | Complete |
| PROD-01 | Phase 5 | Pending |
| PROD-02 | Phase 5 | Pending |
| PROD-03 | Phase 5 | Pending |
| PROD-04 | Phase 5 | Pending |
| PROD-05 | Phase 5 | Pending |
| INV-01 | Phase 4 | Pending |
| INV-02 | Phase 4 | Pending |
| INV-03 | Phase 4 | Pending |
| INV-04 | Phase 4 | Pending |
| DATA-01 | Phase 3 | Complete |
| DATA-02 | Phase 5 | Pending |
| MKT-01 | Phase 2 | Complete |
| MKT-02 | Phase 2 | Complete |
| MKT-03 | Phase 6 | Pending |
| MKT-04 | Phase 6 | Pending |
| MKT-05 | Phase 6 | Pending |
| MKT-06 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 after gap analysis (added PROD-04 역수집, PROD-05 옵션관리, SHIP-04/05 합포장 고도화)*
