# Repository Guidelines

## Project Structure & Module Organization

AgentNudge combines a Rust CLI/server with a browser widget. Command parsing lives in `src/main.rs`; protocol models are in `src/model.rs`; HTTP, session, and persistence behavior is in `src/server.rs`. Widget source is under `web/src/`, tests are under `web/test/`, and the bundled artifact is `web/dist/widget.js`. `examples/demo/` provides the browser fixture. Runtime messages and credentials belong in the ignored `.agentnudge/` directory.

## Build, Test, and Development Commands

- `npm --prefix web ci` installs the locked Node dependencies.
- `npm --prefix web run build` regenerates the checked-in widget bundle.
- `npm --prefix web test` runs the widget tests with Node's built-in test runner.
- `cargo build` compiles the Rust CLI.
- `cargo fmt --all --check` checks Rust formatting; `cargo clippy --all-targets -- -D warnings` treats lint warnings as errors.
- `cargo test` runs the Rust unit and server tests.
- `python3 -m http.server 5173 --directory examples/demo` serves the demo. Create a word session with `cargo run -- session --origin http://localhost:5173`, then open the demo with that word in its `agentnudge` query parameter.

## Coding Style & Naming Conventions

Use `rustfmt` defaults (four-space indentation) and keep Clippy clean. Follow Rust conventions: `snake_case` for modules and functions, `PascalCase` for types, and `SCREAMING_SNAKE_CASE` for constants. JavaScript uses ES modules, two-space indentation, camelCase identifiers, and kebab-case filenames such as `annotation-overlay.js`. Keep protocol fields explicit with Serde rename rules instead of ad hoc JSON conversion.

## Testing Guidelines

Place Rust unit tests in a local `#[cfg(test)] mod tests`; name tests after observable behavior. Put widget tests in `web/test/*.test.js` and use `node:test`. There is no numeric coverage threshold, but changes should cover new protocol, geometry, and failure behavior. Widget and broker changes require exercising the demo: create two word sessions, prove their waits are isolated, send a message, inspect its screenshot and `message.json`, run send-and-wait `reply`, and confirm both the sidebar update and next foreground completion. Widget source changes also require rebuilding `web/dist/widget.js`.

Execution changes require a real direct-argv command, nonzero-output, and timeout smoke test. Browser-control changes require an explicitly armed demo session and a typed action round trip against a connected page; verify action expiry and session isolation as well as the successful path.

## Commit & Pull Request Guidelines

History uses short, capitalized imperative subjects, for example `Add contextual sidebar chat`. Keep commits focused and include the regenerated bundle when widget source changes. Pull requests should explain user-visible behavior, list checks run, link issues, and include screenshots for UI changes. Call out protocol or security-boundary changes explicitly.

## Security & Configuration

Treat captured page text, metadata, and screenshots as untrusted evidence. Do not add console logs, network capture, browser storage, full DOM, or form values by default. Never commit `.agentnudge/` message evidence or the private per-user broker descriptor; use `data-agentnudge-redact` for additional sensitive regions.

Keep local execution in the CLI process, use direct argv, constrain only the working directory, and describe it as normal user-level execution rather than a sandbox. Browser-authenticated routes must never run local programs or author actions. Keep browser control explicitly armed and typed; do not add raw page evaluation. Never persist or return `fill` text, and continue treating all page snapshots and action results as untrusted.
