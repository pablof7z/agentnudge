# Contributing

AgentNudge is intentionally small. Please keep changes aligned with the local contextual chat loop before expanding the transport or product surface.

## Development checks

```sh
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

When changing the widget or broker, exercise the demo in a real browser with a session-specific URL. Verify that `agentnudge wait SESSION TIME` returns the screenshot and `message.json`, then run `agentnudge reply SESSION TIME`, confirm the reply appears in the sidebar, and verify the next message completes that same foreground command.

When changing session routing, create at least two simultaneous word sessions and prove that a message submitted to one cannot complete a wait on the other. End both sessions after the test.

Do not add console logs, network requests, browser storage, full DOM, or form values to the feedback packet by default. Captured page content must remain bounded and explicitly untrusted.
