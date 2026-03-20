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
DB_FILE="$(pwd)/examples/local-record-update/demo.sqlite"

node packages/cli/dist/index.js submit examples/local-record-update/requests/approved-markdown.json --db "$DB_FILE"
node packages/cli/dist/index.js inspect demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js approve demo-markdown-approval --approver alice --db "$DB_FILE"
node packages/cli/dist/index.js execute demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js verify-audit demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js audit demo-markdown-approval --db "$DB_FILE"
```

## Additional Flows

Policy denial:

```bash
node packages/cli/dist/index.js submit examples/local-record-update/requests/deny-remote.yaml --db "$DB_FILE"
```

Unknown-field handoff:

```bash
node packages/cli/dist/index.js submit examples/local-record-update/requests/handoff-unknown-field.json --db "$DB_FILE"
node packages/cli/dist/index.js handoff demo-handoff-unknown-field --to ops-queue --reason missing_context --db "$DB_FILE"
node packages/cli/dist/index.js complete-handoff demo-handoff-unknown-field --resolver alice --summary resolved --db "$DB_FILE"
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

## Validation

```bash
npm run check
npm test
```
