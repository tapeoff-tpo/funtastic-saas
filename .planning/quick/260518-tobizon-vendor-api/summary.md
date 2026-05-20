# 투비즈온 공급사 API 연동 요약

## 변경 사항
- 투비즈온 연결 인증정보를 실제 발급 구조인 `api_key`, `secure_key`, `client_server_ip`로 변경했다.
- 문서의 HMAC 인증 방식(`signed-time + secure_key + client_server_ip`)을 반영한 Authorization 헤더 생성 헬퍼를 추가했다.
- 공급사용 `POST /goods`, `PUT /goods` 상품 등록/수정 호출 헬퍼를 구현했다.
- 현재 공개 문서에는 주문/클레임/송장 API가 없으므로 해당 메서드는 명확한 미지원 메시지를 반환하게 유지했다.
- 주문 수집은 API가 아닌 RPA 경로를 사용하며, 빈 주문/선택 주문/알림창/HTML 엑셀 다운로드 처리를 보강했다.

## 확인한 범위
- 문서 URL: https://apidoc.tobizon.co.kr/vender/
- API base: `http://api.tobizon.co.kr/vender`
- 공급사용 API 문서이며 상품 등록/수정과 공통코드 엑셀만 확인됨.
- 2026-05-21 재확인: 문서 데이터(`api_data.js`)에도 주문 수집/송장 업로드 엔드포인트는 없음.

## 검증
- `git diff --check` 통과
- 로컬에는 시스템 `npm`이 없어 `npm run build`는 실행하지 못함.
