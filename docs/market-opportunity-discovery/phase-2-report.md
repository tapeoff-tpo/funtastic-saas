# Phase 2 - Market Opportunity Discovery

- 조사일: 2026-07-17
- 역할: Senior Product Scout
- 범위: 시장에 이미 판매되는 비전기 생활용품 중 FDM 개선 기회 발굴
- 원본 스캔: `market-scan.csv`
- 점수표: `opportunity-filter.csv`

## 1. Executive Summary

100개 실제 판매 후보를 빠르게 스캔하고, 수요·VOC·구조 단순성·FDM 적합성·차별화·커스터마이징을 각각 10점으로 평가했다. 상위 20개만 개별 상품·커뮤니티 근거로 심화 검토했다.

전체 100개 1차 판정은 `GO 5 / GO WITH LIMITATIONS 10 / HOLD 38 / REJECT 47`이다. 심화 조사 대상 Top 20만 보면 `GO 5 / GO WITH LIMITATIONS 10 / HOLD 5`다.

최종 Top 5는 다음과 같다.

1. IKEA SKADIS 호환 고정형 후크
2. 샤워 유리 두께 맞춤 면도기 홀더
3. 가전제품 전선 굵기 맞춤 코드 랩
4. 면도기 규격 맞춤 미니멀 홀더
5. 손잡이 지름 맞춤 중력식 빗자루 홀더

Top 1은 `SKADIS 호환 후크`다. 이유는 시장이 이미 크고, 원제품 리뷰에서 후크가 헐거워 물건을 뺄 때 함께 들리는 문제가 직접 확인되며, 3D 프린팅 사용자도 페인트 두께와 출력 편차에 따른 맞춤 공차를 반복해서 논의하기 때문이다. 구조가 작고 서포트 없이 출력 가능한 범주이며, 보드·하중·잠금 강도별 변형이 고객 문제와 직접 연결된다. 다만 시장이 붐비므로 단순 후크 복제는 가치가 없다.

## 2. Evidence Quality

### 확인된 것

- Etsy 카테고리에는 가전 코드 정리, 빗자루 홀더, 면도기 홀더, SKADIS 액세서리, 리모컨 홀더에서 수백~수천 건의 표시 리뷰가 반복된다.
- 개별 Etsy 상품에서 중력식 빗자루 홀더는 PETG, 21~28 mm 손잡이 범위, 금속 손잡이 미끄럼 문제를 명시한다.
- 개별 Etsy 페그보드 상품은 PLA를 사용하며, 1/4인치 페그보드가 표준화되지 않아 두께 옵션을 운영한다고 명시한다.
- IKEA 공식 SKADIS 후크 리뷰에는 길이는 좋지만 후크가 헐거워 물건을 뺄 때 아래쪽이 들린다는 불만이 있다.
- Reddit에서는 페인트된 SKADIS 보드의 핀 공차와 출력 부품의 삽입 불량이 실제 질문으로 반복된다.
- Etsy 면도기 홀더 시장 리뷰에는 샤워 유리 두께가 맞지 않았다는 실패가 있고, 욕실 보관은 녹·위생·접착 유지 문제와 연결된다.
- Caraway 장기 사용 후기에는 뚜껑 정리용 접착 후크가 약 10개월 후 미끄러지기 시작했다는 사례가 있다.

### 제한

- Etsy 카테고리의 괄호 숫자는 상품 변형·판매자 집계가 섞일 수 있어 `표시 리뷰 수`로만 사용했다.
- 개별 상품 페이지에서 평점이 확인되지 않은 경우 `unknown`으로 유지했다.
- Amazon, 쿠팡, 네이버쇼핑, AliExpress는 검색·robots 제한 때문에 동일한 깊이로 수집되지 않았다. Target, Temu, eBay, 쿠팡과 국내 독립몰의 직접 상품은 일부 보강했지만 플랫폼별 점유율은 계산하지 않았다.
- Stage 1 플랫폼 구성은 Etsy 94건, Target 2건, Temu·eBay·쿠팡·국내 독립몰 각 1건이다. Etsy 편중이 크므로 이 결과를 국내 시장 순위로 해석하지 않는다.
- 출력시간과 필라멘트량은 형상과 슬라이서 결과가 없으므로 숫자를 만들지 않았다.
- 예상 판매가는 새로운 숫자를 만든 것이 아니라 현재 확인된 유사 FDM 상품 가격 범위를 사용했다.

## 3. Score Interpretation

- 시장 수요: 표시 리뷰 수와 서로 다른 판매자의 반복 등장
- 반복 VOC: 직접 리뷰·상품 제한조건·커뮤니티에서 동일 문제가 반복되는 정도
- 구조 단순성: 부품 수, 전자·금속·실리콘 의존성, 하중 위험
- FDM 적합성: 소형 크기, 적층 방향, 서포트·조립 가능성
- 차별화 가능성: 고객 불만을 형상·공차·설치 방식으로 줄일 수 있는지
- 커스터마이징 가치: 크기·색상·각인·호환 규격이 실제 구매 이유와 연결되는지

점수는 판매량 예측이 아니라 조사 우선순위다. `opportunity-filter.csv`의 `evidence_depth=stage1-only` 행은 Stage 1 필드에 동일 규칙을 적용한 1차 점수이고, `deep-researched` 20개는 개별 근거를 반영해 재평가한 점수다.

## 4. Top 20 Deep Research

### 1. SKADIS Curved Hook / Retained Hook

**Product Summary**

- 플랫폼: Etsy, IKEA, Reddit
- 관찰 가격: 8개 $3.99, 단일 직선형 $1.99
- 표시 리뷰: 950 / 423; 개별 평점은 unknown
- 시장성: IKEA 생태계와 수천 개의 3D 프린팅 액세서리가 존재하는 검증된 틈새시장

**Customer**

- 구매 이유: 기존 보드에 도구를 빠르게 추가하고 작업공간을 맞춤 구성
- 반복 VOC: 후크가 헐겁고 물건을 뺄 때 함께 들림; 페인트 두께와 출력 편차 때문에 핀 공차가 맞지 않음

**Manufacturing**

- 재질·방식: 기존 FDM 판매품은 PLA 중심
- FDM 적합성: 매우 높음; 작고 단일부품이며 보드 공차를 파라미터로 관리할 수 있는 범주
- 생산성: 구체 출력시간은 STL 전까지 unknown; 소형 반복 배치 가능

**Opportunity**

- 개선 가능성: 보드 두께별 체결 공차, 탈락 방지, 하중별 규격, 도구별 폭
- 관찰 판매 범위: 약 $1.99~$7.49
- 리스크: 시장 과밀, IKEA 상표 표현, 원본 모델 라이선스, 너무 싼 대체 STL

**Verdict: GO**

문제와 FDM 장점이 직접 연결된다. 단순 후크 복제가 아니라 `헐거움과 호환 공차`를 검증해야 한다.

### 2. Shower Glass Razor Holder

**Product Summary**

- 플랫폼: Etsy
- 관찰 가격: $7.99~$10.81
- 표시 리뷰: 199~910; 개별 평점 unknown
- 시장성: 면도기 홀더 시장에서 수백~수천 표시 리뷰가 반복

**Customer**

- 구매 이유: 면도기를 바닥·선반에서 띄워 건조하고 공간 절약
- 반복 VOC: 샤워 유리 두께 불일치, 면도기 손잡이 형상 불일치, 습기로 인한 녹·위생 문제

**Manufacturing**

- 재질·방식: 3D 프린팅 플라스틱 판매 사례 다수
- FDM 적합성: 매우 높음; 무타공 걸이 구조이며 제품 규격별 변형 가치가 큼
- 생산성: 서포트 여부와 시간은 형상 전 unknown

**Opportunity**

- 개선 가능성: 유리 두께·면도기 폭별 호환, 배수·세척성, 긁힘 방지 접촉부 검증
- 관찰 판매 범위: 약 $4.25~$14.95
- 리스크: 욕실 열·습기, 유리 손상, PLA 장기 사용, 작은 규격 오차가 반품으로 직결

**Verdict: GO**

실패 원인이 명확하고 치수 커스터마이징이 직접적인 구매 가치다.

### 3. KitchenAid Curved/Straight Cord Organizer

**Product Summary**

- 플랫폼: Etsy, eBay
- 관찰 가격: $4.25~$7.79
- 표시 리뷰: 915~1,100
- 시장성: 유사 제품이 여러 판매자에게서 수천 표시 리뷰로 반복

**Customer**

- 구매 이유: 사용하지 않는 가전 전선을 본체에 붙여 정리
- 반복 VOC: 코드 굵기·플러그 크기 호환, 접착 지속성, 3D 프린트 표면의 저가감

**Manufacturing**

- 재질·방식: FDM 판매 사례 확인
- FDM 적합성: 매우 높음; 단일 소형부품과 접착패드 조합
- 생산성: 다수 동시 출력 가능 범주이나 실제 시간은 unknown

**Opportunity**

- 개선 가능성: 굵기별 클립, 플러그 고정, 기기 곡률·표면별 접착 검증, CMF
- 관찰 판매 범위: $4.00~$9.99
- 리스크: 매우 싼 사출 10개입 제품, 접착 클레임, 상표·기기명 사용

**Verdict: GO**

수요와 FDM 판매 전례는 강하다. 경쟁이 심하므로 호환성과 접착 시험이 차별화의 최소 조건이다.

### 4. Minimalist Razor Holder

**Product Summary**

- 플랫폼: Etsy
- 관찰 가격: $5.00~$14.99
- 표시 리뷰: 960~8,600
- 시장성: 다수 판매자와 높은 표시 리뷰

**Customer**

- 구매 이유: 면도기를 카운터에서 치우고 적은 공간에 보관
- 반복 VOC: 특정 손잡이에 맞지 않음, 습식 보관 시 건조·녹 문제, 접착식은 탈락 위험

**Manufacturing**

- 재질·방식: FDM 판매 사례 다수
- FDM 적합성: 매우 높음; 단순 단일부품
- 생산성: 높을 가능성이 있으나 슬라이싱 전 시간·중량 unknown

**Opportunity**

- 개선 가능성: 손잡이 규격별 포획, 카운터형·벽부착형 검증, 배수와 청소 접근
- 관찰 판매 범위: $5.00~$16.50
- 리스크: 저가 경쟁, 면도기 모델 수, 욕실 소재 클레임

**Verdict: GO**

호환성 문제가 명확하고 소형 파라메트릭 생산 가치가 높다.

### 5. Gravity Broom Holder PETG

**Product Summary**

- 플랫폼: Etsy, Amazon 기반 사용자 기사
- 관찰 가격: 단일 $6.99~$10.49, 3구 $21.25
- 개별 상품: 5.0/5, 6 reviews; 카테고리 표시 3,400, Amazon 유사품 약 2,000 reviews/4.7
- 시장성: 청소도구 정리 수요와 다수 판매 제품 확인

**Customer**

- 구매 이유: 넘어지는 빗자루·대걸레를 벽에 한 손으로 보관
- 반복 VOC: 금속 손잡이는 미끄러짐, 21~28 mm만 호환, 삽입 동작 학습 필요, 접착식은 경화 전 하중 시 탈락

**Manufacturing**

- 재질·방식: PETG FDM, 회전 기어와 본체 조립
- FDM 적합성: 높음; 기존 FDM 판매가 검증됨
- 생산성: 다부품과 조립이 필요하며 시간은 unknown

**Opportunity**

- 개선 가능성: 손잡이 지름·표면별 마찰, 교체 가능한 접촉부, 설치 방식별 버전 검증
- 관찰 판매 범위: $6.99~$21.25
- 리스크: 원본 설계 라이선스, 움직이는 부품 마모, 고하중·접착 안전

**Verdict: GO**

명시된 호환 한계와 미끄럼 문제가 FDM 맞춤 생산과 직접 연결된다.

### 6. Individual Cabinet Pot Lid Holders

**Product Summary**

- 플랫폼: Etsy
- 관찰 가격: 단일 $7.00, 10개입 $14.95
- 표시 리뷰: 363~8,500
- 시장성: 강함

**Customer**

- 구매 이유: 캐비닛 안쪽 빈 면에 뚜껑을 분리 보관
- 반복 VOC: 뚜껑 손잡이와 지름 호환, 문 닫힘 간섭, 접착 장기 유지

**Manufacturing**

- 재질·방식: 플라스틱 사출·FDM 혼재
- FDM 적합성: 높음; 한 쌍의 소형 부품으로 구현되는 범주

**Opportunity**

- 개선 가능성: 손잡이·테두리별 규격, 문 여유공간 확인, 교체 접착재
- 관찰 판매 범위: $6.00~$14.95
- 리스크: 저가 다수팩, 주방 열·유증기, 접착 실패

**Verdict: GO WITH LIMITATIONS**

수요는 강하지만 가격 압력이 높고 설치 공간 데이터가 먼저 필요하다.

### 7. 3D Printed Remote Control Holder

**Product Summary**

- 플랫폼: Etsy
- 관찰 가격: $8.10~$21.08
- 표시 리뷰: 955~1,100
- 시장성: 충분함

**Customer**

- 구매 이유: 여러 리모컨 분실과 테이블 어수선함 감소
- 반복 VOC: 리모컨 폭·길이와 슬롯 수, 기존 얇은 플라스틱 파손, 원하는 색·칸 수

**Manufacturing**

- 재질·방식: FDM
- FDM 적합성: 매우 높음; 단일 용기형 구조

**Opportunity**

- 개선 가능성: 실제 리모컨 치수 조합별 슬롯, 무게중심, 표면·색상, 각인
- 관찰 판매 범위: $5.99~$49.57
- 리스크: 단순 박스와 차별화 부족, 장시간 출력 대비 낮은 가격

**Verdict: GO WITH LIMITATIONS**

커스터마이징 가치는 강하지만 범용 제품은 쉽게 복제된다.

### 8. Universal Appliance Cord Wrap

**Product Summary**

- 플랫폼: Etsy, Walmart, eBay
- 관찰 가격: $4.00~$9.99
- 표시 리뷰: 662~8,600
- 시장성: 매우 강함

**Customer**

- 구매 이유: 여러 가전의 늘어진 전선 정리
- 반복 VOC: 굵은 코드와 플러그가 맞지 않음, 접착재 신뢰성, 작은 제품의 손 조작성

**Manufacturing**

- 재질·방식: 사출과 FDM 혼재
- FDM 적합성: 매우 높음

**Opportunity**

- 개선 가능성: 코드 크기 계열화, 기기 곡률, 교체식 접착, 시각적 품질
- 관찰 판매 범위: $4.00~$16.99
- 리스크: 강한 가격 경쟁과 특허·상표 조사 필요

**Verdict: GO WITH LIMITATIONS**

시장성은 높지만 단순 복제로는 수익 방어가 어렵다.

### 9. Pegboard Tech Accessory Set

**Product Summary**

- 플랫폼: Etsy
- 개별 평점: 5.0/5, 32 reviews
- 재질: PLA
- 시장성: 567 favorites, 판매자가 보드 두께 옵션을 운영

**Customer**

- 구매 이유: 키보드·태블릿·마우스·헤드폰을 한 시스템에 맞춤 배치
- 반복 VOC: 1/4인치 보드 비표준 두께, 장치 폭·두께 호환, 페그 공차

**Manufacturing**

- 방식: FDM, 다수 SKU
- FDM 적합성: 높음

**Opportunity**

- 개선 가능성: 보드 표준·장치 규격 조합별 선택, 세트 일관성
- 관찰 가격: 액세서리별 $7.49부터
- 리스크: SKU 폭증, 상표 호환 표현, 장치별 모델 변경

**Verdict: GO WITH LIMITATIONS**

제품군 확장성은 높지만 처음부터 많은 SKU를 만들면 운영 복잡도가 급증한다.

### 10. CalDigit TS4 Under-Desk Mount

**Product Summary**

- 플랫폼: Etsy
- 관찰 가격: $15.19~$18.99
- 표시 리뷰: 2,300
- 시장성: 강한 기기 전용 액세서리 수요

**Customer**

- 구매 이유: 고가 도킹스테이션을 책상 아래 숨기고 공간 확보
- 반복 VOC: 기기 치수·포트 방향·환기·탈착 편의

**Manufacturing**

- 방식: FDM
- FDM 적합성: 높음; 브래킷형 소형 구조

**Opportunity**

- 개선 가능성: 기기 리비전·설치 방향별 호환과 케이블 여유
- 관찰 판매 범위: $15.19~$18.99
- 리스크: 특정 기기 수명주기, 고가 기기 낙하 책임

**Verdict: GO WITH LIMITATIONS**

수요는 강하지만 구조 시험과 기기 버전 관리가 필수다.

### 11. Mitsubishi AC Remote Wall Mount

- **시장:** Etsy $17.35, 73 표시 리뷰.
- **고객:** 리모컨 분실 방지와 벽면 정위치 보관. 모델별 외형, 버튼 간섭, 접착·나사 선택이 핵심 VOC다.
- **제조:** 단일 FDM 홀더에 적합. 출력시간은 unknown.
- **기회:** 모델명 기반 맞춤과 색상·각인. 특정 리모컨 교체 주기가 리스크다.
- **Verdict: GO WITH LIMITATIONS.** 수요는 중간이지만 맞춤 지불가치가 명확하다.

### 12. SKADIS Headphone Holder

- **시장:** Etsy $7.19~$8.99, 1,900 표시 리뷰.
- **고객:** 책상 면적을 비우고 헤드셋을 보드에 보관. 헤드밴드 폭, 푹신한 패드 눌림, 페그 헐거움이 핵심이다.
- **제조:** FDM 적합성 높음. 긴 캔틸레버의 레이어 방향 검증 필요.
- **기회:** 헤드셋 폭·하중별 규격. 지나친 돌출과 크리프가 리스크다.
- **Verdict: GO WITH LIMITATIONS.** 구조는 적합하지만 경쟁이 매우 많다.

### 13. Scrub Daddy Sponge Holder Pad

- **시장:** Etsy $3.99~$5.99, 434~601 표시 리뷰.
- **고객:** 특정 형상 스펀지를 띄워 건조하고 싱크 주변을 정리. 배수, 물때, 스펀지 변형 호환이 핵심이다.
- **제조:** FDM 가능, 습식 환경 소재와 세척성 검증 필요.
- **기회:** 스펀지 규격별 형상과 물 고임 감소. 상표·트레이드드레스 위험이 있다.
- **Verdict: GO WITH LIMITATIONS.** 직접 브랜드 형상을 복제하지 않는 독립 제품 정의가 필요하다.

### 14. Under-Desk Power Brick Holder PETG

- **시장:** Etsy $15.99, 39 표시 리뷰.
- **고객:** 전원 어댑터가 바닥에 놓이거나 케이블을 당기는 문제. 크기·열·커넥터 방향이 핵심이다.
- **제조:** PETG FDM 적합. 장시간 정하중과 열 크리프 시험 필요.
- **기회:** 치수 맞춤이 강한 가치. 전기제품 자체가 아니라 외부 홀더만 범위에 포함한다.
- **Verdict: GO WITH LIMITATIONS.** 낙하와 열 책임 때문에 안전계수 검증 전 판매 금지.

### 15. Cable Claw Under-Desk Hub

- **시장:** Etsy $8.99, 686 표시 리뷰.
- **고객:** 여러 케이블을 한 지점에 모아 숨김. 장착 강도와 굵기별 유지가 핵심이다.
- **제조:** 소형 FDM에 적합.
- **기회:** 케이블 수와 굵기별 모듈화. 직접 부정 VOC가 부족하다.
- **Verdict: HOLD.** 수요는 보이지만 반복 실패 증거를 더 확보해야 한다.

### 16. Personalized Dog Leash Holder

- **시장:** Etsy $19.50, 657 표시 리뷰; 유사 목재 제품은 수천 건.
- **고객:** 현관에서 목줄·하네스 보관과 반려동물 이름 장식. 큰 고리와 개인화가 구매 이유다.
- **제조:** FDM과 각인에 적합하지만 현재 프리미엄은 목재 감성에서 발생할 수 있다.
- **기회:** 이름·견종·색상 맞춤. 반려동물 하중용으로 사용되지 않도록 범위를 명확히 해야 한다.
- **Verdict: HOLD.** FDM 재질감에 추가 비용을 낼 직접 근거가 부족하다.

### 17. Caraway Magnetic Lid Organizer

- **시장:** Etsy $39.19~$48.99, 76~112 표시 리뷰. Caraway 공식 세트는 4.8/5, 4,000+ aggregated reviews.
- **고객:** 무거운 전용 뚜껑을 정렬 보관. 기존 접착 후크가 약 10개월 후 미끄러졌다는 장기 사용 사례가 있다.
- **제조:** FDM+자석·접착 조립. 하중과 캐비닛 간섭 시험이 필수다.
- **기회:** 특정 뚜껑 세트에 맞춘 고정. 브랜드 호환·IP와 고가 뚜껑 낙하 책임이 크다.
- **Verdict: GO WITH LIMITATIONS.** 문제는 강하지만 안전·브랜드 리스크가 높다.

### 18. Car Headrest Hook 4 Pack

- **시장:** Etsy $7.99, 659 표시 리뷰.
- **고객:** 쇼핑백·가방이 바닥에서 굴러다니는 문제 해결. 헤드레스트 봉 지름, 좌석 간격, 차량 고온이 핵심이다.
- **제조:** FDM 가능하나 여름 차량에는 PLA가 부적합할 가능성이 높다.
- **기회:** 차량별 핏. 고하중 주장과 충돌·승객 안전이 리스크다.
- **Verdict: HOLD.** 차량 온도와 충돌 안전을 닫기 전 우선순위를 올리지 않는다.

### 19. Sponge Butler Rapid-Dry Holder

- **시장:** Etsy $8.79~$10.99, 4,600 표시 리뷰.
- **고객:** 젖은 스펀지의 냄새·물 고임·싱크 주변 혼잡. 직접 부정 리뷰는 이번 조사에서 충분히 확보되지 않았다.
- **제조:** FDM 가능하지만 배수 면과 세척성이 품질을 좌우한다.
- **기회:** 건조와 청소성. 광범위한 기존 대안과 위생 클레임이 리스크다.
- **Verdict: HOLD.** 표시 리뷰는 강하지만 실제 반복 VOC 원문이 더 필요하다.

### 20. Self-Adhesive Push-Grip Towel Holder

- **시장:** Etsy $7.62, 리뷰 수 unknown.
- **고객:** 고리 없는 행주를 한 손으로 끼워 보관. 젖은 천의 두께·그립 유지·접착이 핵심이다.
- **제조:** FDM 가능하지만 반복 탄성 부품과 접착패드 검증이 필요하다.
- **기회:** 천 두께 범위와 교체 가능한 그립. 수요 증거가 약하다.
- **Verdict: HOLD.** 구조 기회는 좋지만 시장 근거가 부족하다.

## 5. Final Rankings

### Top 20

전체 순위와 60점 점수는 `opportunity-filter.csv`를 따른다.

### Top 10

1. SKADIS 고정형 후크
2. 샤워 유리 면도기 홀더
3. KitchenAid 코드 정리기
4. 미니멀 면도기 홀더
5. 중력식 빗자루 홀더
6. 캐비닛 개별 냄비뚜껑 홀더
7. 3D 프린팅 리모컨 홀더
8. 범용 가전 코드 랩
9. 페그보드 테크 액세서리 세트
10. CalDigit TS4 언더데스크 마운트

### Top 5

| 순위 | 제품 | 왜 지금 개발해야 하는가 |
|---:|---|---|
| 1 | SKADIS 고정형 후크 | 기존 공식 제품의 헐거움과 출력품 공차 문제가 모두 직접 확인됐고, 작은 시험편으로 빠르게 검증 가능 |
| 2 | 샤워 유리 면도기 홀더 | 유리 두께 불일치가 즉시 반품으로 이어지며 FDM 치수 변형이 문제와 정확히 맞음 |
| 3 | 가전 코드 정리기 | 수천 표시 리뷰와 다수 FDM 판매자가 존재하고, 코드 굵기·플러그·곡률·접착이 명확한 검증 변수 |
| 4 | 미니멀 면도기 홀더 | 소형·저원가·다규격 생산이 가능하고 욕실 정리와 건조라는 반복 사용 과업이 분명함 |
| 5 | 중력식 빗자루 홀더 | PETG 판매 전례와 손잡이 지름·표면 미끄럼 한계가 명시되어 맞춤 개선 근거가 가장 구체적 |

### Top 1: SKADIS Fixed-Fit Hook

**왜 가장 먼저 개발해야 하는가**

1. 시장이 이미 존재한다: Etsy에서 SKADIS 후크·헤드폰 홀더·가위 홀더가 수백~수천 표시 리뷰를 보인다.
2. 고객 불만이 구체적이다: IKEA 공식 리뷰는 후크가 헐거워 탈착 시 들리는 현상을 말한다.
3. FDM이 원인에 개입할 수 있다: 보드·페인트·프린터 편차에 맞춘 공차 관리가 가능하다.
4. 검증비가 낮다: 작은 단일부품이므로 여러 공차를 빠르게 비교할 수 있다.
5. 제품군 확장성이 있다: 동일 체결 인터페이스를 검증하면 도구별 홀더로 확장할 수 있다.

**개발 전 중단 조건**

- 실제 SKADIS 보드 표본에서 공차 변형이 기존 정품보다 유지력 우위를 만들지 못함
- 하중 제거 100회 반복 후 체결력이 유의하게 저하됨
- 목표 판매가가 기존 정품·Etsy·무료 STL 대안 대비 설명되지 않음
- 라이선스·상표·디자인 권리 검토에서 독립 제품화가 어렵다고 판단됨

## 6. Why Existing Companies Have Not Fully Solved These Problems

- 대량 사출은 보드 두께, 코드 굵기, 면도기 손잡이, 리모컨 모델처럼 작은 시장별 치수 변형을 많이 운영하기 어렵다.
- 저가 제품은 접착패드와 공차를 비용 항목으로 취급해 표면별 설치 실패를 고객 책임으로 돌리기 쉽다.
- 플랫폼 호환 제품은 기기 세대가 바뀔 때 금형 재투자가 어렵다.
- 반대로 FDM 업체도 출력층, 표면 품질, 라이선스, 긴 출력시간 때문에 단순히 맞춤 가능하다는 이유만으로 우위를 확보하지 못한다.

이는 출처에서 직접 진술된 사실이 아니라, 확인된 상품 구조와 운영 제약을 바탕으로 한 제조·사업 추론이다.

## 7. Required Next Evidence

1. Top 5 각각에서 부정 리뷰 원문 최소 30건을 동일 코딩 기준으로 확보한다.
2. 국내 네이버·쿠팡·오늘의집의 가격·리뷰·검색 노출을 수동 브라우저로 보강한다.
3. 국내 판매 가능성 판단 전 상표·디자인·특허·모델 라이선스를 검토한다.
4. 실제 대상물 치수 분포를 수집한다: SKADIS 보드, 샤워 유리, 면도기 손잡이, 가전 코드, 빗자루 손잡이.
5. CAD 전 단계에서 고객이 현재 대안보다 얼마를 더 낼지 결제형 랜딩 또는 예약 실험으로 검증한다.

## 8. Sources

- Etsy appliance cord organizers: https://www.etsy.com/market/cord_organizer_for_appliances
- Etsy under-desk cable management: https://www.etsy.com/market/under_desk_cable_management
- Etsy sponge holders: https://www.etsy.com/market/sponge_holders_for_sink
- Etsy broom holders: https://www.etsy.com/market/broom_holder
- Etsy remote holders: https://www.etsy.com/market/3d_printed_remote_holder
- Etsy pot lid organizers: https://www.etsy.com/market/pot_lids_organizer
- Etsy pegboard accessories: https://www.etsy.com/market/pegboard_accessories
- Etsy razor holders: https://www.etsy.com/market/razor_holder_for_shower
- Etsy car headrest hooks: https://www.etsy.com/market/car_seat_headrest_hook
- Etsy pet leash holders: https://www.etsy.com/market/pet_leash_holder
- Gravity broom holder listing: https://www.etsy.com/listing/1441815907/wall-mounted-gravity-broom-holder-petg
- Pegboard tech accessory listing: https://www.etsy.com/listing/4422165735/pegboard-accessories-for-desk-setup
- IKEA SKADIS hook: https://www.ikea.com/us/en/p/skadis-hook-white-50335618/
- SKADIS fit discussion: https://www.reddit.com/r/3Dprinting/comments/1ulnje3/skadis_3d_prints_not_fitting_easily/
- SKADIS third-party discussion: https://www.reddit.com/r/IKEA/comments/1k6edc1
- Caraway long-term review: https://www.abc15.com/caraway-cookware-review
- Caraway official reviews: https://www.carawayhome.com/products/glass-lid-set-of-4
- Razor storage discussion: https://www.badgerandblade.com/forum/threads/storing-a-safety-razor-in-the-shower.308960/
- Adhesive broom holder usage article: https://www.homesandgardens.com/solved/organize-mops-cleaning-essentials-adhesive-wall-mount
- Coupang mechanical vent hook listing: https://www.coupang.com/vp/products/6930283140
- Korean cable cover listing: https://homedecorer.co.kr/product/%EC%A0%84%EC%84%A0%EC%A0%95%EB%A6%AC-%EC%84%A0%EC%A0%95%EB%A6%AC-%EC%BB%B4%ED%93%A8%ED%84%B0-%EC%84%A0-%EC%A0%95%EB%A6%AC-%EC%BC%80%EC%9D%B4%EB%B8%94-%EC%BB%A4%EB%B2%84-%EB%B0%B0%EC%84%A0-%EC%A0%84%EA%B8%B0-%EA%B3%A0%EC%96%91%EC%9D%B4-%EB%B3%B4%ED%98%B8-%ED%81%B4%EB%A6%BD-12mm-x-1m/142/
- Target Vivitar cable clips: https://www.target.com/p/-/A-94444719
- Target Monoprice cable tray: https://www.target.com/p/-/A-78120522
- Temu no-drill mop holder: https://www.temu.com/ph/1pc-mop-holder-mop-hook-mop-clip-wall-mounted-mop-and-broom-storage-clip-mop-hanging-rack-multifunctional-tools-storage-clip-for-bathroom-kitchen-garden-cleaning-accessories-household-gadgets-g-601099530994345.html
- eBay PLA safety razor stand: https://www.ebay.com/itm/327019419905

## 9. Final Decision

`Top 20 결과: 5개 GO, 10개 GO WITH LIMITATIONS, 5개 HOLD, 0개 REJECT.`

이번 결과는 제품 설계 승인이 아니다. Top 5만 다음 고객 VOC 정량 코딩과 실물 치수 조사로 넘기며, 그 검증 전에는 CAD를 만들지 않는다.
