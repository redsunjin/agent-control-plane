# Agent Control Plane Retrospective

## 목적
이 문서는 `Agent Control Plane`이 `dunkin`의 아이디에이션 단계에서 어떻게 선택되고, 서브에이전트 기반 논의를 거쳐 MVP로 잘리고, 현재 저장소에서 구현과 QA까지 이어졌는지 사례처럼 정리한다.

## 1. 아이디에이션 시작
출발점은 `/Users/Agent/ps-workspace/dunkin`이었다.

처음 질문은 단순했다.
- 조직이 AI 에이전트를 실제 업무에 붙일 때 무엇이 부족한가
- 더 좋은 모델이 아니라 운영 레이어에서 어떤 공통 문제가 반복되는가

이 단계의 요약은 [explore summary](/Users/Agent/ps-workspace/dunkin/ideas/research/explore-org-ai-agent-libraries-2026-03-18.md)에 남아 있다.

핵심 문제 정의는 다음으로 모였다.
- 승인 경계가 없다
- 감사가 약하다
- 실패 시 사람 인계가 표준화돼 있지 않다
- 문서나 시트 같은 실제 쓰기 작업을 안전하게 통제하기 어렵다

## 2. 서브에이전트 기반 아이디어 회의
`dunkin` 단계에서는 한 사람이 바로 결론을 내리지 않고, 서로 다른 관점을 가진 서브에이전트 성격의 패널로 아이디어를 다뤘다.

Explore Mode 패널:
- Agent Security Engineer
- Enterprise Workflow Engineer
- OSS Product Engineer
- IT Admin Persona
- Administrative Clerk Persona

진행 방식:
- Diverge
- Expand
- Critique
- Select

이 구조의 장점은 하나의 아이디어를 바로 구현 관점으로 좁히지 않고, 보안, 운영, OSS 제품성, 현업 사용성 관점에서 동시에 압축할 수 있었다는 점이다.

이 과정을 거치면서 상위 후보는 세 개로 남았다.
- Agent Control Plane
- Office Bridge for Docs/Sheets
- Human Handoff Queue

최종적으로 `Agent Control Plane`이 1순위가 된 이유는 명확했다.
- 조직이 실제로 비용을 지불할 문제를 직접 건드린다
- 에이전트를 실험이 아니라 운영 가능한 시스템으로 바꾸는 계층이다
- 다른 vertical을 그 위에 얹을 수 있다

즉, `Office Bridge` 같은 구체적 vertical보다 먼저 필요한 것은 공통 운영 레이어라는 판단이었다.

## 3. Deep Dive에서 범위 자르기
후보가 정해진 뒤에는 바로 구현하지 않고, Deep Dive 단계에서 다시 서브에이전트 스타일 패널 논의를 거쳤다.

Deep Dive 패널:
- OSS Product Engineer
- Enterprise Workflow Engineer
- Security/Operations Engineer
- Adversarial Reviewer
- Compliance/Risk Strategist

이 단계에서 중요한 일은 기능을 늘리는 것이 아니라 책임 범위를 줄이는 것이었다.

정리된 방향:
- 이 제품은 에이전트를 더 똑똑하게 만드는 도구가 아니다
- 조직이 고위험 행동을 운영 가능하게 만드는 control plane이다
- v1은 단일 `ActionRequest` 중심으로 간다
- 핵심은 `policy`, `approval`, `audit`, 최소 `handoff`다
- 실행 엔진, 범용 workflow, UI builder, 무거운 connector는 제외한다

이 결정은 [deep-dive report](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/deep-dive-report.md)와 [panel report](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/deep-dive-panel-report.md)에 남아 있다.

여기서 특히 중요했던 합의는 세 가지였다.
- 정책 입력은 자연어가 아니라 구조화된 action schema만 본다
- 승인 토큰은 `task_id + action hash + scope + policy version + expiry`에 강하게 바인딩한다
- 가장 위험한 실패는 `silent allow`이므로 기본 동작은 fail-closed여야 한다

## 4. MVP를 문서로 고정
Deep Dive 이후에는 말로만 범위를 공유하지 않고, 구현 전에 계약 문서를 먼저 만들었다.

`dunkin`에 먼저 작성된 문서:
- [mvp-spec.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/mvp-spec.md)
- [event-schema.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/event-schema.md)
- [sqlite-schema.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/sqlite-schema.md)
- [cli-contract.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/cli-contract.md)
- [implementation-plan.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/implementation-plan.md)
- [test-plan.md](/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/test-plan.md)

이 단계의 의미는 두 가지였다.
- 아이디어를 바로 코드로 번역하지 않고, 먼저 계약으로 고정했다
- 이후 구현은 문서를 따라가는 방식으로 바뀌었다

결국 MVP는 다음처럼 잘렸다.
- 단일 액션 타입 `record_update`
- 단일 상태 기계
- 단일 SQLite 저장소
- CLI 기반 운영 흐름
- append-only audit
- 최소 handoff

## 5. 현재 저장소로 옮겨온 방식
구현은 `dunkin` 폴더에서 직접 이어가지 않고, 현재 저장소로 문서를 가져와 다시 기준 문서로 고정하는 방식으로 시작했다.

이 과정에서 한 일:
- 아이디에이션 문서를 현재 repo의 `docs/`로 복사/정리
- 현재 코드 구조에 맞춰 로컬 구현 기준으로 재작성
- [docs/README.md](/Users/Agent/ps-workspace/agent-control-plane/docs/README.md)에서 읽기 순서를 고정
- [AGENTS.md](/Users/Agent/ps-workspace/agent-control-plane/AGENTS.md)에서 `Plan -> Review -> Execute -> Verify -> Inspect` 워크플로우를 정의

중요했던 점은 `dunkin`의 문서를 링크만 해두지 않았다는 것이다.
현재 저장소 안에서 문서와 코드가 같이 진화하도록 기준점을 옮겼다.

## 6. 구현 워크플로우
구현은 문서에서 정한 순서를 거의 그대로 따라갔다.

### 6-1. Core 먼저
먼저 `packages/core`에서 다음을 고정했다.
- 도메인 타입
- 상태 기계
- audit 이벤트 모델
- policy evaluator

이 단계의 목적은 규칙을 중앙화하는 것이었다.
상태 전이, approval binding, audit 해시 규칙이 여기서 흔들리면 이후 모든 패키지가 흔들린다.

### 6-2. SQLite 저장 계층
다음은 `packages/sqlite`였다.
- action request
- policy decision
- approval decision
- handoff ticket
- execution result
- audit event

저장 계층에서 중요한 기준은 단순 저장이 아니라 다음 두 가지였다.
- append-only audit
- transaction 경계 안에서 fail-closed

### 6-3. CLI 운영 경로
그 다음 `packages/cli`에서 읽기와 쓰기 흐름을 붙였다.

순서:
- `inspect`, `audit`
- `submit`, `approve`, `reject`, `handoff`
- `execute`
- `verify-audit`, `complete-handoff`

여기서 CLI는 단순한 데모 인터페이스가 아니라, 문서에 적힌 operator workflow를 실제로 검증하는 표면 역할을 했다.

### 6-4. Example
마지막으로 `examples/local-record-update`를 붙였다.

이 예제는 외부 SaaS 없이도 다음을 끝까지 보여주는 역할이었다.
- submit
- policy
- approval
- execute
- audit

즉, vertical adapter 없이도 control plane의 핵심 흐름을 증명하는 최소 데모였다.

## 7. 개발 중 실제로 중요했던 판단
실제 개발 과정에서 가장 중요했던 판단은 기능 추가보다 제약 유지였다.

- 상태 기계는 `packages/core`에서만 관리했다
- unknown field는 허용하지 않고 handoff로 보냈다
- approval은 `action_schema_hash`에 묶었다
- payload 변경은 execution 전에 다시 검증했다
- audit write failure는 성공으로 넘어가지 않게 했다
- 예외 경로는 가능한 한 fail-closed로 처리했다

이 프로젝트는 기능을 많이 넣는 것보다, 이미 정한 제약을 깨지 않는 쪽이 더 중요했다.

## 8. QA와 품질 보정
구현이 끝난 뒤에는 기능을 더 넣기보다 QA와 hardening에 시간을 썼다.

문서 기반 테스트 매트릭스는 [docs/test-plan.md](/Users/Agent/ps-workspace/agent-control-plane/docs/test-plan.md)에 정리돼 있다.

주요 검증 항목:
- 정상 승인
- 정상 거절
- expired approval
- approval 재사용
- approval 후 payload mutation
- unknown field
- handoff completion
- tampered audit
- audit write failure

QA 중 실제로 발견하고 수정한 항목:
- malformed `submit`가 내부 오류로 분류되던 문제
- expired approval이 실행을 막지 못하던 문제
- `inspect`가 deny와 handoff 상태를 과하게 단순화해서 잘못 보여주던 문제

이 단계에서 확인한 것은, 후반의 결함은 대부분 “큰 기능이 빠졌다”기보다 “의미를 잘못 표시하거나 해석하는 문제”라는 점이었다.

## 9. 공개 준비
공개 저장소로 전환하면서 문서를 정리하고 CI를 추가했다.

추가 문서:
- [LICENSE](/Users/Agent/ps-workspace/agent-control-plane/LICENSE)
- [CONTRIBUTING.md](/Users/Agent/ps-workspace/agent-control-plane/CONTRIBUTING.md)
- [ARCHITECTURE.md](/Users/Agent/ps-workspace/agent-control-plane/ARCHITECTURE.md)
- [CHANGELOG.md](/Users/Agent/ps-workspace/agent-control-plane/CHANGELOG.md)
- [SECURITY.md](/Users/Agent/ps-workspace/agent-control-plane/SECURITY.md)

또한 GitHub Actions로 `check`와 `test`를 자동화했다.

즉, 이 프로젝트는 아이디어 메모에서 끝나지 않고, 공개 가능한 형태의 저장소까지 도달했다.

## 10. 이 사례에서 남는 교훈
- 서브에이전트 회의는 아이디어를 많이 만드는 데보다, 관점을 충돌시키고 범위를 줄이는 데 더 유용했다
- `dunkin`에서 먼저 문서를 만든 것이 현재 저장소 구현의 속도와 일관성을 높였다
- 코드는 `core -> sqlite -> cli -> example` 순서로 가는 것이 맞았다
- 이 프로젝트는 기능 확장보다 계약 유지가 더 중요했다
- 공개 직전 QA는 기능 검증보다 의미 왜곡과 상태 해석 오류를 잡는 단계에 가까웠다

## 11. 현재 시점 정리
지금 이 저장소는 다음을 재현할 수 있다.
- `submit -> inspect -> approve -> execute -> verify-audit -> audit`
- `submit -> deny`
- `submit -> handoff -> complete-handoff`
- approval expiry 차단
- approval mutation 차단
- tampered audit fail-closed

즉, `dunkin`에서 정의한 `policy + approval + audit + minimal handoff` MVP는 문서와 코드, 테스트까지 연결된 상태로 현재 저장소에 옮겨와 구현됐다.
