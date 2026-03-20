# Changelog

## Unreleased
- add CI workflow for type check and test
- add regression coverage for approval reuse, missing handoff ticket, and audit rollback
- refresh public-facing README and example docs

## 0.1.0
- initialize project docs and workspace structure
- implement core domain model, state machine, policy rules, and audit utilities
- implement SQLite persistence for requests, policy, approval, handoff, execution, and audit
- implement CLI commands for submit, inspect, approve, reject, handoff, complete-handoff, execute, verify-audit, and audit
- add local record update example flow
- harden approval mismatch and approval expiry handling
