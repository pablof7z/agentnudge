# Contributing

AgentNudge is intentionally small. Please keep changes aligned with the one-shot local feedback loop before expanding the transport or product surface.

## Development checks

```sh
npm --prefix web ci
npm --prefix web run build
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

When changing the widget, also exercise the demo in a real browser and verify the screenshot and `feedback.json` produced by the waiting CLI.

Do not add console logs, network requests, browser storage, full DOM, or form values to the feedback packet by default. Captured page content must remain bounded and explicitly untrusted.
