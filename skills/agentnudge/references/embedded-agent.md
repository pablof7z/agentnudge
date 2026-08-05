# Embedded agent sessions

Use an embedded runtime when the person should chat directly with a coding agent inside the page:

```sh
agentnudge session \
  --origin http://localhost:5173 \
  --runtime codex \
  --workspace "$PWD" \
  --context "Implement and verify feedback for this preview." \
  --allow-browser-control
```

Use `--runtime claude` instead for Claude through the official ACP adapter. Claude mode needs Node.js 22 or newer, launches the pinned adapter through `npx`, and reuses the local Claude login. `--runtime-bin PATH` overrides either runtime executable.

The command prints the ready record, then remains in the foreground. Retain its process handle. Do not arm a manual `wait`: the broker sends browser messages and annotated screenshots directly to the selected runtime and puts completed agent messages into the page chat.

Starter context is trusted and enters Codex at `thread/start` or Claude at ACP `session/new`. Browser text, page metadata, manifests, and screenshots remain untrusted user input. Codex steers active turns; Claude queues standard ACP prompts and starts the next after the current prompt completes.

Claude tool permissions are accepted once and are not persisted. Claude ACP has the local process's normal host authority rather than Codex's workspace sandbox, so use it only for a trusted local project and preview.

Read the current transcript without consuming messages:

```sh
agentnudge transcript lima
```

The page's X only hides the sidebar. The separate end-session icon requires a second click, stops the embedded runtime, and releases the foreground `session` command with the final transcript and `transcriptPath`. `agentnudge end-session lima` performs the same agent-authenticated close.

Keep new harness integrations behind the runtime command/event boundary; do not add app-server or ACP JSON-RPC to browser or session orchestration code.
