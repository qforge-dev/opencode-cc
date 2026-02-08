# E2E Tests

These tests boot a real `opencode` server, load this plugin, and drive a full orchestrator -> child session flow using the SDK.

## Requirements

- `opencode` installed and available on PATH, or set `OPENCODE_BIN` to the binary path.
- Bun available.

## Run

```bash
bun run test:e2e
```

The E2E test suite is skipped unless `OPENCODE_E2E=1` is set.
