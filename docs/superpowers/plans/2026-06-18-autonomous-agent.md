# 펀타스틱 SaaS 자동형 에이전트 구현 계획

> **에이전트 작업자 필수 사항:** 이 계획을 단계별로 구현할 때 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 진행 상태는 체크박스로 관리한다.

**목표:** 명확한 개발 요청을 구현부터 검증, 커밋, 푸시, Railway 운영 확인까지 중간 승인 없이 완료하도록 저장소 규칙을 설정한다.

**구조:** 저장소 루트의 기존 `AGENTS.md`에 한국어 자동형 운영 절을 추가한다. 기존 주문 및 수집 불변성과 Railway 배포 규칙은 수정하지 않고, 고위험 작업에만 사전 승인 경계를 둔다.

**기술 요소:** Markdown, Codex `AGENTS.md`, Git, Railway

---

### 작업 1: 자동형 운영 규칙 추가

**파일:**
- 수정: `AGENTS.md`

- [ ] **1단계: 기존 규칙과 작업 폴더 상태 확인**

실행:

```powershell
git status --short
Get-Content -Encoding utf8 -Raw AGENTS.md
```

예상 결과: 기존 보호 규칙과 현재 사용자가 작업 중인 파일 목록이 확인된다.

- [ ] **2단계: 한국어 자동형 운영 절 추가**

`AGENTS.md` 끝에 다음 내용을 추가한다.

```md
## 자동형 작업 운영

요청이 명확하고 범위가 정해져 있으면 중간 승인을 반복해서 묻지 말고 관련 코드 확인, 구현, 검증, 커밋, `origin main` 푸시, Railway 운영 배포 및 공개 주소 확인까지 이어서 수행한다.

- 요청과 직접 관련된 파일만 수정하고 커밋한다.
- 필수 검증에 실패하면 푸시하거나 배포하지 않는다.
- 현재 변경 때문에 발생한 실패는 원인을 확인하고 수정한다.
- 기존에 있던 무관한 실패나 사용자 변경사항은 임의로 수정, 삭제, 되돌리거나 현재 커밋에 포함하지 않는다.
- 완료 보고에는 변경 내용, 검증 결과, 커밋 및 배포 상태를 포함한다.

다음 작업은 실행 전에 반드시 사용자 승인을 받는다.

- 운영 데이터를 삭제하거나 되돌리기 어렵게 덮어쓰는 작업
- 파괴적이거나 복구가 어려운 운영 데이터베이스 변경
- 인증 정보나 비밀값을 변경, 노출, 교체 또는 삭제하는 작업
- 보안 또는 접근 제어 장치를 의도적으로 해제하는 작업
- 요청 내용이나 운영 배포 대상이 불분명한 상태에서의 배포
```

- [ ] **3단계: 규칙 내용과 형식 검증**

실행:

```powershell
Select-String -Path AGENTS.md -Encoding utf8 -Pattern '자동형 작업 운영|origin main|운영 데이터를 삭제|Railway'
git diff --check
git diff -- AGENTS.md
```

예상 결과: 필수 자동형 문구가 모두 검색되고, 공백 오류가 없으며, 기존 절은 유지되고 새 절만 추가된다.

- [ ] **4단계: 관련 파일만 커밋**

실행:

```powershell
git add -- AGENTS.md docs/superpowers/plans/2026-06-18-autonomous-agent.md
git diff --cached --name-only
git commit -m "chore: enable autonomous agent workflow"
```

예상 결과: 위 두 파일만 스테이징되고 기존 사용자 변경사항은 포함되지 않은 채 커밋이 생성된다.
