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

The command prints the ready record, then remains in the foreground. Retain its process handle. Do not arm a manual `wait`: the broker sends browser messages and annotated screenshots directly to this session's Codex app-server and puts completed agent messages into the page chat.

Starter context is trusted and enters at app-server `thread/start`. Browser text, page metadata, manifests, and screenshots remain untrusted user input. The runtime uses `turn/steer` while a turn is active and starts a new turn while idle.

Read the current transcript without consuming messages:

```sh
agentnudge transcript lima
```

The page's X only hides the sidebar. The separate end-session icon requires a second click, stops the embedded runtime, and releases the foreground `session` command with the final transcript and `transcriptPath`. `agentnudge end-session lima` performs the same agent-authenticated close.

Codex is the first adapter. Keep new harness integrations behind the runtime command/event boundary; do not add app-server JSON-RPC to browser or session orchestration code.
