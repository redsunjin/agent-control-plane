# Contributing

## Scope
Keep contributions within the current MVP:
- `record_update`
- single state machine
- SQLite-backed persistence
- CLI-first operator flow

## Before Opening A PR
Read:
1. `README.md`
2. `AGENTS.md`
3. `docs/README.md`

If behavior changes, update the relevant files in `docs/` in the same change.

## Working Rules
- prefer small diffs
- keep one logical change per PR
- do not silently change state transitions, exit codes, or audit semantics
- prefer fail-closed behavior when behavior is ambiguous

## Verification
Run:

```bash
npm run check
npm test
```

If tests are skipped, state why.

## Pull Request Notes
Include:
- what changed
- why it changed
- what was verified
- any remaining risk
