# 투비즈온 공급사 API 연동

## 목표
- 투비즈온 API 문서 기준으로 인증정보 필드를 실제 발급값(api_key, secure_key, client_server_ip)에 맞춘다.
- 공급사용 상품 등록/수정 API 호출 헬퍼를 구현한다.
- 현재 문서에 주문 수집 API가 없음을 코드/메시지에서 명확히 유지한다.

## 확인한 문서
- https://apidoc.tobizon.co.kr/vender/
- 공급사용 API 문서
- POST /goods 상품등록
- PUT /goods 상품수정
- 공통코드 엑셀 다운로드

## 주의
- 주문 수집/송장 업로드 API는 현재 문서에 없음.
- 실제 상품 등록은 부작용이 있으므로 테스트 연결에서 POST 호출하지 않는다.
