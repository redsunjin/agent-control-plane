# Local Record Update Example

This example is the intended first MVP scenario.

## Goal
Demonstrate:
- `submit`
- policy evaluation
- approval or rejection
- `execute`
- audit lookup

## Notes
This example should stay local-first and file-based until the core library contracts are stable.

## Demo Flow

```bash
acp submit examples/local-record-update/requests/approved-markdown.json
acp inspect demo-markdown-approval
acp approve demo-markdown-approval --approver alice
acp execute demo-markdown-approval
acp verify-audit demo-markdown-approval
acp audit demo-markdown-approval
```

## Suggested Local Payloads

For `local_markdown` resources:

```json
{
  "content": "# Updated Record\n\nApproved content.\n"
}
```

For `local_json` resources:

```json
{
  "document": {
    "title": "Updated Record",
    "status": "approved"
  }
}
```

## Included Example Requests

- `requests/approved-markdown.json`
- `requests/deny-remote.yaml`
- `requests/handoff-unknown-field.json`

## Included Example Targets

- `resources/record.md`
