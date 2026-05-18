# 투비즈온 공급사 API 연동 요약

## 변경 사항
- 투비즈온 연결 인증정보를 실제 발급 구조인 `api_key`, `secure_key`, `client_server_ip`로 변경했다.
- 문서의 HMAC 인증 방식(`signed-time + secure_key + client_server_ip`)을 반영한 Authorization 헤더 생성 헬퍼를 추가했다.
- 공급사용 `POST /goods`, `PUT /goods` 상품 등록/수정 호출 헬퍼를 구현했다.
- 현재 공개 문서에는 주문/클레임/송장 API가 없으므로 해당 메서드는 명확한 미지원 메시지를 반환하게 유지했다.

## 확인한 범위
- 문서 URL: https://apidoc.tobizon.co.kr/vender/
- API base: `http://api.tobizon.co.kr/vender`
- 공급사용 API 문서이며 상품 등록/수정과 공통코드 엑셀만 확인됨.

## 검증
- `git diff --check` 통과
- 로컬에는 시스템 `npm`이 없어 `npm run build`는 실행하지 못함.
