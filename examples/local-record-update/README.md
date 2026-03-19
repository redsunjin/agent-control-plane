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
