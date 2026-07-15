# Funtastic Coupang Sourcing Capture

쿠팡 상품 페이지에서 상품명, URL, 대표 이미지, 가격, 키워드를 읽어 Funtastic SaaS `운영 > 소싱` 탭에 저장하는 Chrome/Edge unpacked extension입니다.

## 설치

1. Chrome 또는 Edge에서 `chrome://extensions` 또는 `edge://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 누릅니다.
4. 이 폴더를 선택합니다.

```text
tools/browser-extensions/funtastic-coupang-sourcing-capture
```

## 사용

1. SaaS에서 `운영 > 소싱` 탭을 열고 로그인 상태를 유지합니다.
2. 쿠팡 상품 페이지를 엽니다.
3. 페이지 오른쪽 아래 `F 소싱` 버튼을 누르거나 확장 아이콘 팝업에서 `현재 상품 저장`을 누릅니다.
4. 소싱탭이 열려 있으면 즉시 저장되고, 열려 있지 않으면 소싱탭을 연 뒤 대기 중인 항목이 저장됩니다.

## 원칙

- 쿠팡 상품 이미지는 내부 소싱 참고용으로만 저장합니다.
- 대량 자동 순회 수집이 아니라 사용자가 현재 보고 있는 상품을 저장하는 방식입니다.
- 1688 후보 URL은 SaaS 소싱탭에서 별도로 추가하고 사람이 확정합니다.
