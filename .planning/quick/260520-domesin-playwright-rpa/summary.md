# 도매의신 Playwright RPA 연동 요약

## 변경 사항
- 도매의신을 RPA 연결 대상에 추가했다.
- `DomesinScraper`를 추가하고 scraper registry에 등록했다.
- 로그인 URL `index.html?p=member/login_form.html` 기준으로 `m_id`, `m_pw` 입력 및 세션 확인을 구현했다.
- RPA 설정 화면에서 저장한 기존 vault 키를 scraper worker가 읽을 수 있도록 fallback을 추가했다.

## 아직 필요한 것
- 도매의신 로그인 ID/PW
- 실제 로그인 후 `my/order_list.html` 주문조회 화면의 컬럼/엑셀 다운로드 버튼 확인
- 확인 후 주문 파싱 또는 엑셀 다운로드 자동화 구현

## 검증
- `git diff --check` 통과 예정
